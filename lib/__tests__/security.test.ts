// Security regressions found in the pre-launch audit.
//
// Each case below is a defect that was live, not a hypothetical. They are
// pinned here because every one of them is invisible in normal use: nothing
// errors, nothing looks broken, and the damage only surfaces as money in the
// wrong place or a moderated review reappearing.

import { describe, it, expect } from "vitest";
import { safeHttpUrl } from "@/lib/utils";


describe("safeHttpUrl — owner-supplied links rendered in the ADMIN dashboard", () => {
  it("passes ordinary http(s) links through", () => {
    expect(safeHttpUrl("https://example.com/receipt.png")).toBe("https://example.com/receipt.png");
    expect(safeHttpUrl("http://example.com/a.jpg")).toBe("http://example.com/a.jpg");
  });

  it("REFUSES javascript: — this was stored XSS into an admin session", () => {
    // An owner could write screenshot_url straight through PostgREST (the RLS
    // insert policy constrains owner_id and status, not this column). The
    // admin clicking "View screenshot" would then run it as an admin.
    expect(safeHttpUrl("javascript:alert(document.cookie)")).toBeNull();
    expect(safeHttpUrl("JavaScript:fetch('/admin')")).toBeNull();
    expect(safeHttpUrl("  javascript:void(0)  ")).toBeNull();
  });

  it("refuses other executable or smuggling schemes", () => {
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHttpUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeHttpUrl("file:///etc/passwd")).toBeNull();
  });

  it("refuses junk rather than emitting a broken href", () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
  });
});

describe("availability — an owner may not rewrite booking-owned dates", () => {
  // THIS USED TO TEST setAvailability's status filter: the batch schema, the
  // three owner-editable statuses, and the rule that a client could not post
  // status='available' over a date a customer had paid for.
  //
  // All three are gone, and not because the risk went away. The risk is now
  // handled a layer down: migration 0063 revokes INSERT/UPDATE/DELETE on
  // `availability` from anon and authenticated outright, so there is no request
  // for an application-level filter to get right. Deleting these cases without
  // saying that would look like a guard was quietly dropped.
  //
  // What survives, and is tested here, is the rule the derivation depends on —
  // which the SQL re-encodes independently, and where a drift is silent.

  it("a half-day claim also takes the full day", async () => {
    const { occupySlot } = await import("@/lib/availability");
    // The one that is easy to get wrong. A day with a morning booking cannot
    // still be sold whole; forgetting the second line here would offer a
    // full-day booking on top of an existing morning one, and nothing would
    // error until two parties turned up.
    const free = { morning: true, evening: true, full_day: true };
    occupySlot(free, "morning");
    expect(free).toEqual({ morning: false, evening: true, full_day: false });
  });

  it("a full-day claim takes everything", async () => {
    const { occupySlot } = await import("@/lib/availability");
    const free = { morning: true, evening: true, full_day: true };
    occupySlot(free, "full_day");
    expect(free).toEqual({ morning: false, evening: false, full_day: false });
  });

  it("two half-day claims exhaust the day", async () => {
    const { occupySlot } = await import("@/lib/availability");
    const free = { morning: true, evening: true, full_day: true };
    occupySlot(free, "morning");
    occupySlot(free, "evening");
    expect(free).toEqual({ morning: false, evening: false, full_day: false });
  });

  it("no owner-writable availability schema remains", async () => {
    // If someone re-adds one, this fails and they have to come and read the
    // comment above before shipping a write path the database will refuse.
    const schemas = await import("@/lib/validation/schemas");
    expect(schemas).not.toHaveProperty("availabilityBatchSchema");
    expect(schemas).not.toHaveProperty("OWNER_EDITABLE_AVAIL_STATUSES");
  });
});

describe("venue types — the category tiles now filter for real", () => {
  it("still names the four types every pre-0102 hall was built on", async () => {
    // THIS ASSERTION CHANGED MEANING IN 0102 AND THAT IS THE POINT. It used to
    // say "this is the whole vocabulary, matching the database CHECK". The
    // vocabulary is now a table an admin edits, so no constant can claim that.
    // What it asserts instead is the promise the expansion had to keep: the
    // original four slugs still exist, so every hall, lead and indexed page
    // created before it still resolves. The migration's own verify block
    // asserts the same four are present and ACTIVE in the catalogue.
    const { VENUE_TYPE_CATEGORIES } = await import("@/lib/halls");
    expect([...VENUE_TYPE_CATEGORIES].sort()).toEqual(["banquet", "party", "reception", "wedding"]);
  });

  it("requires an owner to declare at least one", async () => {
    const { hallSchema, parseSafe } = await import("@/lib/validation/schemas");
    const base = {
      name: "Grand Lotus Mahal", city: "Madurai", state: "Tamil Nadu",
      address: "12 Main Road", pincode: "625001",
      capacityMin: "100", capacityMax: "800", pricePerDay: "100000",
      priceMorning: "", priceEvening: "", description: "A hall.",
      amenityIds: [],
    };
    // A hall with no types is invisible in every typed view, so the form
    // refuses it rather than quietly creating an unfindable listing.
    expect(parseSafe(hallSchema, { ...base, venueTypes: [] }).ok).toBe(false);
    expect(parseSafe(hallSchema, { ...base, venueTypes: ["wedding"] }).ok).toBe(true);
    expect(parseSafe(hallSchema, { ...base, venueTypes: ["wedding", "banquet"] }).ok).toBe(true);
  });

  it("rejects a malformed type, and leaves membership to the DB trigger", async () => {
    // BEFORE 0102 this asserted `["nightclub"]` -> false, matching a four-value
    // CHECK constraint. The vocabulary is a table an admin edits now, so this
    // module — which the browser imports — cannot hold the list, and a
    // well-formed slug it has never heard of has to reach the database.
    //
    // That is not a hole. assert_venue_categories() runs in a BEFORE trigger on
    // halls (migration 0102) and rejects both an unknown slug and one that has
    // been retired, with no client able to bypass it. What this layer still
    // owns is the SHAPE — the guard that stops anything strange reaching
    // PostgREST as an array element in the first place.
    const { hallSchema, parseSafe } = await import("@/lib/validation/schemas");
    const base = {
      name: "Grand Lotus Mahal", city: "Madurai", state: "", address: "", pincode: "",
      capacityMin: "", capacityMax: "800", pricePerDay: "100000",
      priceMorning: "", priceEvening: "", description: "", amenityIds: [],
    };
    for (const bad of ["Nightclub", "night club", "night_club", "n", "-night", "night-"]) {
      expect(parseSafe(hallSchema, { ...base, venueTypes: [bad] }).ok).toBe(false);
    }
    // A slug the admin added last week is well-formed and must get through.
    expect(parseSafe(hallSchema, { ...base, venueTypes: ["birthday-party"] }).ok).toBe(true);
  });
});

describe("48-hour owner response window", () => {
  it("treats a passed deadline as overdue and a future one as live", async () => {
    const { isOwnerResponseOverdue } = await import("@/lib/booking-expiry");
    expect(isOwnerResponseOverdue(new Date(Date.now() - 60_000).toISOString())).toBe(true);
    expect(isOwnerResponseOverdue(new Date(Date.now() + 60_000).toISOString())).toBe(false);
  });

  it("never blocks a booking that has no deadline recorded", async () => {
    // Pre-0027 rows carry no deadline. Treating null as overdue would make
    // every historical request permanently unacceptable.
    const { isOwnerResponseOverdue } = await import("@/lib/booking-expiry");
    expect(isOwnerResponseOverdue(null)).toBe(false);
    expect(isOwnerResponseOverdue(undefined)).toBe(false);
    expect(isOwnerResponseOverdue("not a date")).toBe(false);
  });
});

describe("Cashfree order expiry — the gateway's own bounds", () => {
  // Cashfree: "Expiry time should be more than 15 min and less than 30 days".
  // Breaching either end is a 400 that takes the ENTIRE checkout down, which is
  // what a 5-minute floor did against the then 15-minute hold: every customer
  // who reached the payment step had under 15 minutes left and could not pay at
  // all. The hold is now 20 minutes (PENDING_PAYMENT_TIMEOUT_MIN) so the two
  // line up, but these bounds are the gateway's and hold regardless.
  const MIN = 15 * 60 * 1000;
  const MAX = 30 * 24 * 60 * 60 * 1000;

  async function expiryMs(bookingExpiresAt: string | null | undefined) {
    const { gatewayExpiryFor } = await import("@/lib/payments");
    return Date.parse(gatewayExpiryFor(bookingExpiresAt)) - Date.now();
  }

  it("is always MORE than 15 minutes out, whatever the hold says", async () => {
    for (const minutesLeft of [0, 1, 5, 14, 15, 16]) {
      const at = new Date(Date.now() + minutesLeft * 60_000).toISOString();
      expect(await expiryMs(at), `hold with ${minutesLeft}m left`).toBeGreaterThan(MIN);
    }
  });

  it("clears the boundary by a real margin, not a single minute", async () => {
    // The timestamp is compared against CASHFREE's clock after a network hop,
    // so 15m30s here can arrive under the line there.
    expect(await expiryMs(new Date(Date.now() + 60_000).toISOString()))
      .toBeGreaterThanOrEqual(19 * 60 * 1000);
  });

  it("honours a longer hold instead of truncating it", async () => {
    const at = new Date(Date.now() + 45 * 60_000).toISOString();
    const ms = await expiryMs(at);
    expect(ms).toBeGreaterThan(44 * 60 * 1000);
    expect(ms).toBeLessThan(46 * 60 * 1000);
  });

  it("stays under the 30-day ceiling even for an absurd hold", async () => {
    const at = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
    expect(await expiryMs(at)).toBeLessThan(MAX);
  });

  it("falls back to a valid window when the booking has no deadline", async () => {
    for (const bad of [null, undefined, "", "not a date"]) {
      const ms = await expiryMs(bad);
      expect(ms).toBeGreaterThan(MIN);
      expect(ms).toBeLessThan(MAX);
    }
  });
});

describe("the booking hold and the gateway floor must stay aligned", () => {
  // These two numbers live in different files and are easy to change apart.
  // When the hold was 15 and Cashfree's minimum was 15, EVERY gateway order
  // outlived the booking it was paying for — and once the floor was raised to
  // clear Cashfree, every order overhung by at least 5 minutes. Keeping the
  // hold at or above the floor is what makes a prompt payment's order expire
  // exactly when its hold does.
  it("holds the slot for longer than Cashfree's 15-minute minimum", async () => {
    const { PENDING_PAYMENT_TIMEOUT_MIN } = await import("@/lib/booking-payment");
    expect(PENDING_PAYMENT_TIMEOUT_MIN).toBeGreaterThan(15);
  });

  it("a fresh booking's order expires with the hold, not after it", async () => {
    const { PENDING_PAYMENT_TIMEOUT_MIN } = await import("@/lib/booking-payment");
    const { gatewayExpiryFor } = await import("@/lib/payments");

    // A booking created this instant: its hold and its order should end together.
    const holdEndsAt = new Date(Date.now() + PENDING_PAYMENT_TIMEOUT_MIN * 60_000);
    const orderEndsAt = new Date(gatewayExpiryFor(holdEndsAt.toISOString()));
    const overhangMs = orderEndsAt.getTime() - holdEndsAt.getTime();

    expect(overhangMs).toBeGreaterThanOrEqual(0);
    // Allow a second of drift between the two Date.now() calls above.
    expect(overhangMs).toBeLessThan(1_000);
  });
});
