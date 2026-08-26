// ─────────────────────────────────────────────────────────────────────────────
// lib/payments.ts — Payment orchestration (Cashfree) for advance bookings.
//
// ⛔  SERVER-ONLY.  Uses the service-role admin client to WRITE the payments
//     table.  This is intentional and required: the payments table has NO
//     client write RLS policy (see migration 0007) — only the trusted backend
//     may insert/update payment rows.  This module IS that trusted backend.
//
// SECURITY MODEL:
//   • Amount is ALWAYS taken from the booking row in the DB — never from the
//     client.  We charge the booking's stored ADVANCE + the flat ₹200 platform
//     fee (lib/booking-payment.ts is the single source of that arithmetic).
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
import {
  calculateBookingPayment,
  advanceFromTotal,
  DEFAULT_COMMISSION_PERCENT,
  PLATFORM_FEE_RUPEES,
} from "@/lib/booking-payment";

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
    .select("id, customer_id, status, total_amount, expires_at, advance_amount, platform_fee_amount, customer_total_amount")
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

  // 5. Amount — from the booking's stored breakdown (0031), never the client.
  //    The customer pays ADVANCE + ₹200 PLATFORM FEE. A pre-0031 booking with
  //    no stored breakdown gets it computed now via the one central
  //    calculation, from DB values only.
  const storedAdvance = Number(booking.advance_amount);
  const storedFee     = Number(booking.platform_fee_amount);
  const hasBreakdown  =
    booking.advance_amount != null && Number.isFinite(storedAdvance) && storedAdvance > 0;

  // Legacy booking (pre-0031, no stored breakdown): the advance is recomputed
  // at the COMPILE-TIME constant, deliberately NOT the live admin setting.
  // Those bookings were created at 25%; re-deriving them at whatever the rate
  // happens to be today would silently restate money that was already charged.
  const advance = hasBreakdown
    ? storedAdvance
    : advanceFromTotal(Number(booking.total_amount));

  // CAN WE RECORD THE SPLIT? The ₹200 fee may only ride the order if the
  // payments row can say so. On a pre-0031 database the breakdown columns do
  // not exist, and a fee-inclusive `amount` would be indistinguishable from a
  // legacy advance-only row — every downstream reader (owner payout above all)
  // would treat the fee as the owner's money and overpay it. So when the
  // columns are absent we charge the ADVANCE ALONE, preserving the legacy
  // invariant `amount === advance` exactly.
  const { error: probeErr } = await db
    .from("payments").select("advance_amount").limit(1);
  const canRecordBreakdown = !(probeErr?.code === "42703" || probeErr?.code === "PGRST204");
  if (!canRecordBreakdown) {
    console.warn("[payments] 0031 columns missing — charging the advance only; run supabase/migrations to enable the platform fee.");
  }

  const platformFee = !canRecordBreakdown
    ? 0
    : hasBreakdown && booking.platform_fee_amount != null && Number.isFinite(storedFee)
      ? storedFee
      : PLATFORM_FEE_RUPEES;
  const chargeTotal = Math.round((advance + platformFee) * 100) / 100;

  const phone = normalisePhone(input.customerPhone);
  if (phone.length < 10) {
    return { ok: false, error: "A valid 10-digit phone number is required for payment." };
  }

  // 6. Create the Cashfree order for the FULL customer total (advance + fee).
  const orderId   = buildOrderId(input.bookingId);
  const returnUrl = `${appUrl()}/booking/${input.bookingId}/status?order_id={order_id}`;
  const notifyUrl = `${appUrl()}/api/webhooks/cashfree`;

  const order = await createCashfreeOrder({
    orderId,
    amount:        chargeTotal,
    customerId:    input.customerId,
    customerName:  input.customerName || "Hallnect Customer",
    customerEmail: input.customerEmail,
    customerPhone: phone,
    returnUrl,
    notifyUrl,
    note:          `Advance + platform fee for booking ${input.bookingId}`,
  });

  if (!order.ok) return { ok: false, error: order.error };
  if (!order.data.payment_session_id) {
    return { ok: false, error: "Cashfree did not return a payment session. Please retry." };
  }

  // 7. Record the payment row (service-role write — payments has no client
  //    policy). amount = the total charged; advance/fee stored alongside so no
  //    reader ever assumes amount == advance again.
  const paymentRow: Record<string, unknown> = {
    booking_id:         input.bookingId,
    customer_id:        booking.customer_id,
    amount:             chargeTotal,
    currency:           "INR",
    status:             "created",
    cashfree_order_id:  orderId,
    payment_session_id: order.data.payment_session_id,
    // Only when the columns exist. Otherwise platformFee is 0 and chargeTotal
    // IS the advance, so the legacy-shaped row stays truthful.
    ...(canRecordBreakdown
      ? { advance_amount: advance, platform_fee_amount: platformFee }
      : {}),
  };
  const { error: pErr } = await db.from("payments").insert(paymentRow);

  if (pErr) return { ok: false, error: pErr.message };

  return {
    ok:               true,
    paymentSessionId: order.data.payment_session_id,
    orderId,
    amount:           chargeTotal,
  };
}

// ── Verify with Cashfree + apply to booking (idempotent) ───────────────────────

export async function verifyAndApplyPayment(orderId: string): Promise<ApplyPaymentResult> {
  if (!orderId) return { state: "not_found" };

  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  // 1. Find our payment row for this Cashfree order. select("*") rather than a
  //    column list so the 0031 breakdown columns are picked up when present
  //    without failing on a pre-0031 database.
  const { data: payment, error: pErr } = await db
    .from("payments")
    .select("*")
    .eq("cashfree_order_id", orderId)
    .maybeSingle();

  if (pErr)      return { state: "error", message: pErr.message };
  if (!payment)  return { state: "not_found" };

  // The ADVANCE portion of this payment — what messages may call "advance
  // paid" and what the owner's split is based on. On new payments the ₹200
  // platform fee rides the same order, so payment.amount is advance + fee;
  // legacy rows have no breakdown and their amount IS the advance.
  const advancePortion =
    payment.advance_amount != null && Number.isFinite(Number(payment.advance_amount))
      ? Number(payment.advance_amount)
      : Number(payment.amount);

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
    await notifyBookingEvent("payment.success", payment.booking_id, { amount: advancePortion });
    // The advance MUST be passed here too: the owner's new-booking message
    // states "Advance paid", and without it the message read "Not yet paid"
    // immediately after a verified payment.
    await notifyBookingEvent("booking.requested", payment.booking_id, { amount: advancePortion });
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

    // AMOUNT VERIFICATION: the gateway's captured order_amount must match what
    // we asked for. A mismatch (tampered order, stale in-flight order created
    // under different pricing) is surfaced for a human — never auto-confirmed.
    const gatewayAmount = Number(order.data.order_amount);
    if (Number.isFinite(gatewayAmount) && Math.abs(gatewayAmount - Number(payment.amount)) > 0.5) {
      await db.from("payments")
        .update({ payment_message: `Amount mismatch: gateway captured ₹${gatewayAmount}, expected ₹${Number(payment.amount)} — manual review required` })
        .eq("id", payment.id)
        .neq("status", "payment_success");
      logSideEffectError("amountMismatch", {
        code: "amount_mismatch",
        message: `order ${orderId}: gateway ₹${gatewayAmount} != expected ₹${Number(payment.amount)}`,
      });
      return {
        state:     "error",
        bookingId: payment.booking_id,
        message:   "Payment amount did not match the booking. Our team will review it.",
      };
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
    const { error: upErr, count: movedRows } = await db
      .from("bookings")
      .update({ status: "booking_requested" }, { count: "exact" })
      .eq("id", payment.booking_id)
      .eq("status", "pending_payment");

    if (upErr) {
      // 23505 = the active-slot unique index. 23P01 = the GiST range-exclusion
      // constraint (bookings_no_overlapping_ranges), which is what a TRUE
      // concurrent race actually raises — it was previously unhandled, so the
      // paying customer got a generic error, no booking, and no refund record.
      if (
        upErr.code === "23505" ||
        upErr.code === "23P01" ||
        (upErr.message ?? "").toLowerCase().includes("already booked") ||
        (upErr.message ?? "").toLowerCase().includes("conflicting key value") ||
        (upErr.message ?? "").toLowerCase().includes("exclusion constraint")
      ) {
        await db.from("bookings")
          .update({ status: "cancelled", cancel_reason: "Slot already booked — refund due" })
          .eq("id", payment.booking_id)
          .eq("status", "pending_payment");
        // PLATFORM-CAUSED failure: the customer received nothing, so the FULL
        // captured amount — platform fee included — is refunded. The fee's
        // non-refundability applies to customer cancellations, not to our own
        // slot race (see calculateRefund's refundPlatformFee flag).
        const refundUpdate: Record<string, unknown> = {
          status: "refunded",
          payment_message: "Slot conflict — full refund (incl. platform fee) initiated",
          refund_amount: Number(payment.amount),
        };
        let { error: refErr } = await db.from("payments").update(refundUpdate).eq("id", payment.id);
        if (refErr && (refErr.code === "42703" || refErr.code === "PGRST204")) {
          const { refund_amount: _r, ...legacyUpdate } = refundUpdate;
          void _r;
          ({ error: refErr } = await db.from("payments").update(legacyUpdate).eq("id", payment.id));
        }
        if (refErr) logSideEffectError("slotConflictRefund", refErr);
        // Pass the captured amount — the refund message states it, and
        // omitting it told the customer their refund was ₹0.
        await notifyBookingEvent("refund.initiated", payment.booking_id, { amount: Number(payment.amount) });
        return {
          state:     "slot_conflict",
          bookingId: payment.booking_id,
          message:   "Payment succeeded but the slot was just taken. A refund will be initiated.",
        };
      }
      return { state: "error", bookingId: payment.booking_id, message: upErr.message };
    }

    // A zero-row update means the booking was NOT in pending_payment — it had
    // already been cancelled (expiry sweep, customer cancellation) or moved on.
    // Treating that as success took the money, blocked the calendar and raised
    // an owner commission for a booking that does not exist in a payable state.
    // Surface it instead so the admin can refund; never run the paid side
    // effects against a booking we did not actually transition.
    if ((movedRows ?? 0) === 0) {
      // PLATFORM-CAUSED again: the customer paid for a booking we could not
      // honour, so the FULL captured amount (platform fee included) goes back.
      // Record the figure — "our team will arrange a refund" must be backed by
      // a number on the row, and everyone involved has to be told.
      const staleUpdate: Record<string, unknown> = {
        status: "refunded",
        payment_message: "Paid, but the booking was no longer awaiting payment — full refund (incl. platform fee) required",
        refund_amount: Number(payment.amount),
      };
      let { error: staleErr } = await db.from("payments").update(staleUpdate).eq("id", payment.id);
      if (staleErr && (staleErr.code === "42703" || staleErr.code === "PGRST204")) {
        const { refund_amount: _r, ...legacyStale } = staleUpdate;
        void _r;
        ({ error: staleErr } = await db.from("payments").update(legacyStale).eq("id", payment.id));
      }
      if (staleErr) logSideEffectError("bookingNotPendingRefund", staleErr);
      logSideEffectError("bookingNotPending", {
        code: "booking_not_pending",
        message: `order ${orderId} paid but booking ${payment.booking_id} was not pending_payment`,
      });
      await notifyBookingEvent("refund.initiated", payment.booking_id, {
        amount: Number(payment.amount),
        keySuffix: orderId,
      });
      return {
        state:     "slot_conflict",
        bookingId: payment.booking_id,
        message:   "Payment succeeded but this booking was no longer awaiting payment. Our team will arrange a refund.",
      };
    }

    // c) Block availability + record commission (both idempotent).
    await applyPaidSideEffects(db, booking);

    // d) Notify: payment confirmation to all parties, and the "your hall has
    //    been booked" owner alert — fired only now that the booking is REAL
    //    (verified PAID + transitioned), never from a page view. Idempotent
    //    via outbox dedupe keys; notification failures never fail the payment.
    //    The ADVANCE portion is passed (fee excluded) so "Advance paid ₹X" and
    //    the venue-balance arithmetic stay correct.
    await notifyBookingEvent("payment.success", payment.booking_id, { amount: advancePortion });
    await notifyBookingEvent("booking.requested", payment.booking_id, { amount: advancePortion });

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
  /** 0031 breakdown — null on pre-model bookings. */
  advance_amount:    number | null;
  commission_rate:   number | null;
  commission_amount: number | null;
};

async function loadBookingForApply(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  bookingId: string,
): Promise<ApplyBooking | null> {
  // select("*") + join so the 0031 breakdown columns come along when the
  // migration has run, without erroring when it has not.
  const { data, error } = await db
    .from("bookings")
    .select("*, halls(owner_id)")
    .eq("id", bookingId)
    .maybeSingle();

  if (error || !data) return null;
  const hall = Array.isArray(data.halls) ? data.halls[0] : data.halls;
  const num = (v: unknown): number | null =>
    v == null || !Number.isFinite(Number(v)) ? null : Number(v);
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
    advance_amount:    num(data.advance_amount),
    commission_rate:   num(data.commission_rate),
    commission_amount: num(data.commission_amount),
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
 *  Amounts come from the booking's 0031 snapshot (written by the ONE central
 *  calculation at creation), so this record always reflects what was actually
 *  charged — never today's live setting. Pre-0031 bookings fall back to the
 *  legacy derivation from their stored platform_fee.
 *
 *  Status is 'collected': the commission is ABSORBED inside the advance that
 *  Hallnect already holds — the owner owes nothing separately, so the overdue
 *  sweep must never treat these rows as unpaid (see lib/commissions.ts).      */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createCommission(db: any, booking: ApplyBooking): Promise<void> {
  let advance: number;
  let rate: number;
  let commission: number;

  if (booking.advance_amount != null && booking.advance_amount > 0) {
    // New-model booking: use the exact snapshot.
    advance    = booking.advance_amount;
    rate       = booking.commission_rate ?? DEFAULT_COMMISSION_PERCENT;
    // The snapshot written at creation is authoritative. The fallback must
    // pass the HALL TOTAL: the rate applies to the hall price, so deriving it
    // from the advance would recompute a quarter of the real commission.
    commission = booking.commission_amount
      ?? calculateBookingPayment({
           hallTotal:      booking.total_amount,
           advanceAmount:  advance,
           commissionRate: rate,
         }).commissionAmount;
  } else {
    // Legacy booking (pre-0031): platform_fee stored the commission actually
    // charged. The stored AMOUNT is preserved untouched — historical financial
    // records are never recomputed — but the rate is now reported against the
    // hall total, the base the current model uses, so old and new rows are
    // read on the same footing.
    advance    = advanceFromTotal(booking.total_amount);
    commission = booking.platform_fee;
    rate       = booking.total_amount > 0
      ? Math.round((commission / booking.total_amount) * 10000) / 100
      : DEFAULT_COMMISSION_PERCENT;
  }

  // due_date is a legacy column (owner-billed era). Kept for schema
  // compatibility; 'collected' rows are excluded from the overdue sweep.
  const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await db
    .from("commissions")
    .upsert(
      {
        booking_id:          booking.id,
        hall_id:             booking.hall_id,
        hall_owner_id:       booking.hall_owner_id,
        customer_id:         booking.customer_id,
        // The full hall price — and, under the current model, the base the
        // commission rate is applied to.
        booking_amount:      booking.base_amount,
        advance_amount:      advance,
        commission_rate:     rate,
        // Retained out of the advance Hallnect holds — never billed to anyone.
        commission_amount:   commission,
        // What the owner ends up with across advance + venue balance.
        owner_payout_amount: Math.max(0, Math.round((booking.base_amount - commission) * 100) / 100),
        status:              "collected",
        due_date:            dueDate,
        settlement_adjustment_status: "none",
      },
      { onConflict: "booking_id", ignoreDuplicates: true },
    );

  if (error) logSideEffectError("createCommission", error);
}

 
function logSideEffectError(label: string, error: { code?: string; message?: string }): void {
  if (error.code === "PGRST205" || error.code === "42P01") {
    console.info(`[payments:${label}] table not provisioned yet — run supabase/migrations.`);
  } else if (error.code === "23505") {
    // Duplicate — the row already exists. Expected under idempotent retries.
  } else {
    console.error(`[payments:${label}]`, error.message);
  }
}
