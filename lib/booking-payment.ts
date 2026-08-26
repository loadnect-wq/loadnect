// ─────────────────────────────────────────────────────────────────────────────
// lib/booking-payment.ts — THE authoritative booking-money calculation.
//
// BUSINESS MODEL (the only active one):
//   • The customer pays:  ADVANCE + ₹200 PLATFORM FEE.
//   • Hallnect's commission = 2.5% of the FULL HALL PRICE (admin-configurable
//     rate), RETAINED OUT OF the advance — never a customer-facing line item
//     and never an extra charge on top.
//   • Owner's net advance = advance − commission. The ₹200 platform fee is
//     collected separately from the customer and NEVER deducted from the owner.
//   • The ₹200 platform fee is NON-REFUNDABLE. Refund calculations operate on
//     the advance only.
//
// THE BASE AND THE SOURCE ARE DIFFERENT NUMBERS. The rate is applied to the
// hall price; the money comes out of the advance. Worked example, ₹1,00,000
// hall at a 25% advance:
//     customer pays   25,000 advance + 200 fee = 25,200
//     commission      2.5% of 1,00,000         =  2,500   (10% of the advance)
//     owner receives  25,000 − 2,500           = 22,500
//     Hallnect keeps  2,500 + 200              =  2,700
// An earlier revision charged 2.5% of the ADVANCE (₹625 on the same booking).
// That was a quarter of the intended commission. Anything that re-derives the
// commission from the advance is therefore WRONG — the base is the hall total.
//
// Because the base is larger than the pot it is drawn from, the two can cross:
// a high enough rate, or a low enough advance, makes the commission exceed the
// advance and the owner's payout negative. That is a misconfiguration, not a
// booking, so it throws here rather than creating an unpayable booking.
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

import { commissionPaiseOn, toPaise, PAISE_PER_RUPEE } from "@/lib/money";

/** Flat, separately-collected, NON-refundable platform fee (rupees). */
export const PLATFORM_FEE_RUPEES = 200;
export const PLATFORM_FEE_PAISE = PLATFORM_FEE_RUPEES * PAISE_PER_RUPEE;

/** Default commission percent of the FULL HALL PRICE. The live rate is read
 *  from platform_settings (admin-editable); this is the fallback when the
 *  settings row is missing. */
export const DEFAULT_COMMISSION_PERCENT = 2.5;

/** Advance = this fraction of the hall total, when no rate is supplied.
 *  The LIVE rate is platform_settings.default_advance_percentage; this is the
 *  fallback used when that cannot be read, and the two must stay equal so a
 *  failed settings read can never change what a customer is charged. */
export const ADVANCE_RATE = 0.25;
export const DEFAULT_ADVANCE_PERCENT = ADVANCE_RATE * 100; // 25

/**
 * Rupee advance for a hall total (integer rupees, minimum ₹1).
 *
 * `ratePercent` is the admin-configurable advance percentage. It is a
 * PARAMETER rather than a database read so this stays pure and can be shared
 * by the client preview and the server charge — the two computing the advance
 * differently is precisely the drift this module exists to prevent. Callers
 * that have the live setting pass it; the rest get the constant above.
 */
export function advanceFromTotal(
  totalRupees: number,
  ratePercent: number = DEFAULT_ADVANCE_PERCENT,
): number {
  if (!Number.isFinite(totalRupees) || totalRupees < 0) {
    throw new RangeError(`advanceFromTotal: invalid total ${totalRupees}`);
  }
  if (!Number.isFinite(ratePercent) || ratePercent <= 0 || ratePercent > 100) {
    throw new RangeError(`advanceFromTotal: advance percent ${ratePercent} out of (0,100]`);
  }
  return Math.max(1, Math.round((totalRupees * ratePercent) / 100));
}

export type BookingPaymentBreakdown = {
  /** The full hall price — the base the commission rate is applied to. */
  hallTotal: number;
  /** Gross advance the customer pays toward the hall (rupees). */
  advanceAmount: number;
  /** Flat platform fee collected on top (rupees) — non-refundable. */
  platformFee: number;
  /** advanceAmount + platformFee — the ONLY amount the gateway may charge. */
  customerTotal: number;
  /** Commission percent snapshotted for this booking. */
  commissionRate: number;
  /** Hallnect's commission (rupees) — rate × hallTotal, retained out of the
   *  advance. Internal; never shown to the customer as a line item. */
  commissionAmount: number;
  /** advance − commission — what the owner is settled (rupees). */
  ownerNetAdvance: number;
  /** Integer-paise twins for the settlement ledger. */
  paise: {
    hallTotal: number;
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
 * Guarantees:
 *   commission = floor(hallTotal × rate)          (base is the HALL PRICE)
 *   commission + ownerNetAdvance === advance      (paise-exact)
 *   advance + platformFee === customerTotal       (paise-exact)
 *   commission < advance                          (else it throws)
 */
export function calculateBookingPayment(input: {
  /** The FULL hall price in rupees — the commission base. */
  hallTotal: number;
  /**
   * Gross advance in rupees. Omit and it is derived from hallTotal at the
   * standard rate. Passed explicitly only where an advance was already
   * captured and must be honoured exactly (verification, webhooks, replays).
   */
  advanceAmount?: number;
  /** Advance percent from platform_settings; only used when advanceAmount is
   *  omitted. Defaults to the compile-time constant. */
  advancePercent?: number;
  /** Commission percent, e.g. 2.5. Callers pass the server-side rate from
   *  platform_settings — NEVER a client-supplied value. */
  commissionRate: number;
}): BookingPaymentBreakdown {
  const hallTotalPaise = toPaise(input.hallTotal);
  if (hallTotalPaise <= 0) {
    throw new RangeError("calculateBookingPayment: hall total must be positive");
  }

  const advancePaise = toPaise(
    input.advanceAmount ?? advanceFromTotal(input.hallTotal, input.advancePercent),
  );
  if (advancePaise <= 0) {
    throw new RangeError("calculateBookingPayment: advance must be positive");
  }

  // THE BASE IS THE HALL TOTAL, not the advance.
  const commissionPaise = commissionPaiseOn(hallTotalPaise, input.commissionRate);

  // The commission is drawn from a pot smaller than its own base, so the two
  // can cross. Refuse rather than emit a negative owner payout: at 2.5% on a
  // 25% advance the commission is 10% of the advance, so this only fires on a
  // genuine misconfiguration (rate raised past the advance percentage, or an
  // advance captured far below the standard rate).
  if (commissionPaise >= advancePaise) {
    throw new RangeError(
      `calculateBookingPayment: commission (${commissionPaise / PAISE_PER_RUPEE}) ` +
      `is not less than the advance (${advancePaise / PAISE_PER_RUPEE}) — ` +
      `a ${input.commissionRate}% rate on a hall total of ${input.hallTotal} ` +
      `cannot be retained from that advance`,
    );
  }

  const ownerPaise = advancePaise - commissionPaise;
  const customerTotalPaise = advancePaise + PLATFORM_FEE_PAISE;

  return {
    hallTotal:       hallTotalPaise / PAISE_PER_RUPEE,
    advanceAmount:   advancePaise / PAISE_PER_RUPEE,
    platformFee:     PLATFORM_FEE_RUPEES,
    customerTotal:   customerTotalPaise / PAISE_PER_RUPEE,
    commissionRate:  input.commissionRate,
    commissionAmount: commissionPaise / PAISE_PER_RUPEE,
    ownerNetAdvance: ownerPaise / PAISE_PER_RUPEE,
    paise: {
      hallTotal:       hallTotalPaise,
      advance:         advancePaise,
      platformFee:     PLATFORM_FEE_PAISE,
      customerTotal:   customerTotalPaise,
      commission:      commissionPaise,
      ownerNetAdvance: ownerPaise,
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
