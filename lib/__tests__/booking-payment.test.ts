// Tests for the authoritative booking-money calculation (lib/booking-payment).
// The worked examples are the acceptance cases from the business spec — if any
// of these change, the business model changed, not the code.
//
// THE COMMISSION BASE IS THE FULL HALL PRICE, not the advance. The advance is
// merely the pot the commission is retained from. An earlier revision charged
// the rate against the advance, which collected a QUARTER of the intended
// commission at a 25% advance; the cases below are written as hall prices
// precisely so that regression cannot come back unnoticed.

import { describe, it, expect } from "vitest";
import {
  calculateBookingPayment,
  calculateRefund,
  advanceFromTotal,
  cappedPlatformFeeRupees,
  platformFeeGstRupees,
  PLATFORM_FEE_MAX_PERCENT_OF_ADVANCE,
  PLATFORM_FEE_RUPEES,
  PLATFORM_FEE_GST_PERCENT,
  DEFAULT_COMMISSION_PERCENT,
  DEFAULT_ADVANCE_PERCENT,
} from "@/lib/booking-payment";
import { commissionPaiseOn, splitFromParts, toPaise } from "@/lib/money";
import { customerRefundPercent, daysUntilEventFromToday } from "@/lib/refund-schedule";
import { computeOwnerShare } from "@/lib/owner-payout";

describe("calculateBookingPayment — spec acceptance cases", () => {
  // These totals moved when HALLNECT LLP became GST-registered and the
  // published fee was declared EXCLUSIVE of tax: the ₹200 fee is now charged as
  // ₹236. The advance, the commission and the owner's net are all unchanged —
  // GST applies to Hallnect's fee, never to the venue's supply.
  it("hall ₹1,00,000 → advance ₹25,000 + fee ₹200 + GST ₹36; commission ₹2,500; owner ₹22,500", () => {
    // The worked example from the business owner, verbatim, plus tax.
    const b = calculateBookingPayment({ hallTotal: 100_000, commissionRate: 2.5 });
    expect(b.advanceAmount).toBe(25_000);
    expect(b.platformFee).toBe(200);
    expect(b.platformFeeGst).toBe(36);
    expect(b.gstRate).toBe(18);
    expect(b.customerTotal).toBe(25_236);
    expect(b.commissionAmount).toBe(2_500);
    expect(b.ownerNetAdvance).toBe(22_500);
    // What Hallnect actually keeps: commission + the fee. The GST is collected,
    // not earned — it is the government's and must not be counted as revenue.
    expect(b.commissionAmount + b.platformFee).toBe(2_700);
  });

  it("hall ₹40,000 → advance ₹10,000 + fee ₹200 + GST ₹36; commission ₹1,000; owner ₹9,000", () => {
    const b = calculateBookingPayment({ hallTotal: 40_000, commissionRate: 2.5 });
    expect(b.customerTotal).toBe(10_236);
    expect(b.commissionAmount).toBe(1_000);
    expect(b.ownerNetAdvance).toBe(9_000);
  });

  it("hall ₹20,000 → advance ₹5,000 + fee ₹200 + GST ₹36; commission ₹500; owner ₹4,500", () => {
    const b = calculateBookingPayment({ hallTotal: 20_000, commissionRate: 2.5 });
    expect(b.customerTotal).toBe(5_236);
    expect(b.commissionAmount).toBe(500);
    expect(b.ownerNetAdvance).toBe(4_500);
  });

  it("never charges GST on the advance — tax follows Hallnect's supply, not the venue's", () => {
    // The single most important property of this change. If someone ever
    // applies the rate to the advance or the customer total, this fails: the
    // gap between what the customer pays and the advance+fee must be exactly
    // the tax on the FEE, whatever the hall costs.
    for (const total of [400, 20_000, 100_000, 999_999]) {
      const b = calculateBookingPayment({ hallTotal: total, commissionRate: 2.5 });
      expect(b.paise.platformFeeGst).toBe(Math.round((b.paise.platformFee * 1800) / 10_000));
      expect(b.paise.customerTotal - b.paise.advance - b.paise.platformFee)
        .toBe(b.paise.platformFeeGst);
    }
  });

  it("charges no GST when a coupon waives the fee — tax follows the amount actually charged", () => {
    const b = calculateBookingPayment({
      hallTotal: 100_000, commissionRate: 2.5, platformFeeRupees: 0,
    });
    expect(b.platformFee).toBe(0);
    expect(b.platformFeeGst).toBe(0);
    expect(b.customerTotal).toBe(25_000);
  });

  it("never lets the fee exceed a quarter of the advance", () => {
    // The bug this cap exists for: a ₹100 morning slot was advance ₹25 + fee
    // ₹200 + GST ₹36 = ₹261 to reserve, while the UI told the customer the
    // balance due at the venue was ₹75. The fee was 236% of the booking.
    const tiny = calculateBookingPayment({ hallTotal: 100, commissionRate: 2.5 });
    expect(tiny.advanceAmount).toBe(25);
    expect(tiny.platformFee).toBe(6.25);          // was 200
    expect(tiny.platformFeeGst).toBe(1.13);       // tax follows the capped fee
    expect(tiny.customerTotal).toBe(32.38);       // was 261

    // The ceiling holds across the whole range, including the values where the
    // flat fee is the lower of the two and nothing changes.
    for (const total of [40, 100, 200, 1_500, 3_200, 4_000, 20_000, 999_999]) {
      const b = calculateBookingPayment({ hallTotal: total, commissionRate: 2.5 });
      expect(b.paise.platformFee).toBeLessThanOrEqual(
        Math.floor((b.paise.advance * PLATFORM_FEE_MAX_PERCENT_OF_ADVANCE * 100) / 10_000),
      );
      expect(b.paise.platformFee).toBeLessThanOrEqual(toPaise(PLATFORM_FEE_RUPEES));
    }
  });

  it("leaves every real venue untouched — the cap binds only where the flat fee was absurd", () => {
    // Above roughly a ₹3,200 hall the flat ₹200 is the lower bound, so this
    // change must be invisible to actual inventory.
    for (const total of [4_000, 20_000, 40_000, 60_000, 100_000, 999_999]) {
      expect(calculateBookingPayment({ hallTotal: total, commissionRate: 2.5 }).platformFee)
        .toBe(PLATFORM_FEE_RUPEES);
    }
  });

  it("composes with a coupon as a race to the bottom, never upward", () => {
    // Both bounds take the fee DOWN, so whichever is lower wins and neither can
    // be used to charge more. A waiver still wins on a tiny booking.
    const waived = calculateBookingPayment({
      hallTotal: 100, commissionRate: 2.5, platformFeeRupees: 0,
    });
    expect(waived.platformFee).toBe(0);
    expect(waived.platformFeeGst).toBe(0);

    // A coupon reducing the fee to ₹50 loses to the ₹6.25 ceiling on a ₹100 hall…
    expect(calculateBookingPayment({
      hallTotal: 100, commissionRate: 2.5, platformFeeRupees: 50,
    }).platformFee).toBe(6.25);

    // …and wins on a hall large enough for the ceiling not to bind.
    expect(calculateBookingPayment({
      hallTotal: 100_000, commissionRate: 2.5, platformFeeRupees: 50,
    }).platformFee).toBe(50);
  });

  it("refunds the tax with the fee, so a cancelled customer is made whole", () => {
    // Owner/platform cancellation returns the fee. The customer handed over
    // ₹236 for that fee, so ₹236 has to come back — returning the ₹200 and
    // keeping the ₹36 would leave the customer short by exactly the tax on a
    // service they never received.
    const full = calculateRefund({
      advanceAmount: 25_000, platformFee: 200, platformFeeGst: 36,
      refundPercentOfAdvance: 100, refundPlatformFee: true,
    });
    expect(full.refundableAmount).toBe(25_236);
    expect(full.nonRefundablePlatformFee).toBe(0);

    // Customer cancellation retains the fee — and therefore the tax on it,
    // because that supply did happen and the tax is already the government's.
    const retained = calculateRefund({
      advanceAmount: 25_000, platformFee: 200, platformFeeGst: 36,
      refundPercentOfAdvance: 100, refundPlatformFee: false,
    });
    expect(retained.refundableAmount).toBe(25_000);
    expect(retained.nonRefundablePlatformFee).toBe(200);
  });

  it("refunds nothing extra for a booking taken before GST registration", () => {
    // platformFeeGst omitted entirely — legacy rows must behave exactly as they
    // did, or every historic refund is restated.
    const b = calculateRefund({
      advanceAmount: 25_000, platformFee: 200,
      refundPercentOfAdvance: 100, refundPlatformFee: true,
    });
    expect(b.refundableAmount).toBe(25_200);
  });

  it("snapshots the rate, so a replay at the old rate reproduces the old total", () => {
    // A booking captured before the rate changed must reconcile against the
    // rate it was charged at, not today's.
    const b = calculateBookingPayment({ hallTotal: 100_000, commissionRate: 2.5, gstPercent: 0 });
    expect(b.platformFeeGst).toBe(0);
    expect(b.gstRate).toBe(0);
    expect(b.customerTotal).toBe(25_200);
  });

  it("is exactly 4x what the retired advance-based formula produced", () => {
    // Guards the specific regression: 2.5% of a 25% advance is 0.625% of the
    // hall price. If someone reverts the base, this fails loudly.
    const b = calculateBookingPayment({ hallTotal: 100_000, commissionRate: 2.5 });
    const advanceBased = 25_000 * 0.025; // the old, wrong number
    expect(b.commissionAmount).toBe(advanceBased * 4);
  });
});

describe("calculateBookingPayment — invariants", () => {
  const totals = [400, 4_000, 20_000, 29_400, 40_004, 100_000, 133_333, 399_999, 1_000_000];
  for (const total of totals) {
    it(`reconciles exactly for a hall total of ₹${total}`, () => {
      const b = calculateBookingPayment({ hallTotal: total, commissionRate: 2.5 });
      // Commission + owner net always equals the advance — paise-exact.
      expect(b.paise.commission + b.paise.ownerNetAdvance).toBe(b.paise.advance);
      // Advance + fee + GST always equals the customer total — paise-exact.
      expect(b.paise.advance + b.paise.platformFee + b.paise.platformFeeGst)
        .toBe(b.paise.customerTotal);
      // The commission is charged on the HALL TOTAL, never the advance.
      expect(b.paise.commission).toBe(Math.floor((b.paise.hallTotal * 250) / 10_000));
      // It still has to fit inside the advance it is retained from.
      expect(b.paise.commission).toBeGreaterThanOrEqual(0);
      expect(b.paise.commission).toBeLessThan(b.paise.advance);
      // Rupee figures are the paise figures exactly (no float drift).
      expect(toPaise(b.commissionAmount)).toBe(b.paise.commission);
      expect(toPaise(b.ownerNetAdvance)).toBe(b.paise.ownerNetAdvance);
      expect(toPaise(b.customerTotal)).toBe(b.paise.customerTotal);
    });
  }

  it("commission rounds DOWN deterministically (never rounds in Hallnect's favour)", () => {
    // ₹40,004 hall at 2.5% = ₹1,000.10 exactly; ₹40,005 → ₹1,000.125 → floor.
    expect(calculateBookingPayment({ hallTotal: 40_004, commissionRate: 2.5 }).paise.commission)
      .toBe(100_010);
    expect(calculateBookingPayment({ hallTotal: 40_005, commissionRate: 2.5 }).paise.commission)
      .toBe(100_012);
  });

  it("uses the same integer formula as the shared primitive (no duplicated math)", () => {
    const b = calculateBookingPayment({ hallTotal: 29_400, commissionRate: 2.5 });
    expect(b.paise.commission).toBe(commissionPaiseOn(toPaise(29_400), 2.5));
  });

  it("honours an explicitly captured advance while still charging on the hall price", () => {
    // Verification/webhook replays pass the advance that was really captured.
    const b = calculateBookingPayment({
      hallTotal: 100_000, advanceAmount: 30_000, commissionRate: 2.5,
    });
    expect(b.advanceAmount).toBe(30_000);
    expect(b.commissionAmount).toBe(2_500);      // base is still the hall price
    expect(b.ownerNetAdvance).toBe(27_500);
  });

  it("REFUSES when the commission cannot fit inside the advance", () => {
    // The failure mode the new base introduces: the rate is applied to a bigger
    // number than the pot it comes out of, so a misconfigured rate can cross it.
    // Better to throw at creation than to mint a booking that pays the owner
    // nothing — or a negative amount.
    expect(() => calculateBookingPayment({ hallTotal: 100_000, commissionRate: 25 })).toThrow(/commission/i);
    expect(() => calculateBookingPayment({ hallTotal: 100_000, commissionRate: 30 })).toThrow();
    // A tiny captured advance against a large hall price crosses it too.
    expect(() => calculateBookingPayment({
      hallTotal: 100_000, advanceAmount: 1_000, commissionRate: 2.5,
    })).toThrow();
  });

  it("allows a rate right up to, but not including, the advance percentage", () => {
    // 24.9% of the hall price still fits inside a 25% advance; 25% does not.
    expect(() => calculateBookingPayment({ hallTotal: 100_000, commissionRate: 24.9 })).not.toThrow();
  });

  it("default commission rate is 2.5%", () => {
    expect(DEFAULT_COMMISSION_PERCENT).toBe(2.5);
  });

  it("platform fee is a flat ₹200", () => {
    expect(PLATFORM_FEE_RUPEES).toBe(200);
  });

  it("rejects a zero or negative hall total", () => {
    expect(() => calculateBookingPayment({ hallTotal: 0, commissionRate: 2.5 })).toThrow();
    expect(() => calculateBookingPayment({ hallTotal: -5, commissionRate: 2.5 })).toThrow();
  });

  it("rejects an out-of-range rate (defense against a corrupted setting)", () => {
    expect(() => calculateBookingPayment({ hallTotal: 100_000, commissionRate: -1 })).toThrow();
    expect(() => calculateBookingPayment({ hallTotal: 100_000, commissionRate: 101 })).toThrow();
  });
});

describe("advanceFromTotal", () => {
  it("is 25% of the hall total, rounded", () => {
    expect(advanceFromTotal(40_000)).toBe(10_000);
    expect(advanceFromTotal(29_400)).toBe(7_350);
    expect(advanceFromTotal(801)).toBe(200);
  });
  it("never returns less than ₹1", () => {
    expect(advanceFromTotal(0)).toBe(1);
    expect(advanceFromTotal(2)).toBe(1);
  });
});

describe("calculateRefund — platform fee is never refundable", () => {
  it("full-advance refund keeps the ₹200 fee", () => {
    const r = calculateRefund({ advanceAmount: 10_000, platformFee: 200, refundPercentOfAdvance: 100 });
    expect(r.refundableAmount).toBe(10_000);
    expect(r.nonRefundablePlatformFee).toBe(200);
    expect(r.advanceWithheld).toBe(0);
  });

  it("partial refund scales the ADVANCE only, fee still retained", () => {
    const r = calculateRefund({ advanceAmount: 10_000, platformFee: 200, refundPercentOfAdvance: 50 });
    expect(r.refundableAmount).toBe(5_000);
    expect(r.nonRefundablePlatformFee).toBe(200);
    expect(r.advanceWithheld).toBe(5_000);
  });

  it("zero-percent policy refunds nothing but still reports the retained fee", () => {
    const r = calculateRefund({ advanceAmount: 10_000, platformFee: 200, refundPercentOfAdvance: 0 });
    expect(r.refundableAmount).toBe(0);
    expect(r.advanceWithheld).toBe(10_000);
    expect(r.nonRefundablePlatformFee).toBe(200);
  });

  it("legacy booking with no fee refunds the advance and retains ₹0", () => {
    const r = calculateRefund({ advanceAmount: 7_350, platformFee: 0, refundPercentOfAdvance: 100 });
    expect(r.refundableAmount).toBe(7_350);
    expect(r.nonRefundablePlatformFee).toBe(0);
  });

  it("refund can never exceed the advance (fee excluded from the base)", () => {
    const r = calculateRefund({ advanceAmount: 10_000, platformFee: 200, refundPercentOfAdvance: 100 });
    expect(r.refundableAmount + r.advanceWithheld).toBe(10_000);
    expect(r.refundableAmount).toBeLessThanOrEqual(10_000);
  });

  it("rejects an out-of-range percent", () => {
    expect(() => calculateRefund({ advanceAmount: 1_000, platformFee: 200, refundPercentOfAdvance: -1 })).toThrow();
    expect(() => calculateRefund({ advanceAmount: 1_000, platformFee: 200, refundPercentOfAdvance: 101 })).toThrow();
  });

  it("owner/platform-initiated cancellation returns the fee too (policy flag)", () => {
    const r = calculateRefund({
      advanceAmount: 10_000, platformFee: 200,
      refundPercentOfAdvance: 100, refundPlatformFee: true,
    });
    expect(r.refundableAmount).toBe(10_200);
    expect(r.nonRefundablePlatformFee).toBe(0);
    expect(r.advanceWithheld).toBe(0);
  });
});

describe("computeOwnerShare — the split never hands the owner the platform fee", () => {
  it("owner nets advance − commission for the spec example", () => {
    // advance ₹10,000, commission ₹250 → owner ₹9,750. The caller feeds the
    // ADVANCE (payments.advance_amount), never payments.amount (₹10,200).
    const share = computeOwnerShare({
      advance: 10_000, commissionAmount: 250, bookingPlatformFee: null,
    });
    expect(share).toEqual({ ok: true, commission: 250, ownerAmount: 9_750 });
  });

  it("refuses when the commission is unknown (never pays the full advance)", () => {
    const share = computeOwnerShare({ advance: 10_000, commissionAmount: null, bookingPlatformFee: null });
    expect(share.ok).toBe(false);
  });

  it("refuses when commission exceeds the advance", () => {
    const share = computeOwnerShare({ advance: 100, commissionAmount: 250, bookingPlatformFee: null });
    expect(share.ok).toBe(false);
  });

  it("falls back to the booking's commission snapshot", () => {
    const share = computeOwnerShare({ advance: 5_000, commissionAmount: null, bookingPlatformFee: 125 });
    expect(share).toEqual({ ok: true, commission: 125, ownerAmount: 4_875 });
  });
});

describe("checkout preview matches the actual charge", () => {
  // BookingFlow previews `advanceFromTotal(total) + PLATFORM_FEE_RUPEES`;
  // startPaymentForBooking charges the booking's stored advance + the same fee.
  // Both go through these helpers, so the preview can never round differently
  // from the money that leaves the customer's account.
  const hallPrices = [200, 1_500, 12_000, 29_400, 40_000, 55_555, 125_000, 999_999];
  // Both fee values: the standard fee AND a coupon-waived one. This is exactly
  // the invariant a coupon touches, so covering only the default would leave
  // the discounted path — the one where the customer is watching a number
  // change — untested.
  for (const fee of [PLATFORM_FEE_RUPEES, 0]) {
    for (const total of hallPrices) {
      it(`hall total ₹${total} at a ₹${fee} fee: previewed total equals the charged total`, () => {
        const advance = advanceFromTotal(total);
        // Mirrors BookingFlow exactly: cap the fee against the advance, then tax
        // the capped figure. Both sides call cappedPlatformFeeRupees and
        // platformFeeGstRupees rather than each doing their own arithmetic —
        // that shared call is what keeps a float in the browser from disagreeing
        // with the paise-integer charge. The two smallest hall prices here are
        // the ones where the cap actually bites.
        const previewFee = cappedPlatformFeeRupees(advance, fee);
        const previewed = advance + previewFee + platformFeeGstRupees(previewFee);
        const charged = calculateBookingPayment({
          hallTotal: total, advanceAmount: advance, commissionRate: 2.5,
          platformFeeRupees: fee,
        }).customerTotal;
        expect(previewed).toBe(charged);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// COUPON — a waived platform fee.
//
// The whole feature is "make platformFee 0 and change nothing else". These
// tests pin the "nothing else": above all that the owner's money is bit-identical
// with and without a coupon, because Hallnect absorbs 100% of the discount.
// ─────────────────────────────────────────────────────────────────────────────
describe("platform fee waiver", () => {
  const base = { hallTotal: 100_000, advanceAmount: 25_000, commissionRate: 2.5 };

  it("defaults to the standard fee when no override is given", () => {
    const r = calculateBookingPayment(base);
    expect(r.platformFee).toBe(200);
    expect(r.paise.platformFee).toBe(20_000);
  });

  it("a zero fee makes the customer total the advance alone", () => {
    const r = calculateBookingPayment({ ...base, platformFeeRupees: 0 });
    expect(r.platformFee).toBe(0);
    expect(r.paise.platformFee).toBe(0);
    expect(r.customerTotal).toBe(r.advanceAmount);
    expect(r.paise.customerTotal).toBe(r.paise.advance);
  });

  it("keeps the paise invariant exact at a zero fee", () => {
    for (const hallTotal of [1, 33_333, 100_001]) {
      for (const advancePercent of [1, 25, 100]) {
        const r = calculateBookingPayment({
          hallTotal, advancePercent, commissionRate: 0.5, platformFeeRupees: 0,
        });
        expect(Number.isInteger(r.paise.customerTotal)).toBe(true);
        expect(r.paise.advance + r.paise.platformFee).toBe(r.paise.customerTotal);
      }
    }
  });

  // THE OWNER-MONEY INVARIANT. If this ever fails, a coupon is being paid for
  // by the venue instead of by Hallnect.
  it("leaves the commission and the owner's payout bit-identical", () => {
    const full   = calculateBookingPayment(base);
    const waived = calculateBookingPayment({ ...base, platformFeeRupees: 0 });
    expect(waived.commissionAmount).toBe(full.commissionAmount);
    expect(waived.ownerNetAdvance).toBe(full.ownerNetAdvance);
    expect(waived.paise.commission).toBe(full.paise.commission);
    expect(waived.paise.ownerNetAdvance).toBe(full.paise.ownerNetAdvance);
    expect(waived.advanceAmount).toBe(full.advanceAmount);
  });

  it("keeps the rupee field and its paise twin in agreement", () => {
    for (const fee of [200, 0, 1]) {
      const r = calculateBookingPayment({ ...base, platformFeeRupees: fee });
      expect(r.platformFee * 100).toBe(r.paise.platformFee);
    }
  });

  // A coupon is a DISCOUNT. Nothing may use this parameter to charge more.
  it("refuses any fee above the standard one, or a nonsense value", () => {
    for (const bad of [201, 1_000, -1, NaN, Infinity]) {
      expect(() => calculateBookingPayment({ ...base, platformFeeRupees: bad }))
        .toThrow(RangeError);
    }
  });

  it("still refuses a commission that exceeds the advance when the fee is waived", () => {
    expect(() => calculateBookingPayment({
      hallTotal: 100_000, advanceAmount: 1_000, commissionRate: 2.5, platformFeeRupees: 0,
    })).toThrow(RangeError);
  });

  it("refunds nothing extra on a zero-fee booking, whichever policy applies", () => {
    for (const refundPlatformFee of [true, false]) {
      const r = calculateRefund({
        advanceAmount: 25_000, platformFee: 0,
        refundPercentOfAdvance: 100, refundPlatformFee,
      });
      expect(r.nonRefundablePlatformFee).toBe(0);
      expect(r.refundableAmount).toBe(25_000);
    }
  });
});

describe("server-authoritative amounts (frontend manipulation)", () => {
  it("the calculation takes no client input — identical output for identical DB state", () => {
    // Every caller derives advance from the DB total and the rate from
    // platform_settings; there is no code path from request body to these
    // numbers. This pins that the function itself is deterministic.
    const a = calculateBookingPayment({ hallTotal: 40_000, commissionRate: 2.5 });
    const b = calculateBookingPayment({ hallTotal: 40_000, commissionRate: 2.5 });
    expect(a).toEqual(b);
    expect(a.customerTotal).toBe(10_236); // any tampered client figure is ignored by construction
  });
});

describe("END TO END — the money actually reaches the right accounts", () => {
  // Walks the real functions in the order production calls them, for the
  // business owner's worked example. This is the test that would have caught
  // the advance-vs-hall-price base error, and it also proves nothing leaks:
  // what the customer pays equals what the owner and Hallnect receive.
  const HALL = 100_000;
  const RATE = 2.5;

  // 1. Booking creation writes this snapshot onto the booking row.
  const pay = calculateBookingPayment({ hallTotal: HALL, commissionRate: RATE });
  // 2. Owner accepts → payOwnerOnAcceptance computes the vendor share.
  const share = computeOwnerShare({
    advance: pay.advanceAmount,
    commissionAmount: pay.commissionAmount,
    bookingPlatformFee: null,
  });
  // 3. The paise ledger is built from the SAME snapshot, never recomputed.
  const ledger = splitFromParts(pay.paise.advance, pay.paise.commission, RATE);

  it("charges the customer the advance plus the flat fee plus tax on that fee, and nothing else", () => {
    expect(pay.advanceAmount).toBe(25_000);
    expect(pay.platformFee).toBe(200);
    expect(pay.platformFeeGst).toBe(36);
    expect(pay.customerTotal).toBe(25_236);
  });

  it("pays the owner ₹22,500 — the advance minus commission on the HALL price", () => {
    expect(share.ok).toBe(true);
    if (share.ok) {
      expect(share.commission).toBe(2_500);
      expect(share.ownerAmount).toBe(22_500);
    }
  });

  it("leaves Hallnect ₹2,700 — the ₹2,500 commission plus the ₹200 fee", () => {
    expect(pay.commissionAmount + pay.platformFee).toBe(2_700);
  });

  it("loses nothing: owner + Hallnect + the taxman === what the customer paid", () => {
    // The conservation law, restated for a GST-registered platform. The
    // customer's money now lands in THREE places, not two, and the third is not
    // Hallnect's: the ₹36 is collected on the government's behalf and remitted.
    // Counting it as revenue is exactly the error this test exists to catch —
    // it would overstate earnings and understate the GST liability by the same
    // amount, which reconciles perfectly right up until the return is filed.
    const hallnect = pay.commissionAmount + pay.platformFee;
    const taxman   = pay.platformFeeGst;
    expect((share.ok ? share.ownerAmount : 0) + hallnect + taxman).toBe(pay.customerTotal);
  });

  it("the payout and the ledger both agree with the one calculation", () => {
    // Three independent code paths, one set of numbers. If any of them starts
    // re-deriving the commission for itself, this fails.
    expect(share.ok && toPaise(share.ownerAmount)).toBe(pay.paise.ownerNetAdvance);
    expect(ledger.commissionPaise).toBe(pay.paise.commission);
    expect(ledger.ownerPaise).toBe(pay.paise.ownerNetAdvance);
    expect(ledger.grossPaise).toBe(pay.paise.advance);
  });

  it("the ₹200 fee is never inside the split gross, so it cannot reach the owner", () => {
    expect(ledger.grossPaise).toBe(pay.paise.advance);
    expect(ledger.grossPaise).not.toBe(pay.paise.customerTotal);
    expect(ledger.commissionPaise + ledger.ownerPaise).toBe(pay.paise.advance);
  });
});

describe("advance percentage is admin-configurable", () => {
  // The setting existed in the admin UI but was read by nothing: the advance
  // was hardcoded at 25%. It is now a real parameter, so these pin that the
  // rate actually moves the money AND that the default still matches the
  // constant — a fallback that disagrees would reprice bookings on a failed
  // settings read.
  it("defaults to the compile-time constant when no rate is given", () => {
    expect(advanceFromTotal(100_000)).toBe(25_000);
    expect(advanceFromTotal(100_000, DEFAULT_ADVANCE_PERCENT)).toBe(25_000);
    expect(DEFAULT_ADVANCE_PERCENT).toBe(25);
  });

  it("honours a different configured rate", () => {
    expect(advanceFromTotal(100_000, 20)).toBe(20_000);
    expect(advanceFromTotal(100_000, 50)).toBe(50_000);
    expect(advanceFromTotal(29_400, 25)).toBe(7_350);
  });

  it("still never returns less than ₹1", () => {
    expect(advanceFromTotal(2, 20)).toBe(1);
  });

  it("rejects a nonsensical rate rather than charging a strange advance", () => {
    expect(() => advanceFromTotal(100_000, 0)).toThrow();
    expect(() => advanceFromTotal(100_000, -5)).toThrow();
    expect(() => advanceFromTotal(100_000, 101)).toThrow();
  });

  it("commission is still charged on the HALL PRICE when the advance rate moves", () => {
    // The two rates are independent: dropping the advance to 20% must not
    // shrink the commission, which is a percentage of the hall price.
    const b = calculateBookingPayment({
      hallTotal: 100_000, advancePercent: 20, commissionRate: 2.5,
    });
    expect(b.advanceAmount).toBe(20_000);
    expect(b.commissionAmount).toBe(2_500);
    expect(b.ownerNetAdvance).toBe(17_500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The cancel dialog previews the refund a customer will get. It MUST agree with
// what the server actually applies — a dialog that promises more than
// calculateRefund pays out is worse than showing nothing.
// ─────────────────────────────────────────────────────────────────────────────
describe("cancel preview matches the server's refund", () => {
  const CASES = [
    { days: 40, percent: 100 },
    { days: 31, percent: 100 },
    { days: 30, percent: 75 },
    { days: 15, percent: 75 },
    { days: 14, percent: 50 },
    { days: 7,  percent: 50 },
    { days: 6,  percent: 0 },
    { days: 0,  percent: 0 },
  ];

  for (const c of CASES) {
    it(`${c.days} days out → ${c.percent}% of the advance`, () => {
      expect(customerRefundPercent(c.days)).toBe(c.percent);

      // The dialog floors the same way calculateRefund does, so the previewed
      // figure is the figure paid.
      const advance = 25_000;
      const previewed = Math.floor((advance * c.percent) / 100);
      const actual = calculateRefund({
        advanceAmount: advance,
        platformFee: 200,
        refundPercentOfAdvance: c.percent,
      }).refundableAmount;
      expect(previewed).toBe(actual);
    });
  }

  it("counts the days the same way the server does", () => {
    // Server: daysBetweenInclusive(today, event) - 1. The dialog's helper must
    // land on the same integer or the two quote different tiers at a boundary.
    expect(daysUntilEventFromToday("2026-10-01", "2026-09-01")).toBe(30);
    expect(daysUntilEventFromToday("2026-09-08", "2026-09-01")).toBe(7);
    expect(daysUntilEventFromToday("2026-09-01", "2026-09-01")).toBe(0);
    // A past date must never produce a negative that reads as a higher tier.
    expect(daysUntilEventFromToday("2026-08-01", "2026-09-01")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What the PUBLIC PAGES are allowed to say the fee is.
//
// Every policy page, FAQ and marketing line quoted a bare "₹200 platform fee"
// while checkout charged ₹236, because each surface restated the number instead
// of importing it. The discrepancy appeared the moment GST was introduced and
// nothing failed — copy has no type checker. These pin the disclosure to the
// engine, so a fee or rate change breaks a test rather than a promise.
// ─────────────────────────────────────────────────────────────────────────────

describe("the fee a customer is quoted", () => {
  it("is the fee plus its GST, not the bare fee", async () => {
    const m = await import("@/lib/booking-payment");
    expect(m.PLATFORM_FEE_RUPEES).toBe(200);
    expect(m.PLATFORM_FEE_GST_RUPEES).toBe(36);
    expect(m.PLATFORM_FEE_TOTAL_RUPEES).toBe(236);
  });

  it("derives the total rather than hardcoding it", async () => {
    const m = await import("@/lib/booking-payment");
    // The relationship, not the literal — this is what survives a rate change.
    expect(m.PLATFORM_FEE_TOTAL_RUPEES).toBe(
      m.PLATFORM_FEE_RUPEES + m.platformFeeGstRupees(m.PLATFORM_FEE_RUPEES),
    );
  });

  it("states both halves, so nobody can quote only the ₹200", async () => {
    const m = await import("@/lib/booking-payment");
    const s = m.platformFeeDisclosure();
    expect(s).toContain("₹200");
    expect(s).toContain("₹236");
    expect(s).toContain("18% GST");
  });

  it("never quotes more than the customer is actually charged", async () => {
    const m = await import("@/lib/booking-payment");
    // On a small booking the cap bites, so the headline figure is an UPPER
    // bound and the venue page must show the capped one instead. A ₹100 slot:
    // advance ₹25 → fee ₹6.25, not ₹200.
    const smallAdvance = 25;
    const capped = m.cappedPlatformFeeRupees(smallAdvance);
    expect(capped).toBeLessThan(m.PLATFORM_FEE_RUPEES);
    expect(capped + m.platformFeeGstRupees(capped)).toBeLessThan(m.PLATFORM_FEE_TOTAL_RUPEES);
    // And on any real venue the flat fee is the binding one.
    expect(m.cappedPlatformFeeRupees(800)).toBe(m.PLATFORM_FEE_RUPEES);
  });
});
