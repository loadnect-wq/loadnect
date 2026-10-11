import { describe, it, expect } from "vitest";
import {
  capacitySchema, optionalCapacitySchema,
  bookingSchema, reviewSchema, leadEnquirySchema, hallSchema,
  premiumPlanUpdateSchema, venueCategoryCreateSchema, parseSafe,
} from "@/lib/validation/schemas";

// ─────────────────────────────────────────────────────────────────────────────
// The remaining numeric fields, pinned against parseInt/parseFloat truncation.
//
// Companion to money-schema.test.ts, which did moneySchema and
// optionalMoneySchema. Same defect, same shape of test: parseInt and parseFloat
// stop at the first character they cannot use and return what they HAVE, so a
// malformed value did not fail — it became a plausible WRONG NUMBER that then
// satisfied the range refine and was stored.
//
// parseInt has one trap parseFloat does not: it TRUNCATES a decimal rather than
// refusing it, so parseInt("2.5") is 2. That is the couponCreateSchema.
// maxRedemptions bug ("an admin who typed 2.5 got a coupon that died after two
// redemptions") and it is asserted separately at every integer field, because
// it is the case a reader is most likely to think is harmless.
//
// WHICH MESSAGE COMES BACK MATTERS, so the negative cases are asserted through
// parseSafe. A field with its own lower-bound message keeps it (capacity says
// "at least 1", the commission percent says "between 0 and 100"); a field whose
// refine bundles shape and bound into one sentence returns that sentence either
// way. The leading `-` is in both parse helpers precisely for the first group.
// ─────────────────────────────────────────────────────────────────────────────

/** Every malformed string that parseInt would have salvaged a number from. */
const TRUNCATED_BY_PARSEINT = [
  "1,500",      // parseInt -> 1        comma grouping, the headline case
  "1,50,000",   // parseInt -> 1        Indian grouping
  "500abc",     // parseInt -> 500
  "500 guests", // parseInt -> 500
  "500%",       // parseInt -> 500
  "2.5",        // parseInt -> 2        TRUNCATED, not refused
  "500.9",      // parseInt -> 500      likewise
  "0x10",       // parseInt -> 16       hex, via the radix
  "1e3",        // parseInt -> 1        exponent read as a leading 1
];

/** Shapes that were never salvageable but must stay rejected. */
const NEVER_VALID = ["", "   ", "abc", ".5", "+5", "Infinity", "NaN", "5 0 0"];

// ── Capacity: the worst of them ──────────────────────────────────────────────

describe("capacitySchema", () => {
  const bad = (v: unknown) => capacitySchema.safeParse(v).success === false;

  it("accepts a number or a clean run of digits", () => {
    expect(capacitySchema.parse(500)).toBe(500);
    expect(capacitySchema.parse("500")).toBe(500);
    expect(capacitySchema.parse(" 500 ")).toBe(500);
  });

  it("REJECTS everything parseInt used to salvage a number from", () => {
    // "1,500" became 1, and 1 satisfies isInteger && >= 1 && <= 100_000, so a
    // 1,500-guest hall validated and was STORED WITH CAPACITY 1. capacityMax is
    // required on every hall and drives the capacity search filters plus the
    // SEO copy in lib/seo/venue.ts, which then read "seats up to 1 guests".
    for (const v of TRUNCATED_BY_PARSEINT) {
      expect(bad(v), `${JSON.stringify(v)} should be rejected`).toBe(true);
    }
  });

  it("REJECTS the shapes that were never salvageable", () => {
    for (const v of NEVER_VALID) {
      expect(bad(v), `${JSON.stringify(v)} should be rejected`).toBe(true);
    }
  });

  it("calls a malformed capacity malformed, and a negative one negative", () => {
    // Two DIFFERENT mistakes deserve two different sentences. This is why the
    // leading `-` is matched by parseIntegerString: without it, "-500" would
    // have collapsed into the "whole number" message, which is not the problem.
    const malformed = parseSafe(capacitySchema, "1,500");
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error).toMatch(/whole number/i);

    const negative = parseSafe(capacitySchema, "-500");
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.error).toMatch(/at least 1/i);
  });

  it("says 'whole number' about a fraction, which is now true", () => {
    // It was not true before: the schema said capacity must be a whole number
    // and then quietly made one out of 2.5.
    const r = parseSafe(capacitySchema, "2.5");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/whole number/i);
  });

  it("leaves the bounds exactly where they were", () => {
    expect(capacitySchema.safeParse(1).success).toBe(true);
    expect(capacitySchema.safeParse(0).success).toBe(false);
    expect(capacitySchema.safeParse(100_000).success).toBe(true);
    expect(capacitySchema.safeParse(100_001).success).toBe(false);
    expect(capacitySchema.safeParse("100000").success).toBe(true);
    expect(capacitySchema.safeParse("100001").success).toBe(false);
  });
});

describe("optionalCapacitySchema", () => {
  const bad = (v: unknown) => optionalCapacitySchema.safeParse(v).success === false;

  it("keeps blank meaning not supplied", () => {
    expect(optionalCapacitySchema.parse("")).toBe(null);
    expect(optionalCapacitySchema.parse(null)).toBe(null);
    expect(optionalCapacitySchema.parse(undefined)).toBe(null);
  });

  it("treats a whitespace-only field as blank, matching optionalMoneySchema", () => {
    expect(optionalCapacitySchema.parse("   ")).toBe(null);
    expect(optionalCapacitySchema.parse("\t")).toBe(null);
  });

  it("accepts a number or a clean run of digits", () => {
    expect(optionalCapacitySchema.parse(50)).toBe(50);
    expect(optionalCapacitySchema.parse("50")).toBe(50);
    expect(optionalCapacitySchema.parse(" 50 ")).toBe(50);
  });

  it("REJECTS everything parseInt used to salvage a number from", () => {
    for (const v of TRUNCATED_BY_PARSEINT) {
      expect(bad(v), `${JSON.stringify(v)} should be rejected`).toBe(true);
    }
  });

  it("keeps its own lower-bound message for a negative", () => {
    const r = parseSafe(optionalCapacitySchema, "-50");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at least 1/i);
  });

  it("has no upper bound, and did not acquire one", () => {
    // capacitySchema caps at 100_000; this one deliberately does not. Pinned so
    // the two are not "harmonised" by someone reading them side by side.
    expect(optionalCapacitySchema.safeParse(1_000_000).success).toBe(true);
  });
});

// ── The three call sites capacity actually reaches ───────────────────────────

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

describe("hallSchema capacity", () => {
  it("refuses a comma-grouped capacityMax rather than listing the hall as seating 1", () => {
    const r = parseSafe(hallSchema, listing({ capacityMax: "1,500" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/whole number/i);
  });

  it("refuses a comma-grouped capacityMin", () => {
    expect(hallSchema.safeParse(listing({ capacityMin: "1,000", capacityMax: 2000 })).success)
      .toBe(false);
  });

  it("accepts the same figures written cleanly", () => {
    const r = hallSchema.safeParse(listing({ capacityMin: "100", capacityMax: "1500" }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.capacityMin).toBe(100);
      expect(r.data.capacityMax).toBe(1500);
    }
  });

  it("still enforces min <= max on the parsed numbers", () => {
    // The comparison was always sound; what fed it was not. "1,000" parsed to 1
    // and so never tripped this, no matter how large capacityMax was.
    expect(hallSchema.safeParse(listing({ capacityMin: 600, capacityMax: 500 })).success)
      .toBe(false);
  });
});

describe("leadEnquirySchema.guestCount — the customer-facing one", () => {
  const base = {
    hallId: "11111111-1111-4111-8111-111111111111",
    contactName: "Priya",
    contactPhone: "9876543210",
    eventDate: "2099-01-01",
    eventType: "",
    guestCount: "",
    requirements: "",
  };

  it("refuses a comma-grouped guest count instead of recording one guest", () => {
    // This is the widest-reach call site: the venue owner decides whether to
    // quote off this number, and "1,500" arrived as 1.
    expect(leadEnquirySchema.safeParse({ ...base, guestCount: "1,500" }).success).toBe(false);
    expect(leadEnquirySchema.safeParse({ ...base, guestCount: "400 people" }).success).toBe(false);
  });

  it("keeps an omitted guest count optional", () => {
    // A customer still deciding should not be blocked from asking the price.
    expect(leadEnquirySchema.parse(base).guestCount).toBe(null);
    expect(leadEnquirySchema.parse({ ...base, guestCount: "   " }).guestCount).toBe(null);
  });

  it("accepts a clean guest count", () => {
    expect(leadEnquirySchema.parse({ ...base, guestCount: "400" }).guestCount).toBe(400);
  });
});

describe("bookingSchema.guestCount", () => {
  const base = {
    hallId: "11111111-1111-4111-8111-111111111111",
    eventDate: "2099-01-01",
    slot: "full_day",
    guestCount: 500,
    customerNotes: "",
    // Added to bookingSchema on main after this test was written; "" is how
    // the form sends "no occasion chosen".
    eventType: "",
  };

  it("REJECTS everything parseInt used to salvage a number from", () => {
    for (const v of TRUNCATED_BY_PARSEINT) {
      expect(
        bookingSchema.safeParse({ ...base, guestCount: v }).success,
        `${JSON.stringify(v)} should be rejected`,
      ).toBe(false);
    }
  });

  it("accepts a number or a clean run of digits", () => {
    expect(bookingSchema.parse({ ...base, guestCount: "500" }).guestCount).toBe(500);
    expect(bookingSchema.parse({ ...base, guestCount: " 500 " }).guestCount).toBe(500);
    expect(bookingSchema.parse({ ...base, guestCount: 500 }).guestCount).toBe(500);
  });

  it("answers both a malformed and a negative count with its one sentence", () => {
    // Unlike capacity, this field bundles shape and lower bound into a single
    // refine, so there is no separate negative message to preserve — asserted
    // rather than assumed, so a future split of that refine is a visible change.
    for (const v of ["1,500", "-5"]) {
      const r = parseSafe(bookingSchema, { ...base, guestCount: v });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/number of guests/i);
    }
  });

  it("leaves the bounds exactly where they were", () => {
    expect(bookingSchema.safeParse({ ...base, guestCount: 1 }).success).toBe(true);
    expect(bookingSchema.safeParse({ ...base, guestCount: 0 }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...base, guestCount: 100_000 }).success).toBe(true);
    const tooMany = parseSafe(bookingSchema, { ...base, guestCount: "100001" });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error).toMatch(/unrealistically large/i);
  });
});

// ── Venue category display order (admin) ─────────────────────────────────────
//
// Added on main after this file was first written, with the same bare
// parseInt: "2.5" became 2 and "1,500" became 1, both inside the range.
// (The commission percent block that stood here went with the schema itself:
// the commission is the fixed STANDARD_COMMISSION_PERCENT, not an input.)

describe("venueCategoryCreateSchema.displayOrder", () => {
  const base = { slug: "test-hall", name: "Test", pluralNoun: "Test halls", group: "celebrations" };
  const order = (displayOrder: unknown) =>
    venueCategoryCreateSchema.safeParse({ ...base, displayOrder });

  it("accepts a whole number, as a number or a clean string", () => {
    for (const v of [0, 5, "5", " 5 ", "100000"]) {
      const r = order(v);
      expect(r.success, `${JSON.stringify(v)} should be accepted`).toBe(true);
    }
  });

  it("REJECTS what parseInt used to truncate", () => {
    for (const v of ["2.5", "1,500", "5abc", "1e3", ""]) {
      expect(order(v).success, `${JSON.stringify(v)} should be rejected`).toBe(false);
    }
  });

  it("leaves the range exactly where it was", () => {
    expect(order(-1).success).toBe(false);
    expect(order("100001").success).toBe(false);
  });
});

// ── Premium plan duration ────────────────────────────────────────────────────

describe("premiumPlanUpdateSchema.duration_days", () => {
  const input = (duration_days: unknown) =>
    ({ slug: "premium" as const, monthly_price: 4999, duration_days });

  it("REJECTS the forms that made a 30-day plan a 3-day plan", () => {
    // parseInt("3,0") is 3. Owners are charged for the plan and then get a
    // tenth of the window they paid for.
    for (const v of ["3,0", "30abc", "2.5", "30.9", "1e2", "0x10", ""]) {
      expect(
        premiumPlanUpdateSchema.safeParse(input(v)).success,
        `${JSON.stringify(v)} should be rejected`,
      ).toBe(false);
    }
  });

  it("accepts a number or a clean run of digits", () => {
    expect(premiumPlanUpdateSchema.parse(input(30)).duration_days).toBe(30);
    expect(premiumPlanUpdateSchema.parse(input("30")).duration_days).toBe(30);
    expect(premiumPlanUpdateSchema.parse(input(" 30 ")).duration_days).toBe(30);
  });

  it("leaves the bound exactly where it was", () => {
    expect(premiumPlanUpdateSchema.safeParse(input(1)).success).toBe(true);
    expect(premiumPlanUpdateSchema.safeParse(input(0)).success).toBe(false);
    expect(premiumPlanUpdateSchema.safeParse(input(-30)).success).toBe(false);
  });
});

// ── Review ratings ───────────────────────────────────────────────────────────

describe("reviewSchema ratings", () => {
  const base = {
    hallId:    "11111111-1111-4111-8111-111111111111",
    bookingId: "22222222-2222-4222-8222-222222222222",
    rating:    5,
    title:     "",
    comment:   "Lovely venue",
  };

  it("REJECTS a malformed overall rating instead of truncating it", () => {
    for (const v of ["4,5", "4abc", "4.5", "1e1", ""]) {
      expect(
        reviewSchema.safeParse({ ...base, rating: v }).success,
        `${JSON.stringify(v)} should be rejected`,
      ).toBe(false);
    }
  });

  it("accepts each of the five real ratings, as number and as string", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(reviewSchema.safeParse({ ...base, rating: n }).success).toBe(true);
      expect(reviewSchema.safeParse({ ...base, rating: String(n) }).success).toBe(true);
    }
  });

  it("REPORTS a malformed sub-rating instead of silently dropping it", () => {
    // THE FAIL-OPEN. optionalRatingSchema used to end
    // `Number.isFinite(n) ? n : undefined`, which mapped garbage onto "the
    // customer did not rate this" -- so a bad value did not fail, it VANISHED
    // and the review saved as though the field had been left blank. Worse, with
    // the old parseInt "4,5" did not even become garbage: it became 4.
    const r = parseSafe(reviewSchema, { ...base, cleanlinessRating: "4,5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/sub-rating must be/i);

    expect(reviewSchema.safeParse({ ...base, valueRating: "abc" }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...base, locationRating: "4.5" }).success).toBe(false);
  });

  it("still treats a genuinely blank sub-rating as not supplied", () => {
    // The blank contract is unchanged -- only malformed stopped being blank.
    // A missing key is the case that matters most: a server action drops
    // `undefined`, and the review form sends `subRatings.x || undefined`.
    for (const blank of [undefined, null, "", "   "]) {
      const r = reviewSchema.safeParse({ ...base, cleanlinessRating: blank });
      expect(r.success, `${JSON.stringify(blank)} should mean not supplied`).toBe(true);
      if (r.success) expect(r.data.cleanlinessRating).toBeUndefined();
    }
    expect(reviewSchema.safeParse(base).success).toBe(true);
  });

  it("accepts real sub-ratings and keeps the 1-5 bound", () => {
    const r = reviewSchema.safeParse({
      ...base, cleanlinessRating: "5", valueRating: 4,
      locationRating: "3", serviceRating: 2,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.cleanlinessRating).toBe(5);
      expect(r.data.locationRating).toBe(3);
    }
    expect(reviewSchema.safeParse({ ...base, valueRating: 0 }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...base, valueRating: 6 }).success).toBe(false);
  });
});
