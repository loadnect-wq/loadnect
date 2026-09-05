import { describe, it, expect } from "vitest";
import { hallSchema, MIN_HALL_PRICE_RUPEES } from "@/lib/validation/schemas";
import { calculateBookingPayment, advanceFromTotal } from "@/lib/booking-payment";

/**
 * A complete, valid listing. Each test varies exactly one field off this.
 *
 * Every optional key is PRESENT rather than omitted, and the empty value
 * differs by type: optionalTrimmed (text) takes "", optionalMoneySchema and
 * optionalCapacitySchema take null. Neither takes undefined, because server
 * actions drop undefined keys in transit and a silently-absent field would
 * validate as "not supplied" rather than "cleared".
 */
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

describe("a listing has a price floor", () => {
  it("rejects the prices that made the platform fee absurd", () => {
    // The catalogue's own test row was Rs200/day with a Rs100 morning slot. The
    // fee cap stopped the customer being overcharged on it; this stops the
    // listing existing.
    for (const price of [0, 40, 100, 200, 1_999]) {
      const r = hallSchema.safeParse(listing({ pricePerDay: price }));
      expect(r.success, `Rs${price} should be rejected`).toBe(false);
    }
  });

  it("accepts a real venue price", () => {
    for (const price of [MIN_HALL_PRICE_RUPEES, 20_000, 250_000]) {
      expect(hallSchema.safeParse(listing({ pricePerDay: price })).success).toBe(true);
    }
  });

  it("leaves the fee a sane fraction of the booking at the floor", () => {
    // The floor exists to make this true, so it is asserted rather than assumed.
    // At Rs2,000 the advance is Rs500 and the flat Rs200 fee is not capped —
    // 25% of 500 is 125... which means it IS capped. Pin the real numbers so a
    // change to either constant has to be looked at.
    const b = calculateBookingPayment({
      hallTotal: MIN_HALL_PRICE_RUPEES,
      advanceAmount: advanceFromTotal(MIN_HALL_PRICE_RUPEES),
      commissionRate: 2.5,
    });
    expect(b.advanceAmount).toBe(500);
    expect(b.platformFee).toBe(125);
    // Fee plus its tax stays under a tenth of what is being booked.
    expect((b.platformFee + b.platformFeeGst) / MIN_HALL_PRICE_RUPEES).toBeLessThan(0.1);
  });
});

describe("a half day cannot cost more than the whole day", () => {
  it("rejects an inverted slot price", () => {
    // The booking engine derives the advance from whichever price the chosen
    // slot resolves to, so an inverted pair charges more for less and the
    // customer only sees it at checkout.
    expect(hallSchema.safeParse(
      listing({ pricePerDay: 40_000, priceMorning: 50_000 }),
    ).success).toBe(false);

    expect(hallSchema.safeParse(
      listing({ pricePerDay: 40_000, priceEvening: 40_001 }),
    ).success).toBe(false);
  });

  it("allows a slot priced at or below the day rate, and allows none at all", () => {
    expect(hallSchema.safeParse(
      listing({ pricePerDay: 40_000, priceMorning: 40_000, priceEvening: 18_000 }),
    ).success).toBe(true);

    // Slot prices are optional — a venue that only sells full days is normal.
    expect(hallSchema.safeParse(listing()).success).toBe(true);
  });
});
