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
// WHAT THIS DOES AND DOES NOT DO: it computes the refund and records it on the
// payment row (refund_amount + status) so dashboards, receipts and messages all
// state the same figure. Moving the money is a separate, manual step — Hallnect
// has no Cashfree refund API integration, so claiming an automatic refund here
// would be a lie to the customer. The recorded figure is what an admin pays out.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { calculateRefund, PLATFORM_FEE_RUPEES } from "@/lib/booking-payment";
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

    const note =
      initiator === "customer"
        ? `Customer cancellation ${daysUntilEvent} day(s) before the event — ${percent}% of the advance refundable; ₹${fee || PLATFORM_FEE_RUPEES} platform fee retained per policy.`
        : `${initiator === "owner" ? "Venue" : "Platform"}-initiated cancellation — full refund including the platform fee.`;

    const update: Record<string, unknown> = {
      refund_amount: breakdown.refundableAmount,
      payment_message: note,
      // Only flip the payment to 'refunded' when money is actually going back;
      // a 0% refund leaves the successful payment as it stands.
      ...(breakdown.refundableAmount > 0 ? { status: "refunded" } : {}),
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
