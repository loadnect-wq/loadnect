"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkRangeAvailability, type BookingSlot } from "@/lib/availability";
import { todayInBusinessTz, daysBetweenInclusive } from "@/lib/dates";
import { startPaymentForBooking } from "@/lib/payments";
import { isOnlinePaymentEnabled, isManualBookingAllowed } from "@/lib/platform-settings";
import { getAdvancePercent, getCommissionPercent } from "@/lib/platform-settings";
import { calculateBookingPayment, advanceFromTotal } from "@/lib/booking-payment";
import { bookingSchema, paymentSessionSchema, uuidSchema, parseSafe } from "@/lib/validation/schemas";
import { sanitizeError } from "@/lib/errors";
import { normalizePhoneE164 } from "@/lib/notifications/phone";
import { notifyBookingEvent } from "@/lib/notifications/events";

// ── Action ────────────────────────────────────────────────────────────────────
//
// SECURITY MODEL — defense in depth for the "double booking" risk:
//
//   Layer 1: this server action — re-checks availability with the
//            authoritative server-side `checkSlotAvailability`. NEVER trusts
//            the client's calendar snapshot. Recomputes pricing from DB.
//
//   Layer 2: RLS `bookings_insert WITH CHECK` — customer_id = auth.uid(),
//            status must be 'pending_payment', and the hall must be 'approved'.
//
//   Layer 3: partial unique index `uq_booking_active_slot` on
//            (hall_id, event_date, slot) WHERE status in ACTIVE_BOOKING_STATUSES.
//            Two concurrent inserts for the same slot — only one wins, the other
//            gets a 23505 unique-violation error. This is the race-condition
//            backstop that handles the case where two customers click "Book"
//            at exactly the same moment.
//
//   Layer 4: `prevent_overlapping_booking` trigger — handles full-day vs
//            half-day overlap, which the unique index alone can't catch
//            (different `slot` values, so the index wouldn't conflict).

export type CreateBookingInput = {
  hallId:       string;
  eventDate:    string;       // YYYY-MM-DD (range START)
  endDate?:     string;       // YYYY-MM-DD (range END, inclusive; defaults to eventDate)
  slot:         BookingSlot;
  guestCount:   number;
  contactPhone: string;       // customer mobile — REQUIRED; normalized to E.164
  customerNotes?: string;
  termsAccepted?: boolean;    // advance/cancellation/remaining-balance consent
};

export type CreateBookingResult =
  | {
      success: true;
      bookingId: string;
      totalAmount: number;
      advanceAmount: number;
      /** Flat ₹200 collected with the advance — always disclosed to the customer. */
      platformFee: number;
      /** advanceAmount + platformFee — what checkout will actually charge. */
      customerTotal: number;
      expiresAt: string;
    }
  | { error: string };

// Pending bookings auto-cancel after this window (see migration 0011).
// Mirrored in client UI as a countdown. Backend uses a DB trigger to stamp
// expires_at so this constant only affects display, not authoritative timing.
const PENDING_PAYMENT_TIMEOUT_MIN = 15;

export async function createBookingRequest(
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Auth ────────────────────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in to book a venue." };

  // ── Input validation (Zod) ──────────────────────────────────────────────────
  // Enforces: uuid hallId, YYYY-MM-DD format, no past dates, valid slot enum,
  // guest count >= 1 and bounded, customer notes sanitized + length-capped.
  const parsed = parseSafe(bookingSchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // Terms acceptance is mandatory and verified server-side — never trust the
  // client to have shown the checkbox. (bookingSchema strips unknown keys, so we
  // read the flag from the raw input.)
  if (input.termsAccepted !== true) {
    return { error: "Please accept the booking, cancellation, and remaining balance terms to continue." };
  }

  // ── Contact phone (SERVER-AUTHORITATIVE; §booking-notifications) ────────────
  // A booking cannot be finalized without a reachable mobile number: WhatsApp
  // confirmations go to THIS number. Normalized to E.164 so one canonical
  // format is stored ("+919876543210"), never a mix of local formats.
  const contactPhone = normalizePhoneE164(input.contactPhone ?? "");
  if (!contactPhone) {
    return { error: "Please enter a valid mobile number (e.g. +91 98765 43210) — we send booking updates to it." };
  }

  // ── Date-range validation (SERVER-AUTHORITATIVE; spec: max 4 days) ─────────
  // endDate is optional for backward compatibility: absent = single-day booking.
  // The client's duration/price math is display-only — everything is re-derived
  // here, and the DB enforces the same rules again (CHECKs + exclusion, 0024).
  const rawEnd = (input.endDate ?? "").trim();
  const endDate = rawEnd === "" ? v.eventDate : rawEnd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { error: "Invalid end date." };
  }
  if (endDate < v.eventDate) {
    return { error: "End date cannot be before the start date." };
  }
  if (endDate < todayInBusinessTz()) {
    return { error: "Event dates cannot be in the past." };
  }
  const bookingDays = daysBetweenInclusive(v.eventDate, endDate);
  if (bookingDays > 4) {
    return { error: "Maximum booking duration is 4 days." };
  }
  // Multi-day bookings occupy whole days; morning/evening only exist for 1 day.
  const effectiveSlot: BookingSlot = bookingDays > 1 ? "full_day" : v.slot;

  // ── Layer 1 — Authoritative availability re-check (EVERY selected day) ──────
  const availability = await checkRangeAvailability(v.hallId, v.eventDate, endDate, effectiveSlot);
  if (!availability.available) {
    return { error: availability.reason };
  }

  // ── Recompute price from DB (don't trust any client-provided price) ─────────
  const { data: hall, error: hallErr } = await db
    .from("halls")
    .select("id, status, capacity_max, price_per_day, price_morning, price_evening")
    .eq("id", v.hallId)
    .maybeSingle();

  if (hallErr || !hall) return { error: "This hall is no longer available." };
  if (hall.status !== "approved") return { error: "This hall is not currently accepting bookings." };
  if (v.guestCount > hall.capacity_max) {
    return { error: `Guest count exceeds the hall capacity (${hall.capacity_max}).` };
  }

  // Price from DB, never the client. Single-day bookings keep slot pricing;
  // multi-day bookings are full days: daily price x number of days.
  let dailyPrice: number;
  if (bookingDays === 1 && effectiveSlot === "morning" && hall.price_morning != null) {
    dailyPrice = Number(hall.price_morning);
  } else if (bookingDays === 1 && effectiveSlot === "evening" && hall.price_evening != null) {
    dailyPrice = Number(hall.price_evening);
  } else {
    dailyPrice = Number(hall.price_per_day);
  }
  const baseAmount = dailyPrice * bookingDays;

  // PRICING MODEL (the only active one — lib/booking-payment.ts):
  //   • total_amount = the hall price. The customer pays a 25% ADVANCE of it
  //     now plus a flat ₹200 PLATFORM FEE (disclosed, non-refundable), and the
  //     balance directly at the venue.
  //   • Hallnect's commission = 2.5% of the FULL HALL PRICE (rate from
  //     platform_settings, never the client), RETAINED OUT OF the advance —
  //     the owner nets advance − commission at payout (lib/owner-payout.ts).
  //     It is never added on top of what the customer pays.
  // Every figure is computed by the ONE central calculation and snapshotted
  // onto the booking so later rate changes never touch this booking's money.
  const commissionPercent = await getCommissionPercent();
  const advancePercent    = await getAdvancePercent();
  const totalAmount       = baseAmount;
  const pay = calculateBookingPayment({
    hallTotal:      totalAmount,
    advanceAmount:  advanceFromTotal(totalAmount, advancePercent),
    commissionRate: commissionPercent,
  });

  // ── Layer 2/3/4 — Insert with status='pending_payment' ──────────────────────
  // If a parallel request slipped through Layer 1, the partial unique index +
  // trigger will reject this insert with code 23505 or the overlap exception.
  // expires_at is set automatically by the stamp_pending_expiry trigger
  // (migration 0011). We include it here too so the value is correct even on
  // databases where that migration hasn't run yet — the column is still
  // nullable until 0011, so this insert is forward-compatible.
  const expiresAt = new Date(Date.now() + PENDING_PAYMENT_TIMEOUT_MIN * 60_000).toISOString();

  // New-model breakdown columns (0031). Kept in their own object so the
  // un-migrated-DB fallback below can drop them as one stage. The legacy
  // platform_fee column keeps its 0027 meaning (commission snapshot) and is
  // written equal to commission_amount for pre-0031 readers.
  const breakdownPayload: Record<string, unknown> = {
    advance_amount:        pay.advanceAmount,
    platform_fee_amount:   pay.platformFee,
    customer_total_amount: pay.customerTotal,
    commission_rate:       pay.commissionRate,
    commission_amount:     pay.commissionAmount,
    owner_net_advance:     pay.ownerNetAdvance,
  };

  const basePayload: Record<string, unknown> = {
    hall_id:        v.hallId,
    customer_id:    user.id,
    event_date:     v.eventDate,
    end_date:       endDate,
    slot:           effectiveSlot,
    guest_count:    v.guestCount,
    base_amount:    baseAmount,
    platform_fee:   pay.commissionAmount,
    total_amount:   totalAmount,
    status:         "pending_payment",
    contact_phone:  contactPhone,
    customer_notes: v.customerNotes || null,
    expires_at:     expiresAt,
  };

  // TRUSTED-BACKEND INSERT. Migration 0031 revoked the client INSERT policy on
  // bookings (it validated identity but not amounts, leaving price fields
  // client-writable via the Supabase JS client). This action has already
  // validated auth, availability, capacity, and recomputed every amount from
  // the DB — it IS the trusted path, so it writes with the service role.
  const adminInsert = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertDb = adminInsert as any;

  let { data: inserted, error: insertErr } = await insertDb
    .from("bookings")
    .insert({ ...basePayload, ...breakdownPayload, terms_accepted: true, terms_accepted_at: new Date().toISOString() })
    .select("id, expires_at")
    .single();

  // Unknown-column fallbacks for un-migrated databases. PostgREST reports an
  // unknown column in an INSERT body as PGRST204 (schema-cache miss), not the
  // Postgres 42703 — check both. Three stages, newest first: drop the 0031
  // breakdown columns, then contact_phone (pre-0026), then the terms columns
  // (pre-0017) — so each vintage of database keeps every column it has.
  const isUnknownColumn = (e: { code?: string } | null) =>
    e?.code === "42703" || e?.code === "PGRST204";
  if (isUnknownColumn(insertErr)) {
    ({ data: inserted, error: insertErr } = await insertDb
      .from("bookings")
      .insert({ ...basePayload, terms_accepted: true, terms_accepted_at: new Date().toISOString() })
      .select("id, expires_at")
      .single());
    if (isUnknownColumn(insertErr)) {
      const { contact_phone: _cp, ...noPhonePayload } = basePayload;
      void _cp;
      ({ data: inserted, error: insertErr } = await insertDb
        .from("bookings")
        .insert({ ...noPhonePayload, terms_accepted: true, terms_accepted_at: new Date().toISOString() })
        .select("id, expires_at")
        .single());
      if (isUnknownColumn(insertErr)) {
        ({ data: inserted, error: insertErr } = await insertDb
          .from("bookings")
          .insert(noPhonePayload)
          .select("id, expires_at")
          .single());
      }
    }
  }

  if (insertErr) {
    // 23505 = unique violation → race lost to a parallel booking
    if (insertErr.code === "23505") {
      return { error: "This slot was just booked by someone else. Please pick another date or slot." };
    }
    // Trigger raises a generic exception for full-day vs half-day overlaps
    if (insertErr.message?.toLowerCase().includes("already booked")) {
      return { error: "This slot was just booked by someone else. Please pick another date or slot." };
    }
    return { error: insertErr.message ?? "Could not create your booking. Please try again." };
  }

  // Prefill convenience for next time: save the phone to the profile ONLY when
  // the profile has none yet — never overwrite a number the user chose (it may
  // be OTP-verified).
  try {
    const { data: prof } = await db.from("profiles").select("phone").eq("id", user.id).maybeSingle();
    if (prof && !prof.phone) {
      await db.from("profiles").update({ phone: contactPhone }).eq("id", user.id);
    }
  } catch { /* convenience only — never fail the booking over it */ }

  revalidatePath(`/halls/${v.hallId}`);
  revalidatePath("/customer/bookings");

  return {
    success: true,
    bookingId:     inserted.id,
    totalAmount,
    advanceAmount: pay.advanceAmount,
    platformFee:   pay.platformFee,
    customerTotal: pay.customerTotal,
    expiresAt:     inserted.expires_at ?? expiresAt,
  };
}

// ── Manual booking mode (no Cashfree) ───────────────────────────────────────────
//
// When online payment (Cashfree) is not configured, the booking flow runs in
// MANUAL mode: the customer submits a booking REQUEST and Hallnect confirms +
// collects payment offline. createBookingRequest() has already created the
// booking as `pending_payment`; this promotes it to `booking_requested` WITHOUT
// any payment, so the owner and admin see the request.
//
// SECURITY:
//   • Auth user comes from the session, never the client.
//   • Ownership is verified against the SESSION client (RLS scopes to own rows)
//     BEFORE any privileged write.
//   • The status flip uses the service-role client because the
//     validate_booking_transition trigger reserves pending_payment →
//     booking_requested for the trusted backend — exactly the same transition
//     the verified-payment webhook performs. We only ever move the caller's OWN
//     pending booking forward; amounts and identity fields are never touched.

export type ManualBookingResult = { success: true } | { error: string };

export async function submitManualBookingRequest(
  bookingId: string,
  contactPhone?: string,
): Promise<ManualBookingResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in to submit a booking request." };
  if (!parseSafe(uuidSchema, bookingId).ok) return { error: "Invalid booking." };

  // ── PAYMENT-MODE GATE (server-authoritative) ────────────────────────────────
  // This action promotes a booking to `booking_requested` WITHOUT any payment.
  // That is only legitimate in MANUAL mode — i.e. when Cashfree is not
  // configured and Hallnect collects payment offline.
  //
  // It used to be gated only by a UI prop (`onlinePaymentEnabled`), which is
  // not a gate at all: server actions are directly invocable, so once Cashfree
  // was configured ANY signed-in customer could skip checkout entirely and
  // confirm a real booking for free — blocking the hall's calendar and
  // creating an owner commission against money that was never collected.
  // Positive evidence required — see isManualBookingAllowed. Asking
  // isOnlinePaymentEnabled() here read the answer backwards: that helper
  // fails CLOSED (refuse to charge when unsure), which made "unsure" mean
  // "free booking allowed" at this gate.
  if (!(await isManualBookingAllowed())) {
    return { error: "This booking must be paid for online. Please complete the payment to confirm it." };
  }

  // Verify it's the caller's own pending booking (RLS-scoped read).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: booking } = await db
    .from("bookings")
    .select("id, status")
    .eq("id", bookingId)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (!booking) return { error: "Booking not found." };
  // Idempotent: if it's already a request, treat as success.
  if (booking.status === "booking_requested") return { success: true };
  if (booking.status !== "pending_payment") {
    return { error: "This booking can no longer be submitted as a request." };
  }

  // A retried checkout reuses the pending booking row — refresh contact_phone
  // so the message goes to the number the customer LAST entered, not a stale one.
  // Session client on the caller's own row; ignore failures (pre-0026 DBs).
  const freshPhone = contactPhone ? normalizePhoneE164(contactPhone) : null;
  if (freshPhone) {
    await db.from("bookings")
      .update({ contact_phone: freshPhone })
      .eq("id", bookingId)
      .eq("customer_id", user.id);
  }

  // Trusted-backend promotion to booking_requested (no payment). Clear the
  // pending-payment expiry so the auto-cancel cleanup leaves it alone.
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminDb = admin as any;
  const { error } = await adminDb
    .from("bookings")
    .update({ status: "booking_requested", expires_at: null })
    .eq("id", bookingId)
    .eq("customer_id", user.id);

  if (error) {
    // Double-booking backstop: the slot became active between create + submit.
    if (error.code === "23505" || error.message?.toLowerCase().includes("already booked")) {
      return { error: "This slot was just requested by someone else. Please pick another date or slot." };
    }
    return { error: sanitizeError(error, "submitManualBookingRequest") };
  }

  // The booking now EXISTS as a request — this is the moment the owner's
  // "your hall has been booked" alert fires (never from a page view).
  // Idempotent via the outbox dedupe key; a repeat submit sends nothing twice.
  await notifyBookingEvent("booking.requested", bookingId);

  revalidatePath("/customer/bookings");
  revalidatePath("/owner/bookings");
  revalidatePath("/admin/bookings");
  return { success: true };
}

// ── Payment session ─────────────────────────────────────────────────────────────
//
// Creates a Cashfree order for an already-created pending booking and returns a
// payment_session_id that the frontend SDK uses to open checkout.
//
// SECURITY:
//   • customer_id is taken from auth.getUser(), never the client.
//   • The amount is recomputed server-side from the booking's stored
//     total_amount inside startPaymentForBooking (lib/payments.ts) — the client
//     cannot influence what is charged.
//   • Only contact details (name/phone) for the gateway receipt come from the
//     client; the email is read from the authenticated session.
//   • The payments row is written by the service-role admin client (the
//     payments table denies all client writes via RLS).

export type CreatePaymentSessionResult =
  | { success: true; paymentSessionId: string; orderId: string; amount: number; mode: "sandbox" | "production" }
  | { error: string };

export async function createPaymentSession(
  bookingId: string,
  contact: { name?: string; phone?: string },
): Promise<CreatePaymentSessionResult> {
  const supabase = await getSupabaseServerClient();

  // ── Auth — customer id always from the session ──────────────────────────────
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in to continue to payment." };

  const parsed = parseSafe(paymentSessionSchema, {
    bookingId,
    name:  contact.name,
    phone: contact.phone,
  });
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // ── Pre-flight — fail cleanly if the gateway isn't configured ───────────────
  // Avoids surfacing internal env/config details to the client and prevents a
  // confusing checkout attempt when keys are absent.
  if (!(await isOnlinePaymentEnabled())) {
    console.error("[createPaymentSession] online payment is unavailable (credentials missing or switched off).");
    return { error: "Online payments are temporarily unavailable. Please try again later." };
  }

  // Prefer the profile's stored name; fall back to client-provided contact name.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: profile } = await db
    .from("profiles")
    .select("full_name, email, phone")
    .eq("id", user.id)
    .maybeSingle();

  const customerName  = (profile?.full_name || v.name || "").trim() || "Hallnect Customer";
  const customerEmail = (user.email || profile?.email || "").trim();
  const customerPhone = (v.phone || profile?.phone || "").trim();

  if (!customerEmail) return { error: "Your account has no email on file. Cannot start payment." };

  // A retried checkout reuses the pending booking row — keep contact_phone in
  // step with the number the customer LAST entered so post-payment messages reach
  // the right person. Session client on the caller's own row; best-effort.
  const freshPhone = customerPhone ? normalizePhoneE164(customerPhone) : null;
  if (freshPhone) {
    await db.from("bookings")
      .update({ contact_phone: freshPhone })
      .eq("id", v.bookingId)
      .eq("customer_id", user.id)
      .eq("status", "pending_payment");
  }

  const result = await startPaymentForBooking({
    bookingId: v.bookingId,
    customerId:    user.id,
    customerName,
    customerEmail,
    customerPhone,
  });

  if (!result.ok) return { error: result.error };

  const mode = (process.env.CASHFREE_ENV === "production" ? "production" : "sandbox") as
    | "sandbox"
    | "production";

  return {
    success:          true,
    paymentSessionId: result.paymentSessionId,
    orderId:          result.orderId,
    amount:           result.amount,
    mode,
  };
}
