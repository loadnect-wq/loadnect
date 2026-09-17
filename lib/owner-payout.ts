// ─────────────────────────────────────────────────────────────────────────────
// lib/owner-payout.ts — pays the venue owner the moment they ACCEPT a booking.
// SERVER-ONLY.
//
//   advance the customer paid (fee EXCLUDED)
//     − Hallnect's commission (the standard 2% of the FULL HALL PRICE,
//       retained from this advance — lib/booking-payment.ts; the booking's own
//       commission_amount snapshot is what is actually used)
//     = the owner's net advance, settled to their Cashfree vendor balance
//
// For a ₹40,000 booking with a 25% advance: advance ₹10,000 − commission ₹800
// (2% of ₹40,000) = ₹9,200 to the owner now, ₹30,000 collected at the venue. Hallnect earns
// the commission ONCE, retained from the advance, so the owner is never
// separately billed for it.
//
// THE ₹200 PLATFORM FEE IS NOT THE OWNER'S MONEY AND NOT THE OWNER'S COST:
// the customer pays it on top of the advance in the same gateway order, so
// payments.amount = advance + fee. The split below is therefore based on
// payments.advance_amount — using payments.amount would overpay the owner the
// fee, and a settled vendor split cannot be clawed back.
//
// NEVER FAILS THE ACCEPTANCE. A booking the owner accepted must stay accepted
// even if payout plumbing is missing, mid-KYC, or the gateway is down. Every
// outcome is recorded on payments.split_status so an admin can see and retry
// it, and the customer's booking is unaffected.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { todayInBusinessTz } from "@/lib/dates";
import { notifyOwnerPayoutFailed, notifyAdminOperational } from "@/lib/notifications/events";

export type ShareResult =
  | { ok: true; commission: number; ownerAmount: number }
  | { ok: false; reason: string };

/**
 * Splits the advance into Hallnect's platform fee and the owner's share.
 *
 *   Hallnect keeps  = the commission charged on the advance
 *   Owner receives  = advance − commission
 *
 * Kept pure so the money arithmetic is unit-testable without a database.
 *
 * REFUSES rather than guessing when the commission is unknown. The previous
 * version defaulted a missing commission to 0, which paid the owner the ENTIRE
 * advance and silently cost Hallnect its fee — a wrong payout is far worse than
 * a deferred one, because a settled vendor share cannot be clawed back.
 */
export function computeOwnerShare(input: {
  advance: number;
  /** From the commissions row — the authoritative figure. */
  commissionAmount: number | null | undefined;
  /** Fallback: the rate snapshot stored on the booking at creation. */
  bookingPlatformFee: number | null | undefined;
}): ShareResult {
  const advance = Number(input.advance);
  if (!Number.isFinite(advance) || advance <= 0) {
    return { ok: false, reason: "No advance was captured for this booking" };
  }

  const fromCommission = Number(input.commissionAmount);
  const fromBooking = Number(input.bookingPlatformFee);
  const commission = Number.isFinite(fromCommission) && input.commissionAmount != null
    ? fromCommission
    : Number.isFinite(fromBooking) && input.bookingPlatformFee != null
      ? fromBooking
      : NaN;

  if (!Number.isFinite(commission) || commission < 0) {
    return { ok: false, reason: "Commission for this booking is unknown — refusing to pay out" };
  }
  if (commission > advance) {
    // Would mean paying the owner a negative amount; hold for a human.
    return { ok: false, reason: "Commission exceeds the advance captured — needs review" };
  }

  const ownerAmount = Math.round((advance - commission) * 100) / 100;
  if (ownerAmount <= 0) {
    return { ok: false, reason: "Nothing left to pay out after the commission" };
  }

  return { ok: true, commission: Math.round(commission * 100) / 100, ownerAmount };
}

export type PayoutOutcome =
  | { state: "paid"; ownerAmount: number }
  | { state: "skipped"; reason: string }
  | { state: "failed"; reason: string };

/**
 * Fires the owner payout for an accepted booking. Idempotent: the split is
 * claimed with a status-guarded update, so a double-tapped Accept or a retry
 * can never split the same order twice (Cashfree's disable_split closes it at
 * the gateway too).
 */
export async function payOwnerOnAcceptance(bookingId: string): Promise<PayoutOutcome> {
  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;

    // 1. The verified payment that funded this booking, plus the owner's vendor.
    //    select("*") so the 0031 advance/fee breakdown is present when the
    //    migration has run, without erroring when it has not.
    const { data: payment } = await db
      .from("payments")
      .select("*")
      .eq("booking_id", bookingId)
      .eq("status", "payment_success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!payment) {
      // Manual-mode bookings have no gateway payment — nothing to split.
      return { state: "skipped", reason: "No gateway payment for this booking" };
    }
    if (payment.split_status === "done") {
      return { state: "skipped", reason: "Already paid out" };
    }

    // A REFUND IN FLIGHT MEANS THIS MONEY IS THE CUSTOMER'S. Nothing here used
    // to look at the refund columns, so the admin's "Retry payout" button
    // would happily dispatch the owner's share for a booking that had been
    // cancelled and whose refund was already being paid — both sides of the
    // same capture going out at once.
    if (["owed", "processing", "completed"].includes(String(payment.refund_state ?? ""))) {
      return { state: "skipped", reason: "A refund is owed or in progress on this booking — the advance belongs to the customer" };
    }

    // Likewise the BOOKING has to still exist in a payable state. The payment
    // row stays payment_success after a cancellation, so it alone can never
    // tell us the booking was called off.
    const { data: bookingState } = await db
      .from("bookings").select("status").eq("id", bookingId).maybeSingle();
    const bStatus = String(bookingState?.status ?? "");
    if (!["owner_confirmed", "completed"].includes(bStatus)) {
      return {
        state: "skipped",
        reason: `Booking is ${bStatus || "missing"} — only a confirmed or completed booking pays out`,
      };
    }

    // 2. Commission owed on this booking — authoritative, from the DB.
    const { data: commission } = await db
      .from("commissions")
      .select("commission_amount, hall_owner_id")
      .eq("booking_id", bookingId)
      .maybeSingle();

    // Fallback source for the commission: the snapshot written onto the
    // booking at creation. Used only if the commissions row is missing.
    // select("*") keeps this working pre- and post-0031.
    const { data: bookingRow } = await db
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    // The ADVANCE the split is based on — NEVER payments.amount directly: on
    // new payments that includes the customer's ₹200 platform fee, which is
    // Hallnect's, not the owner's. Legacy payments (no breakdown columns)
    // charged the advance alone, so their amount IS the advance.
    const advance =
      payment.advance_amount != null && Number.isFinite(Number(payment.advance_amount))
        ? Number(payment.advance_amount)
        : Number(payment.amount ?? 0);
    const share = computeOwnerShare({
      advance,
      commissionAmount: commission?.commission_amount ?? null,
      bookingPlatformFee: bookingRow?.commission_amount ?? bookingRow?.platform_fee ?? null,
    });


    // UNKNOWN IS NOT ZERO, and this column is read as if it were exact.
    //
    // computeOwnerShare refuses rather than guessing, and the refusal was then
    // flattened to 0 and written into split_owner_amount anyway. That column is
    // the FIRST source ownerShareOf() trusts (lib/admin.ts), so a stored 0 beat
    // the booking's own owner_net_advance snapshot and the advance−commission
    // fallback, and isEstimatedShare() saw a value present and dropped the
    // "estimated — check before paying" flag. The manual-payout screen then
    // presented an unknown share as a confident ₹0 — on the screen an admin
    // uses to decide what to wire to a venue while Easy Split is still off.
    //
    // So the column is left NULL when we could not compute it. Null is what
    // makes the estimate path run and the warning appear.
    const ownerAmount: number | null = share.ok ? share.ownerAmount : null;

    // 3. Record WHY a payout cannot happen, rather than failing silently.
    const note = async (status: string, error: string | null) => {
      await db.from("payments")
        .update({
          split_status: status,
          split_error: error,
          ...(ownerAmount != null ? { split_owner_amount: ownerAmount } : {}),
        })
        .eq("id", payment.id)
        .neq("split_status", "done");
    };

    // A recorded failure nobody reads is still a silent failure: the owner is
    // simply not paid and Hallnect keeps the whole advance. Alert an admin on
    // every genuine failure. 'not_applicable' is excluded — that is a deployment
    // with payouts switched off, not a stuck payment. Never allowed to throw:
    // the acceptance must survive a broken notification pipeline.
    const failAndAlert = async (reason: string): Promise<PayoutOutcome> => {
      await note("failed", reason);
      // The alert quotes an amount, and there may not be one. `reason` always
      // says why in that case ("Commission for this booking is unknown…"), so
      // the admin reading it is not left thinking ₹0 was the owner's share.
      await notifyOwnerPayoutFailed({ bookingId, ownerAmount: ownerAmount ?? 0, reason }).catch(() => {});
      return { state: "failed", reason };
    };

    // AN ACCEPTED BOOKING MEANS AN OWNER IS OWED MONEY.
    //
    // The booking is accepted and the advance is captured, but under Payouts
    // the transfer is a deliberate act by an admin — so the only trace of the
    // debt is a row in a queue somebody has to open. That is exactly the shape
    // of money quietly not being sent, so it rings.
    //
    // Deliberately NOT failAndAlert: nothing has broken. Dressing a normal
    // payable booking as a failure would train the admin to ignore the alert
    // that means a real one.
    const alertPayoutOwed = async (): Promise<void> => {
      // ONCE A DAY, NOT ONCE A BOOKING.
      //
      // Payable bookings are the normal state, not an incident, so a
      // per-booking key would fire on every accepted booking, forever. The admin already receives two SMS per booking
      // (booking.requested and payment.success); a third that never stops is
      // not an alert. Worse, it is billed, and it competes for the same
      // per-phone hourly ceiling as the alerts that DO mean something, so the
      // steady-state noise would be the thing that drops a real one.
      //
      // The day-scoped key means later bookings on the same day do not ring.
      // That is the intended trade and it is safe here precisely because
      // nothing is being lost: /admin/payments lists every one of these rows
      // with the owner's exact share (fetchStuckPayouts deliberately includes
      // 'not_applicable'). The message therefore points at the queue rather
      // than naming one booking's amount, because by the time it is read the
      // queue is the accurate answer and a single figure is not.
      const day = todayInBusinessTz();
      await notifyAdminOperational({
        key:       `payout.manual:${day}`,
        eventType: "payout.manual",
        event:     "Payouts are waiting to be sent by hand",
        // Under MAX_VARIABLE_LENGTH (60) — a DLT variable longer than that is
        // truncated mid-sentence, so the closing words never reach the phone.
        details:   "An owner is due their advance. Send it from Payments.",
        reference: "Clear them from the payout queue in /admin/payments",
        bookingId,
      }).catch(() => {});
    };

    // ── UNDER PAYOUTS, ACCEPTANCE RECORDS ELIGIBILITY. IT DOES NOT SEND. ──
    //
    // This function used to dispatch an Easy Split the moment an owner
    // accepted. Cashfree Payouts is a different product with a different
    // failure surface: transfers are asynchronous by definition, SUCCESS can
    // reverse within 24 hours, and a FAILED carrying certain status codes may
    // mean the debit happened and unwound. Sending automatically on acceptance
    // would put every one of those cases on a path with no human in it.
    //
    // So the booking becomes PAYABLE and an admin presses Send in
    // /admin/payments. The first real rupee that moves through this system
    // moves because somebody looked at it. Auto-dispatch can come later, once
    // the reconcile loop has a track record.
    if (!share.ok) {
      // Never fall back to paying out the full advance — that would hand the
      // owner Hallnect's platform fee. Recorded as failed so it shows in the
      // queue with its reason, and an admin settles it by hand.
      return failAndAlert(share.reason);
    }

    await db.from("payments")
      .update({ split_owner_amount: share.ownerAmount, split_error: null })
      .eq("id", payment.id)
      .neq("split_status", "done");

    await alertPayoutOwed();
    return { state: "skipped", reason: "Recorded as payable — send it from /admin/payments" };
  } catch (e) {
    // Never propagate — the acceptance itself must stand.
    console.error("[owner-payout] failed:", e instanceof Error ? e.message : e);
    return { state: "failed", reason: "Unexpected payout error" };
  }
}
