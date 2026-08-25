// ─────────────────────────────────────────────────────────────────────────────
// lib/booking-payment.ts — THE authoritative booking-money calculation.
//
// BUSINESS MODEL (the only active one):
//   • The customer pays:  ADVANCE + ₹200 PLATFORM FEE.
//   • Hallnect's commission = 2.5% of the ADVANCE (admin-configurable rate),
//     absorbed INSIDE the advance — it is never a customer-facing line item
//     and never an extra charge on top.
//   • Owner's net advance = advance − commission. The ₹200 platform fee is
//     collected separately from the customer and NEVER deducted from the owner.
//   • The ₹200 platform fee is NON-REFUNDABLE. Refund calculations operate on
//     the advance only.
//
// The old 5%-commission / 2%-advance-deduction model is discontinued. Historic
// bookings keep their stored figures untouched (audit trail); every NEW
// calculation must go through this module.
//
// Pure and framework-free: all arithmetic is integer paise (lib/money.ts), so
// commission + ownerNet always reconciles exactly to the advance and
// advance + fee always reconciles exactly to the customer total. No caller may
// re-derive any of these numbers with its own formula.
// ─────────────────────────────────────────────────────────────────────────────

import { computeCommissionSplit, toPaise, PAISE_PER_RUPEE } from "@/lib/money";

/** Flat, separately-collected, NON-refundable platform fee (rupees). */
export const PLATFORM_FEE_RUPEES = 200;
export const PLATFORM_FEE_PAISE = PLATFORM_FEE_RUPEES * PAISE_PER_RUPEE;

/** Default commission percent of the ADVANCE. The live rate is read from
 *  platform_settings (admin-editable); this is the fallback when the settings
 *  row is missing. */
export const DEFAULT_COMMISSION_PERCENT = 2.5;

/** Advance = this fraction of the hall total. Single source of truth — the
 *  previous code repeated `0.25` in three modules. */
export const ADVANCE_RATE = 0.25;

/** Rupee advance for a hall total (integer rupees, minimum ₹1). */
export function advanceFromTotal(totalRupees: number): number {
  if (!Number.isFinite(totalRupees) || totalRupees < 0) {
    throw new RangeError(`advanceFromTotal: invalid total ${totalRupees}`);
  }
  return Math.max(1, Math.round(totalRupees * ADVANCE_RATE));
}

export type BookingPaymentBreakdown = {
  /** Gross advance the customer pays toward the hall (rupees). */
  advanceAmount: number;
  /** Flat platform fee collected on top (rupees) — non-refundable. */
  platformFee: number;
  /** advanceAmount + platformFee — the ONLY amount the gateway may charge. */
  customerTotal: number;
  /** Commission percent snapshotted for this booking. */
  commissionRate: number;
  /** Hallnect's commission (rupees) — internal, absorbed inside the advance. */
  commissionAmount: number;
  /** advance − commission — what the owner is settled (rupees). */
  ownerNetAdvance: number;
  /** Integer-paise twins for the settlement ledger. */
  paise: {
    advance: number;
    platformFee: number;
    customerTotal: number;
    commission: number;
    ownerNetAdvance: number;
  };
};

/**
 * The single calculation every surface must use — booking creation, gateway
 * order creation, payment verification, webhooks, refunds, settlements,
 * dashboards, reports, notifications, and tests.
 *
 * Guarantees (enforced by computeCommissionSplit + checks here):
 *   commission + ownerNetAdvance === advance      (paise-exact)
 *   advance + platformFee === customerTotal       (paise-exact)
 *   commission = floor(advance × rate)            (deterministic rounding)
 */
export function calculateBookingPayment(input: {
  /** Gross advance in rupees (may be fractional; snapped to paise). */
  advanceAmount: number;
  /** Commission percent, e.g. 2.5. Callers pass the server-side rate from
   *  platform_settings — NEVER a client-supplied value. */
  commissionRate: number;
}): BookingPaymentBreakdown {
  const advancePaise = toPaise(input.advanceAmount);
  if (advancePaise <= 0) {
    throw new RangeError("calculateBookingPayment: advance must be positive");
  }

  const split = computeCommissionSplit(advancePaise, input.commissionRate);
  const customerTotalPaise = advancePaise + PLATFORM_FEE_PAISE;

  return {
    advanceAmount:   advancePaise / PAISE_PER_RUPEE,
    platformFee:     PLATFORM_FEE_RUPEES,
    customerTotal:   customerTotalPaise / PAISE_PER_RUPEE,
    commissionRate:  split.ratePercent,
    commissionAmount: split.commissionPaise / PAISE_PER_RUPEE,
    ownerNetAdvance: split.ownerPaise / PAISE_PER_RUPEE,
    paise: {
      advance:         advancePaise,
      platformFee:     PLATFORM_FEE_PAISE,
      customerTotal:   customerTotalPaise,
      commission:      split.commissionPaise,
      ownerNetAdvance: split.ownerPaise,
    },
  };
}

export type RefundBreakdown = {
  /** What may be refunded to the customer (rupees). */
  refundableAmount: number;
  /** Fee retained (rupees); 0 when the policy returns it. */
  nonRefundablePlatformFee: number;
  /** The advance portion the policy withheld (rupees), 0 on a full refund. */
  advanceWithheld: number;
};

/**
 * Refund math for the new model. The refundable base is the ADVANCE only,
 * scaled by the policy's percentage (100 = full advance back, 0 = nothing).
 *
 * The ₹200 platform fee is NOT refundable on customer cancellations. The
 * published Refund/Cancellation Policy, however, promises the customer a FULL
 * refund — fee included — when the cancellation is the venue's or the
 * platform's doing (owner rejection, slot race after payment). That policy
 * conflict with a blanket "never refund the fee" rule is resolved here by an
 * explicit flag rather than a silent assumption: callers pass
 * `refundPlatformFee: true` only for owner/platform-initiated cancellations.
 *
 * Both the percentage and the fee flag are POLICY inputs — this function
 * deliberately hard-codes no cancellation policy of its own.
 */
export function calculateRefund(input: {
  /** Gross advance actually captured (rupees). */
  advanceAmount: number;
  /** Platform fee actually collected with it (rupees); 0 for legacy bookings
   *  that predate the fee. */
  platformFee: number;
  /** Percent of the ADVANCE the policy refunds (0–100). */
  refundPercentOfAdvance: number;
  /** True ONLY for owner/platform-initiated cancellations, where the published
   *  policy returns the fee too. Defaults to false: fee retained. */
  refundPlatformFee?: boolean;
}): RefundBreakdown {
  const advancePaise = toPaise(input.advanceAmount);
  const feePaise = toPaise(input.platformFee);
  const pct = input.refundPercentOfAdvance;
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new RangeError(`calculateRefund: refund percent ${pct} out of [0,100]`);
  }

  // floor() so a partial refund can never round UP past the policy.
  const advanceRefundPaise = Math.floor((advancePaise * Math.round(pct * 100)) / 10_000);
  const feeRefundPaise = input.refundPlatformFee ? feePaise : 0;

  return {
    refundableAmount:         (advanceRefundPaise + feeRefundPaise) / PAISE_PER_RUPEE,
    nonRefundablePlatformFee: (feePaise - feeRefundPaise) / PAISE_PER_RUPEE,
    advanceWithheld:          (advancePaise - advanceRefundPaise) / PAISE_PER_RUPEE,
  };
}
