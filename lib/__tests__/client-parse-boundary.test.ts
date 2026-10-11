import { describe, it, expect } from "vitest";
import {
  advancePercentSchema, guestCountSchema,
  premiumPlanUpdateSchema, premiumListingSchema, bookingSchema,
  checkCommissionAgainstAdvance, parseSafe,
} from "@/lib/validation/schemas";

// ─────────────────────────────────────────────────────────────────────────────
// The values the forms now send, and the ones they used to send instead.
//
// 08aa170 and ccddb8f made every numeric schema in this file strict. That did
// nothing for five fields, because the CLIENT parsed them first and sent the
// result: parseFloat("2,5") is 2 and parseInt("1,500") is 1, so the truncation
// happened before validation and arrived as a clean number the schema had no
// reason to question. The forms now send the raw string.
//
// TWO SEPARATE DEFECTS LIVED IN THOSE CALLS, and the second is the one that was
// reachable by ordinary use rather than by a crafted request:
//
//   parseFloat / parseInt TRUNCATE  -- "2,5" became 2, "3,0" became 3
//   Number("") IS 0                 -- a blank field became a valid-looking
//                                      zero: 0% commission, a free plan, a
//                                      zero-rupee premium grant
//
// So the blank cases are pinned as hard as the malformed ones. There is no
// jsdom or testing-library in this repo (see vitest.config.ts, which collects
// only lib/** and tests/**), so these assert the schemas the forms now delegate
// to rather than the components themselves.
// ─────────────────────────────────────────────────────────────────────────────

describe("advancePercentSchema", () => {
  it("accepts a number or a clean decimal literal", () => {
    expect(advancePercentSchema.parse(25)).toBe(25);
    expect(advancePercentSchema.parse("25")).toBe(25);
    expect(advancePercentSchema.parse("2.5")).toBe(2.5);
    expect(advancePercentSchema.parse(" 25 ")).toBe(25);
  });

  it("REJECTS the decimal comma parseFloat read as a whole number", () => {
    // parseFloat("2,5") is 2. The advance is what every customer pays up front
    // and what the commission is retained out of.
    expect(advancePercentSchema.safeParse("2,5").success).toBe(false);
    expect(advancePercentSchema.safeParse("25abc").success).toBe(false);
    expect(advancePercentSchema.safeParse("25%").success).toBe(false);
    expect(advancePercentSchema.safeParse("2e1").success).toBe(false);
  });

  it("REJECTS a blank field instead of letting it mean zero", () => {
    // Number("") is 0, and 0 is the value advanceFromTotal() throws on.
    for (const v of ["", "   ", "abc"]) {
      const r = parseSafe(advancePercentSchema, v);
      expect(r.ok, `${JSON.stringify(v)} should be rejected`).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/valid percentage/i);
    }
  });

  it("deliberately has NO range of its own", () => {
    // The bound is symmetric with the commission and lives in exactly one
    // place. If this schema ever grows a `0 < n <= 100` refine, the two
    // settings screens acquire two different messages for one rule -- which is
    // the arrangement updatePlatformPaymentSettings' comment warns about.
    expect(advancePercentSchema.safeParse(0).success).toBe(true);
    expect(advancePercentSchema.safeParse(150).success).toBe(true);
    expect(advancePercentSchema.safeParse(-5).success).toBe(true);
  });

  it("and is therefore useless without checkCommissionAgainstAdvance", () => {
    // The other half of the contract above: everything the schema waves
    // through, the pair check refuses. Asserted together so neither half can be
    // removed on the assumption that the other covers it.
    for (const advance of [0, 150, -5]) {
      expect(
        checkCommissionAgainstAdvance(2.5, advance, "advance").ok,
        `an advance of ${advance} must be refused`,
      ).toBe(false);
    }
    expect(checkCommissionAgainstAdvance(2.5, 25, "advance").ok).toBe(true);
  });
});

describe("guestCountSchema", () => {
  it("is the same rule bookingSchema enforces", () => {
    // Extracted so the booking form's "can continue" gate runs this instead of
    // its own parseInt. If the two ever diverge the gate goes back to being a
    // second, looser copy of the rule -- so agreement is asserted, not assumed.
    const base = {
      hallId: "11111111-1111-4111-8111-111111111111",
      eventDate: "2099-01-01",
      slot: "full_day",
      customerNotes: "",
      // Added to bookingSchema on main after this test was written; "" is how
      // the form sends "no occasion chosen".
      eventType: "",
    };
    // Guard the guard: the accepted values must actually be accepted, so a
    // base object that fails for some other reason cannot make every row
    // "agree" by failing both.
    expect(bookingSchema.safeParse({ ...base, guestCount: "500" }).success).toBe(true);
    for (const v of ["1,500", "500abc", "2.5", "", "-5", "0", "100001", "500", 500, 1]) {
      expect(
        bookingSchema.safeParse({ ...base, guestCount: v }).success,
        `bookingSchema and guestCountSchema disagree about ${JSON.stringify(v)}`,
      ).toBe(guestCountSchema.safeParse(v).success);
    }
  });

  it("REJECTS what the gate's parseInt used to wave through", () => {
    // parseInt("1,500") is 1, so the old gate saw a positive number under the
    // hall's capacity and enabled Continue.
    for (const v of ["1,500", "1,50,000", "500 guests", "2.5", "1e3"]) {
      expect(guestCountSchema.safeParse(v).success, `${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("refuses a blank count, so an empty field cannot enable Continue", () => {
    for (const v of ["", "   "]) expect(guestCountSchema.safeParse(v).success).toBe(false);
  });

  it("accepts a real count and keeps its bounds", () => {
    expect(guestCountSchema.parse("500")).toBe(500);
    expect(guestCountSchema.parse(" 500 ")).toBe(500);
    expect(guestCountSchema.safeParse(1).success).toBe(true);
    expect(guestCountSchema.safeParse(0).success).toBe(false);
    expect(guestCountSchema.safeParse(100_000).success).toBe(true);
    expect(guestCountSchema.safeParse(100_001).success).toBe(false);
  });
});

describe("the booking form's Continue gate", () => {
  /**
   * The predicate BookingFlow computes, modelled exactly:
   *
   *   const guestsParsed = guestCountSchema.safeParse(guests);
   *   const guestsAcceptable =
   *     guestsParsed.success && guestsParsed.data <= hall.capacity_max;
   *
   * There is no jsdom in this repo, so the component cannot be rendered — and
   * the booking page is auth-gated, so it cannot be driven in a browser either.
   * Modelling the expression keeps the half the schema tests do not reach (the
   * per-hall capacity comparison) from silently rotting.
   */
  function guestsAcceptable(guests: string, capacityMax: number): boolean {
    const parsed = guestCountSchema.safeParse(guests);
    return parsed.success && parsed.data <= capacityMax;
  }

  it("enables Continue for a real count inside the hall's capacity", () => {
    expect(guestsAcceptable("500", 500)).toBe(true);   // exactly at capacity
    expect(guestsAcceptable("499", 500)).toBe(true);
    expect(guestsAcceptable("1", 500)).toBe(true);
    expect(guestsAcceptable(" 250 ", 500)).toBe(true);
  });

  it("blocks Continue above the hall's capacity", () => {
    expect(guestsAcceptable("501", 500)).toBe(false);
  });

  it("blocks Continue for the truncating forms, which it used to allow", () => {
    // parseInt("1,500") is 1: a positive number under any hall's capacity, so
    // the old gate lit up Continue and the count went over as 1.
    expect(guestsAcceptable("1,500", 500)).toBe(false);
    expect(guestsAcceptable("500.9", 500)).toBe(false);
    expect(guestsAcceptable("500abc", 500)).toBe(false);
  });

  it("blocks Continue while the field is empty", () => {
    // Replaces the old `!!guests` term, which is now subsumed by the schema.
    expect(guestsAcceptable("", 500)).toBe(false);
    expect(guestsAcceptable("   ", 500)).toBe(false);
    expect(guestsAcceptable("0", 500)).toBe(false);
  });
});

// ── The blank-becomes-zero cases, which is the half that was UI-reachable ────

describe("a cleared field no longer means zero", () => {
  // The worst of these was the platform commission field, where a cleared
  // box saved 0%. That field and commissionPercentSchema were removed from
  // main: the commission is the fixed STANDARD_COMMISSION_PERCENT, not an
  // input, so there is nothing left to clear.

  it("premiumPlanUpdateSchema refuses a blank price, so a plan cannot go free", () => {
    // Number("") === 0 passed the form's `p >= 0` guard and moneySchema's, so a
    // blank price repriced Premium to free for every owner.
    const input = (monthly_price: unknown, duration_days: unknown = "30") =>
      ({ slug: "premium" as const, monthly_price, duration_days });
    expect(premiumPlanUpdateSchema.safeParse(input("")).success).toBe(false);
    expect(premiumPlanUpdateSchema.safeParse(input("   ")).success).toBe(false);
    expect(premiumPlanUpdateSchema.safeParse(input("4999")).success).toBe(true);

    // An explicit 0 is still allowed -- the free plan is a real row.
    expect(premiumPlanUpdateSchema.safeParse(input("0")).success).toBe(true);

    // And the duration the client used to parseInt.
    expect(premiumPlanUpdateSchema.safeParse(input("4999", "3,0")).success).toBe(false);
    expect(premiumPlanUpdateSchema.safeParse(input("4999", "")).success).toBe(false);
    expect(premiumPlanUpdateSchema.safeParse(input("4999", "30")).success).toBe(true);
  });

  it("premiumListingSchema refuses a blank amount, so a grant cannot be free", () => {
    // Here the `required` attribute on the input was the only thing standing
    // between Number("") === 0 and the database, which is not where a money
    // rule belongs.
    const input = (amount: unknown) => ({
      hallId:    "11111111-1111-4111-8111-111111111111",
      planSlug:  "premium" as const,
      startDate: "2026-09-10",
      endDate:   "2026-10-10",
      amount,
    });
    expect(premiumListingSchema.safeParse(input("")).success).toBe(false);
    expect(premiumListingSchema.safeParse(input("   ")).success).toBe(false);
    expect(premiumListingSchema.safeParse(input("9,999")).success).toBe(false);
    expect(premiumListingSchema.safeParse(input("999")).success).toBe(true);
  });
});

// ── The exact strings each form now puts on the wire ─────────────────────────

describe("the raw strings the forms now send", () => {
  it("reach a schema that refuses every truncating form", () => {
    // One row per form, using the value a person would actually type. Before
    // this change each of these arrived pre-parsed and was accepted.
    const cases: Array<[string, boolean]> = [
      ["2,5", false],   // PaymentSettingsForm  -> advancePercentSchema
      ["2.5", true],
      ["25", true],
    ];
    for (const [v, ok] of cases) {
      expect(advancePercentSchema.safeParse(v).success, `advance ${v}`).toBe(ok);
    }

    expect(guestCountSchema.safeParse("1,500").success).toBe(false);
    expect(guestCountSchema.safeParse("1500").success).toBe(true);
  });
});
