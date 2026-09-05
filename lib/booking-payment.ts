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

import { commissionPaiseOn, gstPaiseOn, toPaise, PAISE_PER_RUPEE } from "@/lib/money";

/** Flat, separately-collected, NON-refundable platform fee (rupees). */
export const PLATFORM_FEE_RUPEES = 200;
export const PLATFORM_FEE_PAISE = PLATFORM_FEE_RUPEES * PAISE_PER_RUPEE;

/**
 * GST charged ON HALLNECT'S OWN FEE, and on nothing else.
 *
 * HALLNECT LLP is GST-registered (33AATFH8253K1ZT, Regular, liable from
 * 2026-08-21) and the published fee is exclusive of tax, so the fee is grossed
 * up at checkout: ₹200 + 18% = ₹236.
 *
 * WHAT THIS IS DELIBERATELY *NOT* APPLIED TO — the advance.
 *
 * The advance is payment for the VENUE's supply, not Hallnect's. Hallnect
 * collects it as an agent and passes it on. Whether GST is due on the hall
 * rental, and at what rate, is the venue owner's liability and depends on the
 * owner's own registration status — a platform cannot charge tax on a supply
 * it does not make. Adding 18% to the advance would both overcharge the
 * customer and collect tax against the wrong GSTIN.
 *
 * The commission is likewise untouched here. It IS a taxable supply by
 * Hallnect (to the owner, not the customer), but it is retained out of the
 * owner's money rather than charged on top, so taxing it changes what owners
 * are paid. That is a separate decision and is not made in this module.
 *
 * The rate is snapshotted onto every booking (bookings.gst_rate) rather than
 * read back from this constant, for the same reason commission_rate is
 * snapshotted: a rate change must never rewrite what a past customer was
 * charged.
 */
export const PLATFORM_FEE_GST_PERCENT = 18;

/**
 * Ceiling on the platform fee, as a percent of the ADVANCE.
 *
 * PLATFORM_FEE_RUPEES is flat, and a flat fee stops being a fee and starts
 * being the price when the booking is small enough. Before this cap, the only
 * bound on the fee was against ITSELF — a coupon could take it down and nothing
 * could take it down — so a ₹100 morning slot was advance ₹25 + fee ₹200 + GST
 * ₹36 = ₹261 to reserve, and the customer was then told the balance due at the
 * venue was ₹75. The fee was 236% of the thing being booked.
 *
 * 25% of the advance, which is itself 25% of the hall price, so the fee can
 * never exceed ~6.25% of what is being booked. Above roughly a ₹3,200 hall the
 * flat ₹200 is the lower of the two and nothing changes — which is every real
 * venue in the catalogue. This binds only where the flat fee was absurd.
 *
 * Floored, like the commission, so the ceiling can never round up in Hallnect's
 * favour.
 *
 * NOT a substitute for a minimum hall price. At ₹40 a hall this yields a ₹2.50
 * fee, which no longer overcharges the customer but may not cover the gateway's
 * own cost. Bounding what a listing may charge is a separate, still-open fix.
 */
export const PLATFORM_FEE_MAX_PERCENT_OF_ADVANCE = 25;

/**
 * The fee actually chargeable on an advance — the requested fee, capped.
 *
 * ONE function, called by the engine AND by the checkout preview, for the same
 * reason platformFeeGstRupees exists: a preview that shows ₹200 while the
 * server charges ₹6.25 is worse than no preview at all.
 */
export function cappedPlatformFeeRupees(
  advanceRupees: number,
  requestedFeeRupees: number = PLATFORM_FEE_RUPEES,
): number {
  const advancePaise = toPaise(advanceRupees);
  const requestedPaise = toPaise(requestedFeeRupees);
  const ceilingPaise = Math.floor(
    (advancePaise * Math.round(PLATFORM_FEE_MAX_PERCENT_OF_ADVANCE * 100)) / 10_000,
  );
  return Math.min(requestedPaise, ceilingPaise) / PAISE_PER_RUPEE;
}

/**
 * GST on a platform fee, in rupees — for the CHECKOUT PREVIEW.
 *
 * Exists so the browser and the server cannot round differently. The preview
 * must not re-derive tax with its own `fee * 0.18`: that is a float, it rounds
 * differently from the paise-integer path, and a preview that disagrees with
 * the charge by one paisa is a support ticket. Both sides land here.
 */
export function platformFeeGstRupees(
  feeRupees: number,
  gstPercent: number = PLATFORM_FEE_GST_PERCENT,
): number {
  return gstPaiseOn(toPaise(feeRupees), gstPercent) / PAISE_PER_RUPEE;
}

/** Default commission percent of the FULL HALL PRICE. The live rate is read
 *  from platform_settings (admin-editable); this is the fallback when the
 *  settings row is missing. */
export const DEFAULT_COMMISSION_PERCENT = 2.5;

/**
 * How long a booking holds its slot while awaiting payment, in minutes.
 *
 * Not an arbitrary number: Cashfree refuses an order_expiry_time that is not
 * MORE than 15 minutes out, so a hold shorter than that forces the gateway
 * order to outlive the booking it is paying for. 20 keeps the two aligned —
 * a customer who pays promptly gets an order that expires exactly when their
 * hold does.
 *
 * The database trigger stamp_pending_expiry (0038) is the backstop for rows
 * inserted without expires_at and MUST stay equal to this.
 */
export const PENDING_PAYMENT_TIMEOUT_MIN = 20;

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
  /** Flat platform fee collected on top (rupees), EXCLUSIVE of GST — non-refundable. */
  platformFee: number;
  /** GST on the platform fee (rupees). Zero when a coupon waives the fee. */
  platformFeeGst: number;
  /** GST percent snapshotted for this booking, so a later rate change cannot
   *  rewrite what this customer was charged. */
  gstRate: number;
  /** advanceAmount + platformFee + platformFeeGst — the ONLY amount the gateway
   *  may charge. */
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
    platformFeeGst: number;
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
 *   advance + platformFee + platformFeeGst
 *       === customerTotal                         (paise-exact)
 *   platformFeeGst = round(platformFee × gstRate) (fee only, never the advance)
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
  /**
   * Platform fee in rupees FOR THIS BOOKING. Omit for the standard fee.
   *
   * Exists so a coupon can waive it. A coupon may only ever REDUCE the fee:
   * a value above PLATFORM_FEE_RUPEES throws, so no caller and no bug can
   * quietly charge a customer MORE than the advertised fee. Like
   * commissionRate this is SERVER-RESOLVED — the browser sends a code string,
   * never a number.
   */
  platformFeeRupees?: number;
  /**
   * GST percent on the platform fee. Omit for the current rate.
   *
   * Passed explicitly ONLY when replaying a booking that was charged at a
   * different rate — verification, webhooks, refunds — so the reconciliation
   * uses the rate the customer actually paid rather than today's.
   */
  gstPercent?: number;
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

  // A coupon may only ever take the fee DOWN. Bounding it here rather than at
  // the call site means every surface — booking, retry, replay, test — is held
  // to the same ceiling, and the invariant below cannot be used to overcharge.
  const feeRupees = input.platformFeeRupees ?? PLATFORM_FEE_RUPEES;
  if (!Number.isFinite(feeRupees) || feeRupees < 0 || feeRupees > PLATFORM_FEE_RUPEES) {
    throw new RangeError(
      `calculateBookingPayment: platform fee ${feeRupees} out of [0, ${PLATFORM_FEE_RUPEES}]`,
    );
  }

  // THE SECOND CEILING, and the one that was missing: the fee is bounded
  // against the ADVANCE, not only against itself. Applied AFTER the coupon so
  // the two compose as a floor race rather than fighting — a coupon that waives
  // the fee to 0 still yields 0, because min(0, ceiling) is 0. A cap can only
  // ever take the fee further DOWN, so it cannot be used to overcharge.
  const feePaise = toPaise(cappedPlatformFeeRupees(advancePaise / PAISE_PER_RUPEE, feeRupees));

  // THE BASE IS THE HALL TOTAL, not the advance. The platform fee is NOT part
  // of it — waiving the fee must never move the owner's money.
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

  // GST on the FEE ONLY, and on the fee AFTER any coupon reduction — tax
  // follows the amount actually charged, so a waived fee carries no tax.
  const gstRate = input.gstPercent ?? PLATFORM_FEE_GST_PERCENT;
  if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) {
    throw new RangeError(`calculateBookingPayment: gst percent ${gstRate} out of [0, 100]`);
  }
  const gstPaise = gstPaiseOn(feePaise, gstRate);

  const customerTotalPaise = advancePaise + feePaise + gstPaise;

  return {
    hallTotal:       hallTotalPaise / PAISE_PER_RUPEE,
    advanceAmount:   advancePaise / PAISE_PER_RUPEE,
    platformFee:     feePaise / PAISE_PER_RUPEE,
    platformFeeGst:  gstPaise / PAISE_PER_RUPEE,
    gstRate,
    customerTotal:   customerTotalPaise / PAISE_PER_RUPEE,
    commissionRate:  input.commissionRate,
    commissionAmount: commissionPaise / PAISE_PER_RUPEE,
    ownerNetAdvance: ownerPaise / PAISE_PER_RUPEE,
    paise: {
      hallTotal:       hallTotalPaise,
      advance:         advancePaise,
      platformFee:     feePaise,
      platformFeeGst:  gstPaise,
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
  /**
   * GST actually collected on that fee (rupees); 0 for bookings that predate
   * GST registration.
   *
   * Travels with the fee and only with the fee. When the fee is retained the
   * supply happened and the tax stays remitted; when the fee is returned the
   * supply is cancelled, so the tax goes back with it — a customer who paid
   * ₹236 and is being made whole must receive ₹236, not ₹200.
   */
  platformFeeGst?: number;
  /** Percent of the ADVANCE the policy refunds (0–100). */
  refundPercentOfAdvance: number;
  /** True ONLY for owner/platform-initiated cancellations, where the published
   *  policy returns the fee too. Defaults to false: fee retained. */
  refundPlatformFee?: boolean;
}): RefundBreakdown {
  const advancePaise = toPaise(input.advanceAmount);
  const feePaise = toPaise(input.platformFee);
  const feeGstPaise = toPaise(input.platformFeeGst ?? 0);
  const pct = input.refundPercentOfAdvance;
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new RangeError(`calculateRefund: refund percent ${pct} out of [0,100]`);
  }

  // floor() so a partial refund can never round UP past the policy.
  const advanceRefundPaise = Math.floor((advancePaise * Math.round(pct * 100)) / 10_000);
  const feeRefundPaise = input.refundPlatformFee ? feePaise : 0;
  // The tax is refunded when, and only when, the thing it was charged on is.
  const feeGstRefundPaise = input.refundPlatformFee ? feeGstPaise : 0;

  return {
    refundableAmount:
      (advanceRefundPaise + feeRefundPaise + feeGstRefundPaise) / PAISE_PER_RUPEE,
    nonRefundablePlatformFee: (feePaise - feeRefundPaise) / PAISE_PER_RUPEE,
    advanceWithheld:          (advancePaise - advanceRefundPaise) / PAISE_PER_RUPEE,
  };
}
