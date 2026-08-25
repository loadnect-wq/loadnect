// Tests for the authoritative booking-money calculation (lib/booking-payment).
// The three worked examples are the acceptance cases from the business spec —
// if any of these change, the business model changed, not the code.

import { describe, it, expect } from "vitest";
import {
  calculateBookingPayment,
  calculateRefund,
  advanceFromTotal,
  PLATFORM_FEE_RUPEES,
  DEFAULT_COMMISSION_PERCENT,
} from "@/lib/booking-payment";
import { computeCommissionSplit, toPaise } from "@/lib/money";
import { computeOwnerShare } from "@/lib/owner-payout";

describe("calculateBookingPayment — spec acceptance cases", () => {
  it("advance ₹10,000 → fee ₹200, commission ₹250, total ₹10,200, owner ₹9,750", () => {
    const b = calculateBookingPayment({ advanceAmount: 10_000, commissionRate: 2.5 });
    expect(b.platformFee).toBe(200);
    expect(b.commissionAmount).toBe(250);
    expect(b.customerTotal).toBe(10_200);
    expect(b.ownerNetAdvance).toBe(9_750);
  });

  it("advance ₹20,000 → fee ₹200, commission ₹500, total ₹20,200, owner ₹19,500", () => {
    const b = calculateBookingPayment({ advanceAmount: 20_000, commissionRate: 2.5 });
    expect(b.platformFee).toBe(200);
    expect(b.commissionAmount).toBe(500);
    expect(b.customerTotal).toBe(20_200);
    expect(b.ownerNetAdvance).toBe(19_500);
  });

  it("advance ₹5,000 → fee ₹200, commission ₹125, total ₹5,200, owner ₹4,875", () => {
    const b = calculateBookingPayment({ advanceAmount: 5_000, commissionRate: 2.5 });
    expect(b.platformFee).toBe(200);
    expect(b.commissionAmount).toBe(125);
    expect(b.customerTotal).toBe(5_200);
    expect(b.ownerNetAdvance).toBe(4_875);
  });
});

describe("calculateBookingPayment — invariants", () => {
  const advances = [1, 3, 999, 1_000, 5_000, 7_350, 10_001, 33_333, 99_999, 250_000];
  for (const advance of advances) {
    it(`reconciles exactly for advance ₹${advance}`, () => {
      const b = calculateBookingPayment({ advanceAmount: advance, commissionRate: 2.5 });
      // Commission + owner net always equals the advance — paise-exact.
      expect(b.paise.commission + b.paise.ownerNetAdvance).toBe(b.paise.advance);
      // Advance + fee always equals the customer total — paise-exact.
      expect(b.paise.advance + b.paise.platformFee).toBe(b.paise.customerTotal);
      // The commission never exceeds the advance and is never negative.
      expect(b.paise.commission).toBeGreaterThanOrEqual(0);
      expect(b.paise.commission).toBeLessThanOrEqual(b.paise.advance);
      // Rupee figures are the paise figures exactly (no float drift).
      expect(toPaise(b.commissionAmount)).toBe(b.paise.commission);
      expect(toPaise(b.ownerNetAdvance)).toBe(b.paise.ownerNetAdvance);
      expect(toPaise(b.customerTotal)).toBe(b.paise.customerTotal);
    });
  }

  it("commission rounds DOWN deterministically (never charges the owner a fraction up)", () => {
    // ₹10,001 advance at 2.5% = ₹250.025 → floor to ₹250.02.
    const b = calculateBookingPayment({ advanceAmount: 10_001, commissionRate: 2.5 });
    expect(b.paise.commission).toBe(25_002);
    expect(b.paise.ownerNetAdvance).toBe(975_098);
  });

  it("default commission rate is 2.5%", () => {
    expect(DEFAULT_COMMISSION_PERCENT).toBe(2.5);
  });

  it("platform fee is a flat ₹200", () => {
    expect(PLATFORM_FEE_RUPEES).toBe(200);
  });

  it("matches computeCommissionSplit exactly (single formula, no duplication)", () => {
    const b = calculateBookingPayment({ advanceAmount: 7_350, commissionRate: 2.5 });
    const s = computeCommissionSplit(735_000, 2.5);
    expect(b.paise.commission).toBe(s.commissionPaise);
    expect(b.paise.ownerNetAdvance).toBe(s.ownerPaise);
  });

  it("rejects a zero or negative advance", () => {
    expect(() => calculateBookingPayment({ advanceAmount: 0, commissionRate: 2.5 })).toThrow();
    expect(() => calculateBookingPayment({ advanceAmount: -5, commissionRate: 2.5 })).toThrow();
  });

  it("rejects an out-of-range rate (defense against a corrupted setting)", () => {
    expect(() => calculateBookingPayment({ advanceAmount: 1_000, commissionRate: -1 })).toThrow();
    expect(() => calculateBookingPayment({ advanceAmount: 1_000, commissionRate: 101 })).toThrow();
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

describe("server-authoritative amounts (frontend manipulation)", () => {
  it("the calculation takes no client input — identical output for identical DB state", () => {
    // Every caller derives advance from the DB total and the rate from
    // platform_settings; there is no code path from request body to these
    // numbers. This pins that the function itself is deterministic.
    const a = calculateBookingPayment({ advanceAmount: 10_000, commissionRate: 2.5 });
    const b = calculateBookingPayment({ advanceAmount: 10_000, commissionRate: 2.5 });
    expect(a).toEqual(b);
    expect(a.customerTotal).toBe(10_200); // any tampered client figure is ignored by construction
  });
});
