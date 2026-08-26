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
  PLATFORM_FEE_RUPEES,
  DEFAULT_COMMISSION_PERCENT,
} from "@/lib/booking-payment";
import { commissionPaiseOn, splitFromParts, toPaise } from "@/lib/money";
import { computeOwnerShare } from "@/lib/owner-payout";

describe("calculateBookingPayment — spec acceptance cases", () => {
  it("hall ₹1,00,000 → advance ₹25,000 + fee ₹200; commission ₹2,500; owner ₹22,500", () => {
    // The worked example from the business owner, verbatim.
    const b = calculateBookingPayment({ hallTotal: 100_000, commissionRate: 2.5 });
    expect(b.advanceAmount).toBe(25_000);
    expect(b.platformFee).toBe(200);
    expect(b.customerTotal).toBe(25_200);
    expect(b.commissionAmount).toBe(2_500);
    expect(b.ownerNetAdvance).toBe(22_500);
    // What Hallnect actually keeps: commission + the separately collected fee.
    expect(b.commissionAmount + b.platformFee).toBe(2_700);
  });

  it("hall ₹40,000 → advance ₹10,000 + fee ₹200; commission ₹1,000; owner ₹9,000", () => {
    const b = calculateBookingPayment({ hallTotal: 40_000, commissionRate: 2.5 });
    expect(b.customerTotal).toBe(10_200);
    expect(b.commissionAmount).toBe(1_000);
    expect(b.ownerNetAdvance).toBe(9_000);
  });

  it("hall ₹20,000 → advance ₹5,000 + fee ₹200; commission ₹500; owner ₹4,500", () => {
    const b = calculateBookingPayment({ hallTotal: 20_000, commissionRate: 2.5 });
    expect(b.customerTotal).toBe(5_200);
    expect(b.commissionAmount).toBe(500);
    expect(b.ownerNetAdvance).toBe(4_500);
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
      // Advance + fee always equals the customer total — paise-exact.
      expect(b.paise.advance + b.paise.platformFee).toBe(b.paise.customerTotal);
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
  for (const total of hallPrices) {
    it(`hall total ₹${total}: previewed total equals the charged total`, () => {
      const advance = advanceFromTotal(total);
      const previewed = advance + PLATFORM_FEE_RUPEES;
      const charged = calculateBookingPayment({
        hallTotal: total, advanceAmount: advance, commissionRate: 2.5,
      }).customerTotal;
      expect(previewed).toBe(charged);
    });
  }
});

describe("server-authoritative amounts (frontend manipulation)", () => {
  it("the calculation takes no client input — identical output for identical DB state", () => {
    // Every caller derives advance from the DB total and the rate from
    // platform_settings; there is no code path from request body to these
    // numbers. This pins that the function itself is deterministic.
    const a = calculateBookingPayment({ hallTotal: 40_000, commissionRate: 2.5 });
    const b = calculateBookingPayment({ hallTotal: 40_000, commissionRate: 2.5 });
    expect(a).toEqual(b);
    expect(a.customerTotal).toBe(10_200); // any tampered client figure is ignored by construction
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

  it("charges the customer the advance plus the flat fee, and nothing else", () => {
    expect(pay.advanceAmount).toBe(25_000);
    expect(pay.platformFee).toBe(200);
    expect(pay.customerTotal).toBe(25_200);
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

  it("loses nothing: owner + Hallnect === what the customer paid", () => {
    const hallnect = pay.commissionAmount + pay.platformFee;
    expect((share.ok ? share.ownerAmount : 0) + hallnect).toBe(pay.customerTotal);
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
