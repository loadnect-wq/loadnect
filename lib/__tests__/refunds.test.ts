// The cancellation schedule must match the published /refund-policy table
// exactly — these tests are the guard against the code and the legal page
// drifting apart.

import { describe, it, expect } from "vitest";
import { customerRefundPercent, CUSTOMER_REFUND_SCHEDULE } from "@/lib/refunds";
import { calculateRefund } from "@/lib/booking-payment";

describe("customerRefundPercent — published schedule", () => {
  it("more than 30 days before the event → 100% of the advance", () => {
    expect(customerRefundPercent(31)).toBe(100);
    expect(customerRefundPercent(90)).toBe(100);
  });

  it("15–30 days → 75%", () => {
    expect(customerRefundPercent(30)).toBe(75);
    expect(customerRefundPercent(15)).toBe(75);
  });

  it("7–14 days → 50%", () => {
    expect(customerRefundPercent(14)).toBe(50);
    expect(customerRefundPercent(7)).toBe(50);
  });

  it("less than 7 days → nothing", () => {
    expect(customerRefundPercent(6)).toBe(0);
    expect(customerRefundPercent(0)).toBe(0);
  });

  it("is monotonic — cancelling earlier never refunds less", () => {
    for (let d = 0; d < 120; d++) {
      expect(customerRefundPercent(d + 1)).toBeGreaterThanOrEqual(customerRefundPercent(d));
    }
  });

  it("the schedule is the single editable definition of the policy", () => {
    expect(CUSTOMER_REFUND_SCHEDULE.map((t) => t.percentOfAdvance)).toEqual([100, 75, 50, 0]);
  });
});

describe("refund composition by initiator", () => {
  const advance = 10_000, platformFee = 200;

  it("customer cancels 40 days out: full advance back, ₹200 fee retained", () => {
    const r = calculateRefund({
      advanceAmount: advance, platformFee,
      refundPercentOfAdvance: customerRefundPercent(40),
      refundPlatformFee: false,
    });
    expect(r.refundableAmount).toBe(10_000);
    expect(r.nonRefundablePlatformFee).toBe(200);
  });

  it("customer cancels 10 days out: half the advance, ₹200 fee still retained", () => {
    const r = calculateRefund({
      advanceAmount: advance, platformFee,
      refundPercentOfAdvance: customerRefundPercent(10),
      refundPlatformFee: false,
    });
    expect(r.refundableAmount).toBe(5_000);
    expect(r.advanceWithheld).toBe(5_000);
    expect(r.nonRefundablePlatformFee).toBe(200);
  });

  it("customer cancels 2 days out: nothing back, fee retained", () => {
    const r = calculateRefund({
      advanceAmount: advance, platformFee,
      refundPercentOfAdvance: customerRefundPercent(2),
      refundPlatformFee: false,
    });
    expect(r.refundableAmount).toBe(0);
    expect(r.nonRefundablePlatformFee).toBe(200);
  });

  it("venue declines: everything back INCLUDING the fee, whatever the timing", () => {
    const r = calculateRefund({
      advanceAmount: advance, platformFee,
      refundPercentOfAdvance: 100, refundPlatformFee: true,
    });
    expect(r.refundableAmount).toBe(10_200);
    expect(r.nonRefundablePlatformFee).toBe(0);
  });

  it("a refund never exceeds what the customer actually paid", () => {
    for (const days of [0, 5, 7, 14, 15, 30, 31, 365]) {
      const r = calculateRefund({
        advanceAmount: advance, platformFee,
        refundPercentOfAdvance: customerRefundPercent(days),
        refundPlatformFee: false,
      });
      expect(r.refundableAmount).toBeLessThanOrEqual(advance + platformFee);
      expect(r.refundableAmount + r.advanceWithheld).toBe(advance);
    }
  });
});
