// ─────────────────────────────────────────────────────────────────────────────
// lib/payments.ts — Payment orchestration (Cashfree) for advance bookings.
//
// ⛔  SERVER-ONLY.  Uses the service-role admin client to WRITE the payments
//     table.  This is intentional and required: the payments table has NO
//     client write RLS policy (see migration 0007) — only the trusted backend
//     may insert/update payment rows.  This module IS that trusted backend.
//
// SECURITY MODEL:
//   • Amount is ALWAYS recomputed from the booking row in the DB — never taken
//     from the client.  We charge the 25% advance of booking.total_amount.
//   • customer_id is read from the booking row (which was itself created with
//     customer_id = auth.uid()), never from the client.
//   • A booking is only moved to `payment_success` AFTER we query Cashfree's
//     order API server-side and confirm order_status === "PAID".  The browser
//     redirect / "success" message is NOT trusted on its own.
//   • verifyAndApplyPayment() is idempotent — safe to call from BOTH the
//     return-url status page and the notify_url webhook, in any order, multiple
//     times.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isoDateRange } from "@/lib/dates";
import {
  createCashfreeOrder,
  getCashfreeOrder,
  getCashfreeOrderPayments,
} from "@/lib/cashfree";
import { getAppUrl } from "@/lib/env";
import { notifyBookingEvent } from "@/lib/notifications/events";
import { PLATFORM_FEE_PERCENT } from "@/lib/constants";

const ADVANCE_RATE = 0.25; // 25% advance — mirrors app/book/[slug]/actions.ts

// ── Types ──────────────────────────────────────────────────────────────────────

export type StartPaymentInput = {
  bookingId:     string;
  customerId:    string;      // authenticated user id (verified by caller)
  customerName:  string;
  customerEmail: string;
  customerPhone: string;
};

export type StartPaymentResult =
  | { ok: true; paymentSessionId: string; orderId: string; amount: number }
  | { ok: false; error: string };

export type ApplyPaymentState =
  | "success"        // verified PAID, booking moved to payment_success
  | "pending"        // order still ACTIVE — customer hasn't completed payment
  | "failed"         // order expired / payment failed
  | "slot_conflict"  // PAID, but the slot was taken first — refund required
  | "not_found"      // unknown order
  | "error";

export type ApplyPaymentResult = {
  state:      ApplyPaymentState;
  bookingId?: string;
  message?:   string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Sanitises a phone to the 10-digit form Cashfree expects (drops +91, spaces). */
function normalisePhone(raw: string): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length > 10) return digits.slice(-10); // keep last 10 (strip country code)
  return digits;
}

/** App origin for Cashfree return_url / notify_url. Uses the hardened resolver so
 *  a scheme-less NEXT_PUBLIC_APP_URL can never produce a relative return_url
 *  (which the gateway would resolve against ITS own origin). */
function appUrl(): string {
  return getAppUrl();
}

/** A unique, idempotent-per-attempt Cashfree order id derived from the booking. */
function buildOrderId(bookingId: string): string {
  const short = bookingId.replace(/-/g, "").slice(0, 18);
  const stamp = Date.now().toString(36);
  return `HN_${short}_${stamp}`;
}

// ── Create payment + Cashfree order for a pending booking ──────────────────────

export async function startPaymentForBooking(
  input: StartPaymentInput,
): Promise<StartPaymentResult> {
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  // 1. Load the booking authoritatively (service-role read).
  const { data: booking, error: bErr } = await db
    .from("bookings")
    .select("id, customer_id, status, total_amount, expires_at")
    .eq("id", input.bookingId)
    .maybeSingle();

  if (bErr)        return { ok: false, error: bErr.message };
  if (!booking)    return { ok: false, error: "Booking not found." };

  // 2. Ownership — the booking must belong to the authenticated caller.
  if (booking.customer_id !== input.customerId) {
    return { ok: false, error: "This booking does not belong to you." };
  }

  // 3. Status — only an unpaid, pending booking can start a payment.
  if (booking.status !== "pending_payment") {
    return { ok: false, error: "This booking is not awaiting payment." };
  }

  // 4. Expiry — refuse if the pending window has already elapsed.
  if (booking.expires_at && new Date(booking.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "This booking's payment window has expired. Please book again." };
  }

  // 5. Amount — recompute the advance from the DB total (never trust client).
  const total   = Number(booking.total_amount);
  const advance = Math.max(1, Math.round(total * ADVANCE_RATE));

  const phone = normalisePhone(input.customerPhone);
  if (phone.length < 10) {
    return { ok: false, error: "A valid 10-digit phone number is required for payment." };
  }

  // 6. Create the Cashfree order.
  const orderId   = buildOrderId(input.bookingId);
  const returnUrl = `${appUrl()}/booking/${input.bookingId}/status?order_id={order_id}`;
  const notifyUrl = `${appUrl()}/api/webhooks/cashfree`;

  const order = await createCashfreeOrder({
    orderId,
    amount:        advance,
    customerId:    input.customerId,
    customerName:  input.customerName || "Hallnect Customer",
    customerEmail: input.customerEmail,
    customerPhone: phone,
    returnUrl,
    notifyUrl,
    note:          `Advance for booking ${input.bookingId}`,
  });

  if (!order.ok) return { ok: false, error: order.error };
  if (!order.data.payment_session_id) {
    return { ok: false, error: "Cashfree did not return a payment session. Please retry." };
  }

  // 7. Record the payment row (service-role write — payments has no client policy).
  const { error: pErr } = await db.from("payments").insert({
    booking_id:         input.bookingId,
    customer_id:        booking.customer_id,
    amount:             advance,
    currency:           "INR",
    status:             "created",
    cashfree_order_id:  orderId,
    payment_session_id: order.data.payment_session_id,
  });

  if (pErr) return { ok: false, error: pErr.message };

  return {
    ok:               true,
    paymentSessionId: order.data.payment_session_id,
    orderId,
    amount:           advance,
  };
}

// ── Verify with Cashfree + apply to booking (idempotent) ───────────────────────

export async function verifyAndApplyPayment(orderId: string): Promise<ApplyPaymentResult> {
  if (!orderId) return { state: "not_found" };

  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  // 1. Find our payment row for this Cashfree order.
  const { data: payment, error: pErr } = await db
    .from("payments")
    .select("id, booking_id, customer_id, status, amount")
    .eq("cashfree_order_id", orderId)
    .maybeSingle();

  if (pErr)      return { state: "error", message: pErr.message };
  if (!payment)  return { state: "not_found" };

  // Load the booking with the fields needed for the success side effects.
  const booking = await loadBookingForApply(db, payment.booking_id);

  // 2. Idempotency — already finalised?
  //    Re-assert the side effects (heal any partial state from a previous crash)
  //    and report. Every side effect below is individually idempotent, so it is
  //    always safe to repeat on a webhook retry.
  if (payment.status === "payment_success") {
    if (booking) await applyPaidSideEffects(db, booking);
    // Heal notifications from a prior partial run — dedupe keys make this a
    // no-op when they were already recorded, so webhook retries send nothing.
    await notifyBookingEvent("payment.success", payment.booking_id, { amount: Number(payment.amount) });
    await notifyBookingEvent("booking.requested", payment.booking_id);
    return { state: "success", bookingId: payment.booking_id };
  }
  if (payment.status === "refunded") {
    return { state: "slot_conflict", bookingId: payment.booking_id, message: "Payment was refunded." };
  }

  // 3. Ask Cashfree for the authoritative order status (the real verification).
  const order = await getCashfreeOrder(orderId);
  if (!order.ok) return { state: "error", message: order.error };

  const status = (order.data.order_status ?? "").toUpperCase();

  // ── Not paid yet (order still ACTIVE / customer dropped mid-flow) ────────────
  if (status === "ACTIVE") {
    return { state: "pending", bookingId: payment.booking_id };
  }

  // ── Failed / expired / terminated / user-dropped ────────────────────────────
  // Cashfree surfaces a user-drop as an EXPIRED/TERMINATED order (or a per-attempt
  // USER_DROPPED status). We mark the payment failed; the booking stays
  // pending_payment and is swept by cleanup_expired_pending_bookings().
  if (status === "EXPIRED" || status === "TERMINATED" || status === "TERMINATION_REQUESTED") {
    await db.from("payments")
      .update({ status: "payment_failed", payment_message: `Order ${status}` })
      .eq("id", payment.id)
      .neq("status", "payment_success"); // never downgrade a confirmed payment
    // Keyed on the ORDER, not the booking: a retry payment's failure must
    // still notify even though an earlier attempt already failed.
    await notifyBookingEvent("payment.failed", payment.booking_id, { keySuffix: orderId });
    return { state: "failed", bookingId: payment.booking_id, message: `Payment ${status.toLowerCase()}.` };
  }

  // ── PAID ────────────────────────────────────────────────────────────────────
  if (status === "PAID") {
    if (!booking) {
      return { state: "error", bookingId: payment.booking_id, message: "Booking not found for a paid order." };
    }

    // a) Record the successful payment (idempotent: the .neq guard makes a repeat
    //    webhook a no-op once the row is already payment_success).
    const pays = await getCashfreeOrderPayments(orderId);
    const successEntry = pays.ok
      ? pays.data.find((p) => (p.payment_status ?? "").toUpperCase() === "SUCCESS") ?? pays.data[0]
      : undefined;

    const method =
      typeof successEntry?.payment_method === "object" && successEntry?.payment_method
        ? Object.keys(successEntry.payment_method)[0] ?? null
        : (successEntry?.payment_method as string | undefined) ?? null;

    await db.from("payments")
      .update({
        status:              "payment_success",
        cashfree_payment_id: successEntry?.cf_payment_id ? String(successEntry.cf_payment_id) : null,
        payment_method:      method,
        payment_message:     successEntry?.payment_message ?? "Payment successful",
        raw_response:        order.data,
      })
      .eq("id", payment.id)
      .neq("status", "payment_success");

    // b) Move the booking pending_payment → booking_requested.
    //    The admin (service-role) client is a trusted backend, so the
    //    validate_booking_transition trigger lets this through. The .eq on the
    //    old status makes this idempotent (a repeat run matches 0 rows). Moving
    //    to an ACTIVE status activates the partial unique index
    //    uq_booking_active_slot; if another booking already holds this exact
    //    slot we get 23505 and must refund.
    const { error: upErr } = await db
      .from("bookings")
      .update({ status: "booking_requested" })
      .eq("id", payment.booking_id)
      .eq("status", "pending_payment");

    if (upErr) {
      if (upErr.code === "23505" || (upErr.message ?? "").toLowerCase().includes("already booked")) {
        await db.from("bookings")
          .update({ status: "cancelled", cancel_reason: "Slot already booked — refund due" })
          .eq("id", payment.booking_id)
          .eq("status", "pending_payment");
        await db.from("payments")
          .update({ status: "refunded", payment_message: "Slot conflict — refund initiated" })
          .eq("id", payment.id);
        await notifyBookingEvent("refund.initiated", payment.booking_id);
        return {
          state:     "slot_conflict",
          bookingId: payment.booking_id,
          message:   "Payment succeeded but the slot was just taken. A refund will be initiated.",
        };
      }
      return { state: "error", bookingId: payment.booking_id, message: upErr.message };
    }

    // c) Block availability + record commission (both idempotent).
    await applyPaidSideEffects(db, booking);

    // d) Notify: payment confirmation to all parties, and the "your hall has
    //    been booked" owner alert — fired only now that the booking is REAL
    //    (verified PAID + transitioned), never from a page view. Idempotent
    //    via outbox dedupe keys; SMS failures never fail the payment.
    await notifyBookingEvent("payment.success", payment.booking_id, { amount: Number(payment.amount) });
    await notifyBookingEvent("booking.requested", payment.booking_id);

    return { state: "success", bookingId: payment.booking_id };
  }

  // ── Unknown status ──────────────────────────────────────────────────────────
  return { state: "pending", bookingId: payment.booking_id };
}

// ── Success side effects (idempotent) ──────────────────────────────────────────
// Run after a booking is confirmed paid. Safe to call any number of times:
//   • availability is an upsert keyed on (hall_id, date, slot)
//   • commission is an insert that ignores duplicates (booking_id is UNIQUE)

type ApplyBooking = {
  id:            string;
  hall_id:       string;
  customer_id:   string;
  event_date:    string;
  end_date:      string;
  slot:          "morning" | "evening" | "full_day";
  base_amount:   number;
  platform_fee:  number;
  total_amount:  number;
  hall_owner_id: string | null;
};

async function loadBookingForApply(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  bookingId: string,
): Promise<ApplyBooking | null> {
  const { data, error } = await db
    .from("bookings")
    .select("id, hall_id, customer_id, event_date, end_date, slot, base_amount, platform_fee, total_amount, halls(owner_id)")
    .eq("id", bookingId)
    .maybeSingle();

  if (error || !data) return null;
  const hall = Array.isArray(data.halls) ? data.halls[0] : data.halls;
  return {
    id:            data.id,
    hall_id:       data.hall_id,
    customer_id:   data.customer_id,
    event_date:    data.event_date,
    end_date:      data.end_date ?? data.event_date,
    slot:          data.slot,
    base_amount:   Number(data.base_amount),
    platform_fee:  Number(data.platform_fee),
    total_amount:  Number(data.total_amount),
    hall_owner_id: hall?.owner_id ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyPaidSideEffects(db: any, booking: ApplyBooking): Promise<void> {
  await blockAvailability(db, booking);
  await createCommission(db, booking);
}

/** Marks the hall/date/slot as booked in the availability calendar (upsert). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function blockAvailability(db: any, booking: ApplyBooking): Promise<void> {
  const status =
    booking.slot === "morning" ? "morning_booked"
    : booking.slot === "evening" ? "evening_booked"
    : "full_day_booked";

  // A range booking blocks EVERY day it covers, not just its start date.
  const rows = isoDateRange(booking.event_date, booking.end_date).map((date) => ({
    hall_id:    booking.hall_id,
    date,
    slot:       booking.slot,
    status,
    booking_id: booking.id,
  }));

  const { error } = await db
    .from("availability")
    .upsert(rows, { onConflict: "hall_id,date,slot" });

  if (error) logSideEffectError("blockAvailability", error);
}

/** Records the platform commission for the booking. booking_id is UNIQUE, so a
 *  duplicate insert (e.g. a re-delivered webhook) is ignored — no double rows.
 *
 *  The commission_rate is DERIVED from the booking's stored platform_fee /
 *  base_amount, not re-read from the live setting. This keeps historical
 *  commissions correct if the admin later changes the global rate: each
 *  commission record reflects the rate that was actually charged to the
 *  customer at booking time.                                                  */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createCommission(db: any, booking: ApplyBooking): Promise<void> {
  const derivedRate = booking.base_amount > 0
    ? Math.round((booking.platform_fee / booking.base_amount) * 10000) / 100
    : PLATFORM_FEE_PERCENT;

  // Advance the customer actually paid (mirrors ADVANCE_RATE used at checkout).
  const advance = Math.max(1, Math.round(booking.total_amount * ADVANCE_RATE));
  // Commission is owed by the owner and due 7 days from now. The overdue-check
  // route (app/api/admin/commissions/run-overdue-check) uses the admin-configured
  // commission_due_days for the sweep; this is the per-record default.
  const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await db
    .from("commissions")
    .upsert(
      {
        booking_id:          booking.id,
        hall_id:             booking.hall_id,
        hall_owner_id:       booking.hall_owner_id,
        customer_id:         booking.customer_id,
        booking_amount:      booking.total_amount,
        advance_amount:      advance,
        commission_rate:     derivedRate,
        commission_amount:   booking.platform_fee,
        owner_payout_amount: booking.base_amount,
        status:              "collected",
        due_date:            dueDate,
        settlement_adjustment_status: "none",
      },
      { onConflict: "booking_id", ignoreDuplicates: true },
    );

  if (error) logSideEffectError("createCommission", error);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function logSideEffectError(label: string, error: { code?: string; message?: string }): void {
  if (error.code === "PGRST205" || error.code === "42P01") {
    console.info(`[payments:${label}] table not provisioned yet — run supabase/migrations.`);
  } else if (error.code === "23505") {
    // Duplicate — the row already exists. Expected under idempotent retries.
  } else {
    console.error(`[payments:${label}]`, error.message);
  }
}
