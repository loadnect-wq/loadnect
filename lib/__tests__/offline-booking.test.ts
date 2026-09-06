// ─────────────────────────────────────────────────────────────────────────────
// Offline bookings — the input rules and the slot-conflict semantics.
//
// The CONCURRENCY guarantee is not testable from here: it lives in
// assert_inventory_free's advisory lock (migration 0057) and was verified
// against the live database with two genuinely parallel HTTP requests. What is
// testable here is the rule the lock protects — which slots conflict with which
// — because the SQL and lib/availability.ts each encode it separately and a
// drift between them is silent.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { offlineBookingSchema } from "@/lib/validation/schemas";
import {
  HARD_BLOCK_STATUSES,
  MORNING_BLOCK_STATUSES,
  EVENING_BLOCK_STATUSES,
} from "@/lib/availability";

function input(over: Record<string, unknown> = {}) {
  return {
    hallId: "547ff60a-108a-4781-8583-c0daaa17d85d",
    eventDate: "2027-05-10",
    endDate: "2027-05-10",
    slot: "full_day",
    customerName: "",
    customerPhone: "",
    notes: "",
    reference: "",
    ...over,
  };
}

describe("an owner can block a date without knowing who booked it", () => {
  it("accepts a booking with no customer details at all", () => {
    // The point of the feature is that the DATE stops being sellable. Requiring
    // a name and number first would mean an owner who took the call on a bad
    // line either invents details or leaves the date open to a double booking.
    expect(offlineBookingSchema.safeParse(input()).success).toBe(true);
  });

  it("accepts the details when they are known", () => {
    const r = offlineBookingSchema.safeParse(input({
      customerName: "Priya R", customerPhone: "+919876543210",
      reference: "PH-4471", notes: "Reception, 300 guests",
    }));
    expect(r.success).toBe(true);
  });
});

describe("date rules", () => {
  it("refuses an end date before the start", () => {
    expect(offlineBookingSchema.safeParse(
      input({ eventDate: "2027-05-10", endDate: "2027-05-09" }),
    ).success).toBe(false);
  });

  it("accepts a single day and a multi-day range", () => {
    expect(offlineBookingSchema.safeParse(input()).success).toBe(true);
    expect(offlineBookingSchema.safeParse(
      input({ eventDate: "2027-05-10", endDate: "2027-05-14" }),
    ).success).toBe(true);
  });

  it("refuses a range longer than the RPC will accept", () => {
    // Mirrors create_offline_booking's own ceiling so the owner gets a field
    // error rather than a database exception surfaced as a generic failure.
    expect(offlineBookingSchema.safeParse(
      input({ eventDate: "2027-05-01", endDate: "2027-06-05" }),
    ).success).toBe(false);
  });

  it("allows a PAST date — a venue reconciling last month's diary is normal", () => {
    // Deliberately not bounded to the future: the database decides whether the
    // inventory is actually free, and a UI-level rule here would only stop
    // someone recording history they already have.
    expect(offlineBookingSchema.safeParse(
      input({ eventDate: "2024-01-05", endDate: "2024-01-05" }),
    ).success).toBe(true);
  });
});

describe("slot conflict semantics — the SQL and the TS must agree", () => {
  // assert_inventory_free re-encodes these sets in SQL. If someone adds a status
  // to one side and not the other, a date silently becomes double-bookable, so
  // the membership is pinned here explicitly rather than assumed.
  it("blocks every slot on the hard statuses, including an offline booking", () => {
    for (const s of ["booked", "blocked", "full_day_booked", "maintenance"]) {
      expect(HARD_BLOCK_STATUSES.has(s), `${s} must block any slot`).toBe(true);
    }
  });

  it("keeps the half-day statuses on their own side", () => {
    expect(MORNING_BLOCK_STATUSES.has("morning_booked")).toBe(true);
    expect(MORNING_BLOCK_STATUSES.has("evening_booked")).toBe(false);
    expect(EVENING_BLOCK_STATUSES.has("evening_booked")).toBe(true);
    expect(EVENING_BLOCK_STATUSES.has("morning_booked")).toBe(false);
  });

  it("treats partially_booked as blocking BOTH halves", () => {
    // The one that is easy to get wrong: a partially-booked day has one half
    // gone, so neither a full-day claim nor the remaining half is safe to sell
    // without knowing which half — and this schema does not record which.
    expect(MORNING_BLOCK_STATUSES.has("partially_booked")).toBe(true);
    expect(EVENING_BLOCK_STATUSES.has("partially_booked")).toBe(true);
  });
});
