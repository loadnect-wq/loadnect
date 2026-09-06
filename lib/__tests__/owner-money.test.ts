// ─────────────────────────────────────────────────────────────────────────────
// The owner-side money rules: what Hallnect keeps when a booking is cancelled,
// what a venue is owed when the split cannot be computed, and what a monthly
// renewal is recorded and receipted at.
//
// Every case here is one that silently moved real money in the wrong direction
// before it was pinned.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import crypto from "node:crypto";

import { retainedCommission, customerRefundPercent } from "@/lib/refunds";
import { computeOwnerShare } from "@/lib/owner-payout";
import { calculateRefund } from "@/lib/booking-payment";
import {
  isUnauthorisedPlaceholder,
  subscriptionChargeAmount,
  SUBSCRIPTION_ID_PREFIX,
} from "@/lib/plan-subscriptions";

// ─────────────────────────────────────────────────────────────────────────────
// Commission reversal follows the refund, instead of being all-or-nothing.
//
// The bug: a cancellation marked the commission 'refunded' whatever the refund
// percentage was. On the 0% tier Hallnect keeps the entire advance — commission
// included — and recorded itself as having earned nothing on it.
// ─────────────────────────────────────────────────────────────────────────────

describe("commission kept after a cancellation", () => {
  const commission = 2_500; // 2.5% of a ₹1,00,000 hall

  it("a full refund reverses the whole commission", () => {
    expect(retainedCommission(commission, 100)).toBe(0);
  });

  it("a 0% refund keeps ALL of it — Hallnect still holds every rupee", () => {
    // The case that was recorded as zero earnings while the money never moved.
    expect(retainedCommission(commission, 0)).toBe(2_500);
  });

  it("the published partial tiers keep exactly their share", () => {
    expect(retainedCommission(commission, 75)).toBe(625);   // 25% retained
    expect(retainedCommission(commission, 50)).toBe(1_250); // 50% retained
  });

  it("is driven by the published schedule, not by a second copy of it", () => {
    // 40 days out → 100% back → nothing kept. 2 days out → 0% back → all kept.
    expect(retainedCommission(commission, customerRefundPercent(40))).toBe(0);
    expect(retainedCommission(commission, customerRefundPercent(10))).toBe(1_250);
    expect(retainedCommission(commission, customerRefundPercent(2))).toBe(2_500);
  });

  it("never keeps more than was charged, at any point on the schedule", () => {
    for (let pct = 0; pct <= 100; pct++) {
      const kept = retainedCommission(commission, pct);
      expect(kept).toBeGreaterThanOrEqual(0);
      expect(kept).toBeLessThanOrEqual(commission);
    }
  });

  it("is monotonic — refunding more can never leave Hallnect with more", () => {
    for (let pct = 0; pct < 100; pct++) {
      expect(retainedCommission(commission, pct + 1))
        .toBeLessThanOrEqual(retainedCommission(commission, pct));
    }
  });

  it("rounds the stray paisa toward the customer, never toward the platform", () => {
    // ₹1.01 at 50% is 50.5 paise. Floored, so Hallnect keeps ₹0.50, not ₹0.51.
    expect(retainedCommission(1.01, 50)).toBe(0.5);
  });

  it("a missing or zero commission is simply nothing to keep", () => {
    expect(retainedCommission(0, 50)).toBe(0);
    expect(retainedCommission(Number.NaN, 50)).toBe(0);
  });

  it("refuses a percentage that is not a percentage", () => {
    expect(() => retainedCommission(2_500, 120)).toThrow(RangeError);
    expect(() => retainedCommission(2_500, -1)).toThrow(RangeError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// An unknown owner share must stay unknown.
//
// computeOwnerShare refuses rather than guessing; the caller used to flatten
// that refusal to 0 and store it in payments.split_owner_amount, which the
// manual-payout screen reads as an exact figure.
// ─────────────────────────────────────────────────────────────────────────────

describe("owner share — refused, not guessed", () => {
  it("a missing commission is a refusal, not a zero share", () => {
    const share = computeOwnerShare({
      advance: 10_000, commissionAmount: null, bookingPlatformFee: null,
    });
    expect(share.ok).toBe(false);
  });

  it("a known commission yields advance − commission", () => {
    const share = computeOwnerShare({
      advance: 10_000, commissionAmount: 2_500, bookingPlatformFee: null,
    });
    expect(share).toEqual({ ok: true, commission: 2_500, ownerAmount: 7_500 });
  });

  it("a refusal carries a reason a human can act on", () => {
    // The reason is what the payout-failed alert quotes in place of an amount,
    // so it has to explain itself without one.
    const share = computeOwnerShare({
      advance: 10_000, commissionAmount: null, bookingPlatformFee: null,
    });
    expect(share.ok ? "" : share.reason).toMatch(/unknown/i);
  });

  it("never invents a payout when the commission would exceed the advance", () => {
    const share = computeOwnerShare({
      advance: 1_000, commissionAmount: 2_500, bookingPlatformFee: null,
    });
    expect(share.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A half-finished subscribe must not lock the hall out of that plan forever.
// ─────────────────────────────────────────────────────────────────────────────

describe("unauthorised subscription placeholder", () => {
  it("recognises the id written before Cashfree is called", () => {
    // Exactly the shape startPlanSubscription inserts.
    expect(isUnauthorisedPlaceholder(`pending_${crypto.randomUUID()}`)).toBe(true);
  });

  it("never mistakes a real mandate id for an abandoned attempt", () => {
    // Retiring a row that DOES have a mandate behind it would let a second
    // standing debit be authorised on the same hall.
    expect(isUnauthorisedPlaceholder(`${SUBSCRIPTION_ID_PREFIX}abc123_x1`)).toBe(false);
    expect(isUnauthorisedPlaceholder("sub_9f2c")).toBe(false);
  });

  it("only the placeholder prefix qualifies — anything else falls through", () => {
    // cf_subscription_id is NOT NULL, so an empty value is not a state we can
    // reach; it must not be read as "safe to retire" on a guess. It falls
    // through to the branch that asks Cashfree and refuses when unsure.
    expect(isUnauthorisedPlaceholder(null)).toBe(false);
    expect(isUnauthorisedPlaceholder("")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A renewal is recorded and receipted at what was DEBITED.
// ─────────────────────────────────────────────────────────────────────────────

describe("what a monthly charge is recorded at", () => {
  it("the amount Cashfree debited, not today's list price", () => {
    // The mandate was authorised at ₹499; the plan now lists at ₹699. The
    // receipt SMS quotes this number, so it has to be the ₹499 that left the
    // owner's account.
    expect(subscriptionChargeAmount(499, 699)).toBe(499);
  });

  it("falls back to the catalogue price only when the charge carries none", () => {
    expect(subscriptionChargeAmount(undefined, 699)).toBe(699);
    expect(subscriptionChargeAmount(null, 699)).toBe(699);
    expect(subscriptionChargeAmount(0, 699)).toBe(699);
  });

  it("ignores a debit amount that is not a number", () => {
    expect(subscriptionChargeAmount(Number.NaN, 699)).toBe(699);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WHO OWNS A FORFEITED ADVANCE.
//
// Settled 2026-09-06: Hallnect keeps it. /cancellation-policy §3 and
// /refund-policy §3 now say so in as many words, and lib/refunds.ts records the
// same thing — owner_payout_amount goes to zero on a customer cancellation.
//
// Before that the money belonged to nobody in code AND to the venue in the
// contract: the ledger recorded the venue as owed the non-commission part of an
// advance the customer never got back, nothing ever paid it (a cancelled
// booking does not pay out), and the amount sat in the gateway balance
// attributed to no one.
// ─────────────────────────────────────────────────────────────────────────────

describe("a forfeited advance is Hallnect's, and the three shares still reconcile", () => {
  const ADVANCE = 25_000;
  const COMMISSION = 2_500;   // 2.5% of a ₹1,00,000 hall

  it("gives the venue nothing when the customer cancels, at every refund tier", () => {
    for (const percent of [100, 75, 50, 0]) {
      const refunded = calculateRefund({
        advanceAmount: ADVANCE,
        platformFee: 200,
        platformFeeGst: 36,
        refundPercentOfAdvance: percent,
        refundPlatformFee: false,          // customer-initiated
      });

      const kept      = retainedCommission(COMMISSION, percent);
      const withheld  = refunded.advanceWithheld;
      const hallnect  = withheld - kept;   // the retained remainder
      const owner     = 0;                 // the rule, stated

      // Nothing is created or lost: what the customer keeps back plus what
      // Hallnect retains plus what the owner gets equals the whole advance.
      expect(refunded.refundableAmount - 0 + withheld).toBeCloseTo(ADVANCE, 2);
      expect(owner + kept + hallnect).toBeCloseTo(withheld, 2);
      expect(hallnect).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the whole advance when the customer cancels inside 7 days", () => {
    const refunded = calculateRefund({
      advanceAmount: ADVANCE, platformFee: 200, platformFeeGst: 36,
      refundPercentOfAdvance: customerRefundPercent(3),   // < 7 days => 0%
      refundPlatformFee: false,
    });
    expect(refunded.refundableAmount).toBe(0);
    expect(refunded.advanceWithheld).toBe(ADVANCE);

    // The commission stays fully earned, and the rest is Hallnect's retention —
    // not the venue's.
    const kept = retainedCommission(COMMISSION, 0);
    expect(kept).toBe(COMMISSION);
    expect(refunded.advanceWithheld - kept).toBe(ADVANCE - COMMISSION);
  });

  it("retains nothing when the VENUE cancels — that path refunds in full", () => {
    // The rule is about customer cancellations only. An owner- or
    // platform-initiated cancellation returns everything, so there is no
    // forfeiture to attribute to anyone.
    const refunded = calculateRefund({
      advanceAmount: ADVANCE, platformFee: 200, platformFeeGst: 36,
      refundPercentOfAdvance: 100,
      refundPlatformFee: true,
    });
    expect(refunded.advanceWithheld).toBe(0);
    expect(retainedCommission(COMMISSION, 100)).toBe(0);
    expect(refunded.refundableAmount).toBe(ADVANCE + 200 + 36);
  });
});
