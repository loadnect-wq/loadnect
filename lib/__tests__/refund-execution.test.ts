// Refund execution.
//
// Refunds are the one money path where the platform pays OUT to a customer, and
// a duplicate cannot be recalled. These pin the two things that prevent that:
// Cashfree's status vocabulary is read correctly, and "in flight" is never
// mistaken for "failed" (which would invite an admin to send a second one).

import { describe, it, expect } from "vitest";
import { classifyRefundStatus } from "@/lib/cashfree";
import { customerRefundPercent, CUSTOMER_REFUND_SCHEDULE } from "@/lib/refunds";
import { calculateRefund, PLATFORM_FEE_RUPEES } from "@/lib/booking-payment";

describe("Cashfree refund status", () => {
  it("treats SUCCESS as completed", () => {
    expect(classifyRefundStatus("SUCCESS")).toEqual({ state: "completed" });
    expect(classifyRefundStatus("success")).toEqual({ state: "completed" });
  });

  it("treats PENDING and ONHOLD as IN FLIGHT, never as failed", () => {
    // The dangerous mistake: reading "not yet done" as "did not happen" and
    // issuing a second refund for the same booking.
    expect(classifyRefundStatus("PENDING").state).toBe("processing");
    expect(classifyRefundStatus("ONHOLD").state).toBe("processing");
  });

  it("treats only explicit failures as failed", () => {
    expect(classifyRefundStatus("FAILED").state).toBe("failed");
    expect(classifyRefundStatus("CANCELLED").state).toBe("failed");
  });

  it("defaults an UNKNOWN status to processing, not failed", () => {
    // Unrecognised means we do not know. Assuming failure is the option that
    // can send money twice, so it is not the default.
    expect(classifyRefundStatus(undefined).state).toBe("processing");
    expect(classifyRefundStatus("SOMETHING_NEW").state).toBe("processing");
  });
});

describe("published cancellation schedule", () => {
  it("matches the refund policy table exactly", () => {
    expect(customerRefundPercent(60)).toBe(100);
    expect(customerRefundPercent(31)).toBe(100);
    expect(customerRefundPercent(30)).toBe(75);
    expect(customerRefundPercent(15)).toBe(75);
    expect(customerRefundPercent(14)).toBe(50);
    expect(customerRefundPercent(7)).toBe(50);
    expect(customerRefundPercent(6)).toBe(0);
    expect(customerRefundPercent(0)).toBe(0);
  });

  it("is ordered strictly descending, so the tiers cannot overlap", () => {
    const days = CUSTOMER_REFUND_SCHEDULE.map((t) => t.minDaysBeforeEvent);
    expect([...days].sort((a, b) => b - a)).toEqual(days);
  });
});

describe("refund amounts", () => {
  const advance = 25_000;

  it("a customer cancellation keeps the platform fee", () => {
    const r = calculateRefund({
      advanceAmount: advance, platformFee: PLATFORM_FEE_RUPEES,
      refundPercentOfAdvance: 100,
    });
    expect(r.refundableAmount).toBe(25_000);
    expect(r.nonRefundablePlatformFee).toBe(200);
  });

  it("an owner or platform cancellation returns the fee too", () => {
    const r = calculateRefund({
      advanceAmount: advance, platformFee: PLATFORM_FEE_RUPEES,
      refundPercentOfAdvance: 100, refundPlatformFee: true,
    });
    expect(r.refundableAmount).toBe(25_200);
    expect(r.nonRefundablePlatformFee).toBe(0);
  });

  it("a partial refund rounds DOWN, never above the policy", () => {
    const r = calculateRefund({
      advanceAmount: 10_001, platformFee: PLATFORM_FEE_RUPEES,
      refundPercentOfAdvance: 75,
    });
    expect(r.refundableAmount).toBeLessThanOrEqual(10_001 * 0.75);
  });

  it("never refunds more than was taken", () => {
    for (const pct of [0, 25, 50, 75, 100]) {
      const r = calculateRefund({
        advanceAmount: advance, platformFee: PLATFORM_FEE_RUPEES,
        refundPercentOfAdvance: pct, refundPlatformFee: true,
      });
      expect(r.refundableAmount).toBeLessThanOrEqual(advance + PLATFORM_FEE_RUPEES);
      expect(r.refundableAmount).toBeGreaterThanOrEqual(0);
    }
  });

  it("refunded + withheld always reconciles to what was collected", () => {
    for (const pct of [0, 33, 50, 75, 100]) {
      const r = calculateRefund({
        advanceAmount: advance, platformFee: PLATFORM_FEE_RUPEES,
        refundPercentOfAdvance: pct,
      });
      expect(r.refundableAmount + r.advanceWithheld + r.nonRefundablePlatformFee)
        .toBe(advance + PLATFORM_FEE_RUPEES);
    }
  });
});
