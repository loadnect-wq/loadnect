import { describe, it, expect } from "vitest";
import {
  moneySchema, optionalMoneySchema, hallSchema,
  premiumListingSchema, premiumPlanUpdateSchema,
  MIN_HALL_PRICE_RUPEES, parseSafe,
} from "@/lib/validation/schemas";

// ─────────────────────────────────────────────────────────────────────────────
// The money schemas, pinned against parseFloat's salvage behaviour.
//
// moneySchema and optionalMoneySchema used parseFloat, which stops at the first
// character it cannot use and returns what it HAS — so a malformed amount came
// back as a plausible wrong number rather than as an error. These are the exact
// strings that did it, and they are pinned here rather than only reasoned about
// in a comment, because the next person to reach for parseFloat in this file
// will be the fifth: commissionRateSchema, couponCreateSchema.maxRedemptions
// and leadConfirmSchema.agreedAmount all had the same defect and all had it
// fixed the same way.
//
// The two admin call sites (premiumListingSchema.amount, monthly_price) have NO
// price floor, so on those paths a truncated amount is not merely mis-messaged:
// it is stored. They are asserted below alongside the hall form.
// ─────────────────────────────────────────────────────────────────────────────

describe("moneySchema", () => {
  const ok = (v: unknown) => moneySchema.parse(v);
  const bad = (v: unknown) => moneySchema.safeParse(v).success === false;

  it("accepts a number or a clean numeric string", () => {
    expect(ok(50_000)).toBe(50_000);
    expect(ok("50000")).toBe(50_000);
    expect(ok("50000.50")).toBe(50_000.5);
    expect(ok(" 50000 ")).toBe(50_000);
    expect(ok(0)).toBe(0);
    expect(ok("0")).toBe(0);
  });

  it("REJECTS a comma-grouped amount rather than reading it as fifty rupees", () => {
    // THE defect. parseFloat("50,000") is 50 — and "50,000" is exactly how a
    // person writes fifty thousand rupees.
    expect(bad("50,000")).toBe(true);
    expect(bad("1,50,000")).toBe(true);   // Indian grouping
    expect(bad("150,000")).toBe(true);    // Western grouping
    expect(bad("50,000.00")).toBe(true);
  });

  it("REJECTS trailing junk rather than salvaging the leading digits", () => {
    // parseFloat("2000abc") is 2000, parseFloat("2000 per day") is 2000.
    for (const v of ["2000abc", "2000 per day", "2000%", "2000/-", "2000rs", "2000."]) {
      expect(bad(v), `${JSON.stringify(v)} should be rejected`).toBe(true);
    }
  });

  it("REJECTS exponent notation, which nobody types and parseFloat expanded", () => {
    // parseFloat("1e5") is 100000. A field that means to hold rupees should not
    // silently accept a hundred thousand of them written as three characters.
    for (const v of ["1e5", "1E5", "2e3", "1e-2", "5e+4"]) {
      expect(bad(v), `${JSON.stringify(v)} should be rejected`).toBe(true);
    }
  });

  it("REJECTS a currency prefix — as it did before, but now on purpose", () => {
    // These already failed, but only because the symbol LEADS and parseFloat
    // had nothing to salvage. Pinned so the reason is now the regex.
    for (const v of ["₹50000", "Rs50000", "Rs. 50000", "INR 50000"]) {
      expect(bad(v), `${JSON.stringify(v)} should be rejected`).toBe(true);
    }
  });

  it("REJECTS the other shapes Number() would have accepted", () => {
    // Number("") is 0 and Number("0x10") is 16 — this is why the transform is
    // a regex test and not a z.coerce.number().
    for (const v of ["", "   ", "0x10", "0b11", "Infinity", "NaN", ".5", "+500", "5 0 0"]) {
      expect(bad(v), `${JSON.stringify(v)} should be rejected`).toBe(true);
    }
  });

  it("still answers a negative with the message about negatives", () => {
    // The leading `-` stays in the regex for this reason: "-500" is a clear
    // mistake with a clear message, and collapsing it into "Enter a valid
    // amount." would have been a worse error than the one it replaced.
    for (const v of [-500, "-500", "-0.5"]) {
      const r = moneySchema.safeParse(v);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toMatch(/cannot be negative/i);
    }
  });

  it("answers a malformed amount with the message about validity", () => {
    const r = moneySchema.safeParse("50,000");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/valid amount/i);
  });

  it("rejects the non-finite numbers as numbers too, not just as strings", () => {
    for (const v of [NaN, Infinity, -Infinity]) expect(bad(v)).toBe(true);
  });
});

describe("optionalMoneySchema", () => {
  const ok = (v: unknown) => optionalMoneySchema.parse(v);
  const bad = (v: unknown) => optionalMoneySchema.safeParse(v).success === false;

  it("keeps blank meaning cleared", () => {
    expect(ok("")).toBe(null);
    expect(ok(null)).toBe(null);
    expect(ok(undefined)).toBe(null);
  });

  it("treats a whitespace-only field as blank, not as an error", () => {
    // Same intent as "": the owner left it alone. Complaining about a value
    // nobody entered is the wrong end of the stick.
    expect(ok("   ")).toBe(null);
    expect(ok("\t")).toBe(null);
  });

  it("accepts a number or a clean numeric string", () => {
    expect(ok(75_000)).toBe(75_000);
    expect(ok("75000")).toBe(75_000);
    expect(ok("75000.25")).toBe(75_000.25);
    expect(ok(" 75000 ")).toBe(75_000);
  });

  it("REJECTS the same malformed shapes as moneySchema", () => {
    for (const v of ["75,000", "75000abc", "1e5", "₹75000", "0x10", ".5"]) {
      expect(bad(v), `${JSON.stringify(v)} should be rejected`).toBe(true);
    }
  });

  it("still answers a negative with the message about negatives", () => {
    const r = optionalMoneySchema.safeParse("-75000");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/cannot be negative/i);
  });
});

// ── The call sites, since that is where the truncation actually lands ─────────

/** A complete, valid listing. Mirrors hall-pricing-bounds.test.ts. */
function listing(over: Record<string, unknown> = {}) {
  return {
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
    ...over,
  };
}

describe("hallSchema prices reject a comma-grouped figure", () => {
  it("tells the owner the amount is invalid, not that ₹50 is under the floor", () => {
    // Before: parseFloat gave 50, which then failed the MIN_HALL_PRICE_RUPEES
    // refine — so the owner WAS stopped, but was told the venue must cost at
    // least ₹2,000, which is nonsense advice for someone who typed 50,000.
    //
    // ASSERTED THROUGH parseSafe, because that is the only thing the owner
    // sees. NaN fails all three refines, so the floor message is still IN
    // issues[] behind the real one — every consumer in the app reads
    // issues[0] (parseSafe itself, and the four forms that inline it), so
    // what matters is which issue comes first, not that the others are gone.
    const r = parseSafe(hallSchema, listing({ pricePerDay: "50,000" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/valid amount/i);
      expect(r.error).not.toMatch(/priced at least/i);
    }
  });

  it("refuses a comma-grouped half-day rate, which used to be ACCEPTED", () => {
    // pricePerDay was caught by luck: "50,000" → 50 is under the floor. The
    // half-day fields have no floor of their own, only the "cannot exceed the
    // full-day rate" comparison — so a morning slot typed "80,000" became ₹80,
    // passed that comparison easily, and was stored.
    const r = hallSchema.safeParse(listing({ pricePerDay: 100_000, priceMorning: "80,000" }));
    expect(r.success).toBe(false);
  });

  it("accepts the same figures written cleanly", () => {
    const r = hallSchema.safeParse(listing({
      pricePerDay: "100000", priceMorning: "80000", priceEvening: "80000.50",
    }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.pricePerDay).toBe(100_000);
      expect(r.data.priceMorning).toBe(80_000);
      expect(r.data.priceEvening).toBe(80_000.5);
    }
  });

  it("leaves the floor itself untouched", () => {
    // The parsing got stricter; the bounds did not move.
    expect(hallSchema.safeParse(listing({ pricePerDay: MIN_HALL_PRICE_RUPEES })).success).toBe(true);
    expect(hallSchema.safeParse(listing({ pricePerDay: MIN_HALL_PRICE_RUPEES - 1 })).success).toBe(false);
  });
});

describe("the admin money fields, which have no floor to catch a typo", () => {
  const premiumInput = (amount: unknown) => ({
    // A REAL uuid, variant nibble included — uuidSchema rejects
    // "11111111-1111-1111-1111-111111111111", which would fail this test for
    // a reason that has nothing to do with money.
    hallId:    "11111111-1111-4111-8111-111111111111",
    planSlug:  "premium" as const,
    startDate: "2026-09-10",
    endDate:   "2026-10-10",
    amount,
  });

  it("premiumListingSchema.amount refuses a comma-grouped amount", () => {
    // Nothing downstream would have questioned it: createPremiumListing stores
    // Math.round(v.amount * 100) / 100, so "9,999" became a ₹9 premium grant.
    expect(premiumListingSchema.safeParse(premiumInput("9,999")).success).toBe(false);
    expect(premiumListingSchema.safeParse(premiumInput("9999abc")).success).toBe(false);
    expect(premiumListingSchema.safeParse(premiumInput("9999")).success).toBe(true);
    expect(premiumListingSchema.safeParse(premiumInput(9999)).success).toBe(true);
  });

  it("premiumPlanUpdateSchema.monthly_price refuses a comma-grouped price", () => {
    // Worse than a bad grant: this one is the CATALOGUE price every owner is
    // charged, so "4,999" would have quietly repriced the Premium plan to ₹4.
    const input = (monthly_price: unknown) =>
      ({ slug: "premium" as const, monthly_price, duration_days: 30 });
    expect(premiumPlanUpdateSchema.safeParse(input("4,999")).success).toBe(false);
    expect(premiumPlanUpdateSchema.safeParse(input("1e4")).success).toBe(false);
    expect(premiumPlanUpdateSchema.safeParse(input("4999")).success).toBe(true);
    expect(premiumPlanUpdateSchema.safeParse(input(4999)).success).toBe(true);
  });
});
