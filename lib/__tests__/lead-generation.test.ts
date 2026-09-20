import { describe, it, expect } from "vitest";
import { calculateLeadCommission } from "@/lib/leads";
import { isCommissionOrderId, COMMISSION_ORDER_PREFIX } from "@/lib/commission-payments";
import { isPlanOrderId } from "@/lib/plan-payments";
import { venueDescription } from "@/lib/seo/venue";
import {
  toBookingMode, isLeadGeneration, formatHallPrice, hasPrice,
  primaryCtaHref, primaryCtaLabel, PRICE_ON_REQUEST,
} from "@/lib/booking-mode";
import {
  bookingModeSchema, leadConfirmSchema, leadEnquirySchema, hallSchema, hallCreateSchema,
  BOOKING_MODES, MIN_LEAD_AGREED_AMOUNT, MIN_HALL_PRICE_RUPEES,
} from "@/lib/validation/schemas";

// ─────────────────────────────────────────────────────────────────────────────
// Lead generation, tested where it can actually go wrong.
//
// Everything here is PURE — arithmetic, schemas, string routing. The parts that
// need a database (ownership checks, the confirm compare-and-set, the unique
// indexes that make confirmation exactly-once) are enforced BY the database and
// are verified against the live schema, not mocked here: a mock of Postgres
// that agrees with my assumptions proves only that I am consistent.
// ─────────────────────────────────────────────────────────────────────────────

// ── The commission a venue owes on a confirmed enquiry ───────────────────────

describe("calculateLeadCommission", () => {
  it("charges the standard 2.5% on the agreed amount", () => {
    const r = calculateLeadCommission({ agreedAmount: 100_000 });
    expect(r.commissionAmount).toBe(2_500);
    expect(r.ownerNet).toBe(97_500);
    expect(r.agreedAmount).toBe(100_000);
    expect(r.commissionRate).toBe(2.5);
  });

  it("matches the business examples exactly", () => {
    for (const [amount, commission] of [[10_000, 250], [25_000, 625], [50_000, 1_250], [100_000, 2_500]] as const) {
      expect(calculateLeadCommission({ agreedAmount: amount }).commissionAmount).toBe(commission);
    }
  });

  it("IGNORES a rate smuggled into the input — the venue cannot pick its own", () => {
    const tampered = { agreedAmount: 100_000, commissionRate: 0.5 };
    expect(calculateLeadCommission(tampered).commissionAmount).toBe(2_500);
  });

  it("reconciles exactly: commission + ownerNet === agreed", () => {
    // Deliberately awkward numbers — the ones where float arithmetic drifts.
    for (const amount of [2_000, 33_333, 87_654.21, 1_00_000, 9_99_999.99]) {
      const r = calculateLeadCommission({ agreedAmount: amount });
      expect(r.commissionAmount + r.ownerNet).toBeCloseTo(r.agreedAmount, 2);
    }
  });

  it("FLOORS the commission, so rounding never favours Hallnect", () => {
    // 2.5% of 1,111.42 = 27.7855 — must land on 27.78, not 27.79.
    const r = calculateLeadCommission({ agreedAmount: 1_111.42 });
    expect(r.commissionAmount).toBe(27.78);
  });

  it("refuses an agreed amount of zero or less", () => {
    expect(() => calculateLeadCommission({ agreedAmount: 0 })).toThrow(RangeError);
    expect(() => calculateLeadCommission({ agreedAmount: -1 })).toThrow(RangeError);
  });

  it("never returns a negative owner net", () => {
    const r = calculateLeadCommission({ agreedAmount: MIN_LEAD_AGREED_AMOUNT });
    expect(r.ownerNet).toBeGreaterThan(0);
  });
});

// ── Order-id namespaces. Three kinds of money reach one webhook. ─────────────

describe("gateway order-id routing", () => {
  it("recognises its own prefix", () => {
    expect(isCommissionOrderId(`${COMMISSION_ORDER_PREFIX}abc123`)).toBe(true);
  });

  it("does NOT claim a booking or a plan order", () => {
    // THE FAILURE THIS PREVENTS: a booking advance routed to the commission
    // verifier would find no settlement row, return not_found, and the webhook
    // would acknowledge a real payment as "nothing to do" — permanently, since
    // 200 cancels Cashfree's retries.
    expect(isCommissionOrderId("HN_1234567890")).toBe(false);
    expect(isCommissionOrderId("HNP_1234567890")).toBe(false);
  });

  it("and the plan matcher does not claim a commission order", () => {
    expect(isPlanOrderId(`${COMMISSION_ORDER_PREFIX}abc123`)).toBe(false);
  });

  it("neither prefix is a prefix of the other", () => {
    // If one ever became a prefix of the other, the webhook's ternary chain
    // would silently send every order of one kind to the other's handler.
    expect(COMMISSION_ORDER_PREFIX.startsWith("HNP_")).toBe(false);
    expect("HNP_".startsWith(COMMISSION_ORDER_PREFIX)).toBe(false);
  });

  it("survives junk without throwing", () => {
    for (const bad of ["", "hnc_lower", "  HNC_x", "HNC", null, undefined, 42]) {
      expect(() => isCommissionOrderId(bad as string)).not.toThrow();
    }
    expect(isCommissionOrderId("hnc_lower")).toBe(false);
  });
});

// ── Presentation: a missing price must never render as a number ─────────────

describe("booking mode presentation", () => {
  it("defaults everything unrecognised to DIRECT_BOOKING", () => {
    // The safe direction: a hall wrongly shown as direct-booking displays a
    // price and a Book button, which is visibly wrong. The reverse silently
    // hides a working checkout.
    for (const raw of [null, undefined, "", "direct_booking", "NONSENSE", 7, {}]) {
      expect(toBookingMode(raw)).toBe("DIRECT_BOOKING");
    }
    expect(toBookingMode("LEAD_GENERATION")).toBe("LEAD_GENERATION");
    expect(isLeadGeneration("LEAD_GENERATION")).toBe(true);
    expect(isLeadGeneration(null)).toBe(false);
  });

  it("renders a missing, zero or NaN price as the enquire phrase", () => {
    // Number(null) is 0 and 0 formats as a price. "Free" on a wedding hall is
    // the fail-open shape this whole helper exists to prevent.
    for (const p of [null, undefined, 0, -5, NaN, Infinity]) {
      expect(formatHallPrice(p as number)).toBe(PRICE_ON_REQUEST);
      expect(hasPrice(p as number)).toBe(false);
    }
  });

  it("renders a real price normally", () => {
    expect(formatHallPrice(150_000)).not.toBe(PRICE_ON_REQUEST);
    expect(hasPrice(150_000)).toBe(true);
  });

  it("sends each mode to the route that can actually serve it", () => {
    expect(primaryCtaHref("LEAD_GENERATION", "abc")).toBe("/enquiry/abc");
    expect(primaryCtaHref("DIRECT_BOOKING", "abc")).toBe("/book/abc");
    // An unknown mode must land on checkout, not on a form the server refuses.
    expect(primaryCtaHref(null, "abc")).toBe("/book/abc");
    expect(primaryCtaLabel("LEAD_GENERATION")).toBe("Send Enquiry");
    expect(primaryCtaLabel("DIRECT_BOOKING")).toBe("Book Now");
  });
});

// ── Schemas ──────────────────────────────────────────────────────────────────

describe("bookingModeSchema", () => {
  it("accepts both real modes", () => {
    for (const m of BOOKING_MODES) {
      expect(bookingModeSchema.parse(m)).toBe(m);
    }
  });

  it("treats a MISSING key as DIRECT_BOOKING, not as an error", () => {
    // A Next.js server action DROPS undefined properties, so every call site
    // written before lead generation sends no key at all. Answering "Invalid
    // input" there would break hall editing for a field the form never had.
    expect(bookingModeSchema.parse(undefined)).toBe("DIRECT_BOOKING");
    expect(bookingModeSchema.parse(null)).toBe("DIRECT_BOOKING");
    expect(bookingModeSchema.parse("")).toBe("DIRECT_BOOKING");
  });

  it("rejects anything else rather than coercing it", () => {
    for (const bad of ["lead_generation", "LEAD", "DIRECT", "DROP TABLE", 1]) {
      expect(() => bookingModeSchema.parse(bad)).toThrow();
    }
  });
});

describe("leadConfirmSchema — the agreed amount", () => {
  const ok = (v: unknown) => leadConfirmSchema.parse({ agreedAmount: v }).agreedAmount;

  it("accepts a clean number or numeric string", () => {
    expect(ok(150000)).toBe(150000);
    expect(ok("150000")).toBe(150000);
    expect(ok(" 150000 ")).toBe(150000);
    expect(ok("150000.50")).toBe(150000.5);
  });

  it("REJECTS a comma-grouped amount instead of reading it as fifty rupees", () => {
    // parseFloat("50,000") is 50. Silently accepting that would bill a
    // commission of about a rupee on a fifty-thousand-rupee booking.
    expect(() => ok("50,000")).toThrow();
    expect(() => ok("1,50,000")).toThrow();
  });

  it("REJECTS a number with a unit or trailing junk", () => {
    // parseFloat("150000abc") is 150000 — it stops at the first character it
    // cannot use and returns what it has.
    for (const bad of ["150000abc", "Rs150000", "150000%", "1e5", "0x10"]) {
      expect(() => ok(bad)).toThrow();
    }
  });

  it("rejects a missing key with a message that says what to enter", () => {
    // The server-action-drops-undefined trap again. Zod's bare "Invalid input"
    // tells an owner nothing about a field they left blank.
    const r = leadConfirmSchema.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toMatch(/amount agreed/i);
    }
  });

  it("enforces the floor", () => {
    expect(() => ok(MIN_LEAD_AGREED_AMOUNT - 1)).toThrow();
    expect(ok(MIN_LEAD_AGREED_AMOUNT)).toBe(MIN_LEAD_AGREED_AMOUNT);
    expect(() => ok(0)).toThrow();
    expect(() => ok(-100)).toThrow();
  });

  it("rejects more than two decimal places", () => {
    // numeric(12,2) would round it silently; refusing keeps the number the
    // owner typed and the number stored identical.
    expect(() => ok("100.005")).toThrow();
  });
});

describe("hallSchema — pricing follows the booking mode", () => {
  const base = {
    name: "Sri Meenakshi Mahal",
    city: "Madurai",
    state: "",
    address: "",
    pincode: "",
    capacityMin: "",
    capacityMax: "500",
    priceMorning: "",
    priceEvening: "",
    description: "",
    amenityIds: [] as string[],
    venueTypes: ["wedding"],
  };

  it("REQUIRES a price for a direct-booking venue", () => {
    const r = hallSchema.safeParse({ ...base, bookingMode: "DIRECT_BOOKING", pricePerDay: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("pricePerDay"))).toBe(true);
    }
  });

  it("requires a price when the mode is ABSENT, because that means direct", () => {
    const r = hallSchema.safeParse({ ...base, pricePerDay: "" });
    expect(r.success).toBe(false);
  });

  it("accepts a payload with NO bookingMode key at all", () => {
    // THE REGRESSION THIS PINS. bookingModeSchema admits undefined into its
    // union, but a `.transform()` pipe is a REQUIRED KEY in a Zod object unless
    // the pipe itself opts out — so without the .default() on the field, every
    // caller written before lead generation (which sends no such key, because
    // Next.js server actions drop undefined properties) was rejected outright.
    // Six existing tests caught it. This one keeps it caught.
    const r = hallSchema.safeParse({ ...base, pricePerDay: "150000" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.bookingMode).toBe("DIRECT_BOOKING");
  });

  it("allows a lead venue to publish no price at all", () => {
    const r = hallSchema.safeParse({ ...base, bookingMode: "LEAD_GENERATION", pricePerDay: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.pricePerDay).toBeNull();
  });

  it("still applies the price floor to a lead venue that DOES publish one", () => {
    const r = hallSchema.safeParse({
      ...base, bookingMode: "LEAD_GENERATION", pricePerDay: String(MIN_HALL_PRICE_RUPEES - 1),
    });
    expect(r.success).toBe(false);
  });

  it("does not complain about the morning rate when there is no full-day rate", () => {
    // `x <= null` is FALSE in JavaScript, so without an explicit null guard a
    // lead venue quoting only a morning rate would be rejected with a message
    // about a field it deliberately left empty.
    const r = hallSchema.safeParse({
      ...base, bookingMode: "LEAD_GENERATION", pricePerDay: "", priceMorning: "75000",
    });
    expect(r.success).toBe(true);
  });

  it("still catches an inverted half-day rate when both are given", () => {
    const r = hallSchema.safeParse({
      ...base, bookingMode: "LEAD_GENERATION", pricePerDay: "50000", priceMorning: "75000",
    });
    expect(r.success).toBe(false);
  });
});

describe("what Google is told about a lead venue", () => {
  // A meta description is not decoration — it is the sentence a couple reads
  // in the search result before they click. Promising a checkout a venue does
  // not have brings someone to the page expecting to book and hands them a
  // form instead. Caught on the FIRST REAL LISTING: the live description ended
  // "Book your date online" for a venue that cannot be booked online.
  const base = {
    name: "Sri Meenakshi Mahal",
    slug: "sri-meenakshi-mahal-madurai",
    city: "Madurai",
    state: "Tamil Nadu",
    address: "1 Temple St",
    description: null,
    capacity_max: 1000,
    price_per_day: 100_000,
    rating_average: 0,
    rating_count: 0,
    amenities: [] as { name: string }[],
  };

  it("does NOT promise online booking for a lead venue", () => {
    const d = venueDescription({
      ...base, booking_mode: "LEAD_GENERATION",
    } as unknown as Parameters<typeof venueDescription>[0]);
    expect(d).not.toMatch(/book your date online/i);
    expect(d).toMatch(/enquiry/i);
  });

  it("still promises it for a direct-booking venue", () => {
    const d = venueDescription({
      ...base, booking_mode: "DIRECT_BOOKING",
    } as unknown as Parameters<typeof venueDescription>[0]);
    expect(d).toMatch(/book your date online/i);
  });

  it("drops the price clause entirely when a lead venue publishes none", () => {
    // inr(null) would read "from Rs.0 per day" — an advertised price of zero
    // on a wedding hall, in the snippet Google prints.
    const d = venueDescription({
      ...base, booking_mode: "LEAD_GENERATION", price_per_day: null,
    } as unknown as Parameters<typeof venueDescription>[0]);
    expect(d).not.toMatch(/from ₹\s*0|Rs\.?\s*0/i);
    expect(d).toMatch(/contact the venue for pricing/i);
  });
});

describe("hallCreateSchema — THE PATH AN OWNER ACTUALLY TAKES", () => {
  // hallSchema is tested above, but an owner never submits hallSchema. They
  // submit hallCreateSchema, which is `hallSchema.and(...)` — a Zod
  // INTERSECTION, and an intersection parses both sides and merges. Defaults
  // and transforms are exactly where that goes quietly wrong, so the mode and
  // the optional price are asserted through the composed schema rather than
  // assumed to survive it. Nobody has ever run this form in production.
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
      amenityIds: [] as string[],
      venueTypes: ["wedding"],
      ...over,
    };
  }

  it("creates a LEAD venue with NO price at all", () => {
    const r = hallCreateSchema.safeParse(
      listing({ bookingMode: "LEAD_GENERATION", pricePerDay: "" }),
    );
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.pricePerDay).toBeNull();
      expect(r.data.bookingMode).toBe("LEAD_GENERATION");
    }
  });

  it("carries the DEFAULT through the intersection when the key is absent", () => {
    // The regression that would break every pre-existing caller.
    const { ...noMode } = listing();
    const r = hallCreateSchema.safeParse(noMode);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.bookingMode).toBe("DIRECT_BOOKING");
  });

  it("still refuses a DIRECT venue with no price", () => {
    const r = hallCreateSchema.safeParse(
      listing({ bookingMode: "DIRECT_BOOKING", pricePerDay: "" }),
    );
    expect(r.success).toBe(false);
  });

  it("creates a LEAD venue that DOES publish a price", () => {
    const r = hallCreateSchema.safeParse(
      listing({ bookingMode: "LEAD_GENERATION", pricePerDay: 40_000 }),
    );
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.pricePerDay).toBe(40_000);
  });

  it("asks for NO commission rate — and drops one if a request sends it", () => {
    // The owner-selectable rate is gone. A venue lists without one, and a
    // crafted request carrying a rate has it stripped, not stored.
    const r = hallCreateSchema.safeParse(
      listing({ bookingMode: "LEAD_GENERATION", pricePerDay: "", commissionRate: 0.5 }),
    );
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty("commissionRate");
  });

  it("rejects an unknown mode rather than defaulting it", () => {
    expect(hallCreateSchema.safeParse(listing({ bookingMode: "HYBRID" })).success).toBe(false);
  });
});

describe("leadEnquirySchema", () => {
  const base = {
    hallId: "11111111-1111-4111-8111-111111111111",
    contactName: "Priya",
    contactPhone: "9876543210",
    eventDate: "2099-01-01",
    eventType: "",
    guestCount: "",
    requirements: "",
  };

  it("accepts a minimal enquiry and nulls the optional fields", () => {
    const r = leadEnquirySchema.parse(base);
    expect(r.eventType).toBeNull();
    expect(r.guestCount).toBeNull();
  });

  it("requires a phone number — the enquiry IS the phone number", () => {
    // phoneSchema treats "" as valid because it is used where a phone is
    // genuinely optional. Here the number receives the OTP and is what the
    // venue rings, so requiredPhoneSchema is the right one.
    expect(leadEnquirySchema.safeParse({ ...base, contactPhone: "" }).success).toBe(false);
  });

  it("rejects a past event date", () => {
    expect(leadEnquirySchema.safeParse({ ...base, eventDate: "2020-01-01" }).success).toBe(false);
  });

  // "conference" used to be rejected here by a four-value z.enum. It is a real
  // category since 0102 — which is the whole expansion — so the vocabulary
  // check moved to trg_leads_event_type in the database, where a client cannot
  // reach it. This layer owns the shape.
  it("rejects an event type that is not slug-shaped", () => {
    for (const bad of ["Wedding", "corporate event", "corporate_event", "x"]) {
      expect(leadEnquirySchema.safeParse({ ...base, eventType: bad }).success).toBe(false);
    }
  });

  it("accepts the four original types and the ones the expansion added", () => {
    for (const t of ["wedding", "reception", "party", "banquet", "birthday-party", "conference"]) {
      expect(leadEnquirySchema.safeParse({ ...base, eventType: t }).success).toBe(true);
    }
  });

  it("keeps \"they did not say\" distinct from every category", () => {
    // null, not "wedding". The owner's and admin's breakdowns count this
    // bucket separately and must never see it defaulted into a real occasion.
    for (const empty of ["", null, undefined]) {
      const r = leadEnquirySchema.safeParse({ ...base, eventType: empty });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.eventType).toBeNull();
    }
  });

  it("carries no money, owner or status field at all", () => {
    // A client-supplied amount is the whole class of bug this feature has to
    // avoid, so the shape is asserted rather than assumed.
    const parsed = leadEnquirySchema.parse(base) as Record<string, unknown>;
    for (const forbidden of ["amount", "agreedAmount", "commissionRate", "ownerId", "status"]) {
      expect(parsed).not.toHaveProperty(forbidden);
    }
  });
});
