// ─────────────────────────────────────────────────────────────────────────────
// lib/refunds.ts — records what a cancelled booking owes the customer back.
// SERVER-ONLY.
//
// The money components come from ONE calculation (lib/booking-payment.ts):
//   • the ADVANCE is refundable per the published cancellation schedule below,
//   • the flat ₹200 PLATFORM FEE is NOT refundable when the CUSTOMER cancels,
//     and IS refunded in full when the venue or Hallnect causes the
//     cancellation — exactly what /refund-policy and /cancellation-policy
//     promise. Nothing here invents a policy; the schedule mirrors the
//     published table one-for-one and lives in one editable place.
//
// WHAT THIS DOES AND DOES NOT DO: it computes what is OWED and records it on
// the payment row as refund_state='owed'. It does not move money. Sending it is
// issueRefund() in app/admin/actions.ts, which an admin triggers from the
// dashboard and which calls Cashfree for real.
//
// The distinction is the point. This function used to set status='refunded' the
// moment it ran, while no refund integration existed at all — so a customer who
// had received nothing was shown as refunded everywhere.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { calculateRefund } from "@/lib/booking-payment";
import { daysBetweenInclusive, todayInBusinessTz } from "@/lib/dates";

/**
 * The published customer-cancellation schedule (see /refund-policy). Percent of
 * the ADVANCE returned, by how far ahead of the event the cancellation lands.
 * Editing this table is how the policy changes — no caller hard-codes a number.
 */
export const CUSTOMER_REFUND_SCHEDULE = [
  { minDaysBeforeEvent: 31, percentOfAdvance: 100 },
  { minDaysBeforeEvent: 15, percentOfAdvance: 75 },
  { minDaysBeforeEvent: 7,  percentOfAdvance: 50 },
  { minDaysBeforeEvent: 0,  percentOfAdvance: 0 },
] as const;

/** Percent of the advance refundable for a customer cancellation. */
export function customerRefundPercent(daysUntilEvent: number): number {
  for (const tier of CUSTOMER_REFUND_SCHEDULE) {
    if (daysUntilEvent >= tier.minDaysBeforeEvent) return tier.percentOfAdvance;
  }
  return 0;
}

/** Who caused the cancellation — this decides the platform fee's fate. */
export type CancellationInitiator =
  | "customer"   // schedule applies; ₹200 fee retained
  | "owner"      // venue declined/cancelled: full refund INCLUDING the fee
  | "platform";  // our fault (slot race, payment issue): full refund incl. fee

export type RecordedRefund = {
  refundAmount: number;
  platformFeeRetained: number;
  advanceWithheld: number;
  percentApplied: number;
};

/**
 * Computes and records the refund owed for a cancelled booking. Idempotent: a
 * payment that already carries a refund_amount is left exactly as it is, so a
 * repeated cancellation or a webhook retry can never inflate a refund.
 *
 * Returns null when there is nothing to refund (no successful payment).
 * NEVER throws — a cancellation must stand even if refund bookkeeping fails.
 */
export async function recordBookingRefund(
  bookingId: string,
  initiator: CancellationInitiator,
): Promise<RecordedRefund | null> {
  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;

    const { data: payment } = await db
      .from("payments")
      .select("*")
      .eq("booking_id", bookingId)
      .eq("status", "payment_success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Nothing captured → nothing to refund (a pending booking simply lapses).
    if (!payment) return null;

    // Already recorded — do not recompute or re-announce.
    if (payment.refund_amount != null && Number(payment.refund_amount) > 0) return null;

    const { data: booking } = await db
      .from("bookings").select("*").eq("id", bookingId).maybeSingle();
    if (!booking) return null;

    // Components: prefer the stored breakdown; legacy payments carried the
    // advance alone and no fee.
    const advance = payment.advance_amount != null && Number.isFinite(Number(payment.advance_amount))
      ? Number(payment.advance_amount)
      : Number(payment.amount ?? 0);
    const fee = payment.platform_fee_amount != null && Number.isFinite(Number(payment.platform_fee_amount))
      ? Number(payment.platform_fee_amount)
      : 0;

    // Days until the event decides the customer tier. Owner/platform-caused
    // cancellations return everything regardless of timing.
    const eventDate: string = booking.event_date;
    const daysUntilEvent = Math.max(0, daysBetweenInclusive(todayInBusinessTz(), eventDate) - 1);
    const percent = initiator === "customer" ? customerRefundPercent(daysUntilEvent) : 100;

    const breakdown = calculateRefund({
      advanceAmount: advance,
      platformFee: fee,
      refundPercentOfAdvance: percent,
      refundPlatformFee: initiator !== "customer",
    });

    // `fee` is a MONEY value, so it is tested against 0 explicitly. The old
    // `fee || PLATFORM_FEE_RUPEES` printed "₹200 retained" whenever the fee was
    // zero — which is now every coupon booking, and was already wrong for any
    // legacy payment that fell back to 0 at :105. This note is persisted to
    // payments.payment_message: it is the durable record an admin quotes back
    // to a customer in a dispute, so it must not claim money that was never
    // taken.
    const feeNote = fee > 0
      ? ` ₹${fee} platform fee retained per policy.`
      : " No platform fee was charged on this booking.";
    const note =
      initiator === "customer"
        ? `Customer cancellation ${daysUntilEvent} day(s) before the event — ${percent}% of the advance refundable;${feeNote}`
        : `${initiator === "owner" ? "Venue" : "Platform"}-initiated cancellation — full refund${fee > 0 ? " including the platform fee" : ""}.`;

    const update: Record<string, unknown> = {
      refund_amount: breakdown.refundableAmount,
      payment_message: note,
      // 'owed', NOT 'refunded'. This function records what the customer is due;
      // the money is sent later by issueRefund(). Marking the payment refunded
      // here told every dashboard, receipt and message that a customer had been
      // paid back when nothing had left the account.
      ...(breakdown.refundableAmount > 0 ? { refund_state: "owed" } : {}),
    };

    let { error } = await db
      .from("payments").update(update).eq("id", payment.id).is("refund_amount", null);
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      // Pre-0031 database — record what we can.
      const { refund_amount: _r, ...legacy } = update;
      void _r;
      ({ error } = await db.from("payments").update(legacy).eq("id", payment.id));
    }
    if (error) {
      console.error("[refunds] could not record refund:", error.message);
      return null;
    }

    return {
      refundAmount: breakdown.refundableAmount,
      platformFeeRetained: breakdown.nonRefundablePlatformFee,
      advanceWithheld: breakdown.advanceWithheld,
      percentApplied: percent,
    };
  } catch (e) {
    console.error("[refunds] failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
