import { describe, it, expect } from "vitest";
import {
  hallCreateSchema,
  commissionRateSchema,
  HALL_COMMISSION_RATES,
  isAllowedCommissionRate,
  checkCommissionAgainstAdvance,
  MAX_COMMISSION_SHARE_OF_ADVANCE,
} from "@/lib/validation/schemas";
import { calculateBookingPayment, advanceFromTotal } from "@/lib/booking-payment";

/**
 * A complete, valid listing with a commission rate. Mirrors the helper in
 * hall-pricing-bounds.test.ts: every optional key is PRESENT rather than
 * omitted, because server actions drop undefined keys in transit.
 */
function listing(over: Record<string, unknown> = {}) {
  return {
    ownerId: "11111111-2222-4333-8444-555555555555",
    name: "Sri Meenakshi Mahal",
    city: "Madurai",
    state: "",
    address: "",
    pincode: "625006",
    capacityMin: null,
    capacityMax: 500,
    pricePerDay: 40_000,
    priceMorning: null,
    priceEvening: null,
    description: "",
    amenityIds: [],
    venueTypes: ["wedding"],
    commissionRate: 2.5,
    ...over,
  };
}

describe("commissionRateSchema — the eight permitted rates", () => {
  // The whole point of the feature: these and nothing else.
  for (const rate of HALL_COMMISSION_RATES) {
    it(`accepts ${rate}`, () => {
      expect(commissionRateSchema.parse(rate)).toBe(rate);
    });

    it(`accepts "${rate}" as the string a form control actually sends`, () => {
      expect(commissionRateSchema.parse(String(rate))).toBe(rate);
    });
  }

  // Every one of these has a plausible-looking failure mode: a coercion that
  // turns it into a valid-looking number, or a range check that lets it past.
  const rejected: Array<[string, unknown]> = [
    ["zero — would pay Hallnect nothing while looking chosen", 0],
    ["one — below the lowest offered rate", 1],
    ["1.25 — between two offered rates", 1.25],
    ["1.75", 1.75],
    ["2.1", 2.1],
    ["2.25", 2.25],
    ["4.25", 4.25],
    ["4.75", 4.75],
    ["5.1 — just past the top", 5.1],
    ["5.5", 5.5],
    ["ten", 10],
    ["negative", -1],
    ["negative fraction", -2.5],
    ["null", null],
    ["undefined", undefined],
    ["empty string — must not coerce to 0", ""],
    ["whitespace", "   "],
    ["not a number", "abc"],
    ["a string pretending to be a rate", "2.5%"],
    ["trailing junk", "2.5abc"],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["a boolean", true],
    ["an object", {}],
    ["an array", [2.5]],
  ];

  for (const [label, value] of rejected) {
    it(`rejects ${label}`, () => {
      expect(commissionRateSchema.safeParse(value).success).toBe(false);
    });
  }

  it("rejects a float that only looks like 2.5", () => {
    // parseFloat("2.4999999") is not 2.5, and membership is tested on the
    // parsed number — so near-misses cannot round their way in.
    expect(commissionRateSchema.safeParse(2.4999999).success).toBe(false);
    expect(commissionRateSchema.safeParse("2.4999999").success).toBe(false);
  });
});

describe("isAllowedCommissionRate", () => {
  it("agrees with the exported list", () => {
    for (const r of HALL_COMMISSION_RATES) expect(isAllowedCommissionRate(r)).toBe(true);
  });
  it("rejects strings even when they name a valid rate", () => {
    // The DB column is numeric; a string must be parsed before it is trusted.
    expect(isAllowedCommissionRate("2.5")).toBe(false);
  });
  it("rejects values between the offered rates", () => {
    expect(isAllowedCommissionRate(2.25)).toBe(false);
    expect(isAllowedCommissionRate(0)).toBe(false);
  });
});

describe("hallCreateSchema requires a commission rate", () => {
  it("accepts a listing carrying an allowed rate", () => {
    const r = hallCreateSchema.safeParse(listing({ commissionRate: 3.5 }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.commissionRate).toBe(3.5);
  });

  it("REJECTS a listing with no commission rate at all", () => {
    // A hall must not be created with the rate silently absent — that would
    // invent a commercial term on the owner's behalf at booking time.
    const { commissionRate: _omitted, ...withoutRate } = listing();
    expect(hallCreateSchema.safeParse(withoutRate).success).toBe(false);
  });

  it("rejects a listing with a disallowed rate even if everything else is valid", () => {
    expect(hallCreateSchema.safeParse(listing({ commissionRate: 4.25 })).success).toBe(false);
    expect(hallCreateSchema.safeParse(listing({ commissionRate: 0 })).success).toBe(false);
  });

  it("still enforces the other listing rules alongside the new field", () => {
    // Guards against the new .and() accidentally replacing hallSchema's refines.
    expect(hallCreateSchema.safeParse(listing({ priceMorning: 999_999 })).success).toBe(false);
    expect(hallCreateSchema.safeParse(listing({ venueTypes: [] })).success).toBe(false);
  });
});

describe("every offered rate is actually payable at the live advance", () => {
  // THE SAFETY QUESTION FOR THIS FEATURE. Commission is charged on the full
  // hall price but retained out of the 25% advance, so the two can cross and
  // calculateBookingPayment throws rather than minting a negative payout.
  const ADVANCE = 25;

  for (const rate of HALL_COMMISSION_RATES) {
    it(`rate ${rate}% clears the commission-vs-advance bound at a ${ADVANCE}% advance`, () => {
      const bound = checkCommissionAgainstAdvance(rate, ADVANCE, "commission");
      expect(bound.ok).toBe(true);
    });

    for (const hallTotal of [10_000, 25_000, 75_000, 100_000]) {
      it(`rate ${rate}% on a ₹${hallTotal} hall reconciles exactly`, () => {
        const pay = calculateBookingPayment({
          hallTotal,
          advanceAmount: advanceFromTotal(hallTotal, ADVANCE),
          commissionRate: rate,
        });
        // The invariant the money module guarantees: the split reconciles to
        // the advance to the paisa, with no float residue.
        expect(pay.commissionAmount + pay.ownerNetAdvance).toBeCloseTo(pay.advanceAmount, 2);
        expect(pay.commissionAmount).toBeGreaterThan(0);
        expect(pay.ownerNetAdvance).toBeGreaterThan(0);
        // Commission is a percentage of the FULL hall price, never the advance.
        expect(pay.commissionAmount).toBeCloseTo((hallTotal * rate) / 100, 2);
      });
    }
  }

  it("the top rate is still well inside the bound — this is the headroom that keeps 5% safe", () => {
    const ceiling = ADVANCE * MAX_COMMISSION_SHARE_OF_ADVANCE; // 12.5
    expect(Math.max(...HALL_COMMISSION_RATES)).toBeLessThan(ceiling);
  });

  it("but 5% STOPS being payable if the advance is lowered under 10%", () => {
    // Documents the interaction the per-hall model introduces: the advance
    // setting is no longer safe to judge against the platform rate alone.
    expect(checkCommissionAgainstAdvance(5, 10, "advance").ok).toBe(true);
    expect(checkCommissionAgainstAdvance(5, 9.9, "advance").ok).toBe(false);
  });
});
