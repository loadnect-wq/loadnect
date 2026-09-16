import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE EXISTS FOR
//
// Three places where the listing surfaces answered a question they had no
// answer to. All three share one shape: a venue that publishes NO calendar and
// MAY publish no price is treated as though silence were a "yes".
//
//   1. The date filter excluded halls with a BLOCKING availability row. A
//      LEAD_GENERATION venue has zero rows by construction, so it was never in
//      the excluded set and survived every date filter — including the
//      homepage's "Available Today" tile, which maps onto the same filter. The
//      search therefore told a customer the venue was free on a date while the
//      venue's own page deliberately refuses to make that claim.
//
//   2. "Price: high to low" led with every venue that publishes no price.
//      Postgres orders NULLs FIRST on DESC, and neither price sort passed
//      nullsFirst — while the default sort three lines below passes it
//      explicitly for premium_tier, so the option was known.
//
//   3. The venue page fetched 30 days of availability for a lead venue and
//      rendered nothing from it.
//
// These are SOURCE-LEVEL INVARIANTS, in the style of seo-invariants.test.ts:
// the behaviour they protect lives in a PostgREST query builder and in JSX, and
// the house rule is that a database guarantee is verified against the live
// database, not against a mock that agrees with us. What these can do is fail
// the build if the guard is deleted.
//
// Each extractor slices to the region first and carries a vacuity guard, because
// seo-invariants.test.ts:51-64 records a whole-file search matching the wrong
// string and asserting happily about it.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const halls = read("lib/halls.ts");
const card = read("app/halls/_components/HallCard.tsx");
const listPage = read("app/halls/page.tsx");
const detail = read("app/halls/[slug]/_components/HallDetailView.tsx");

/** The `switch (filters.sort)` block, and nothing else. */
function sortBlock(): string {
  const start = halls.indexOf("switch (filters.sort)");
  expect(start, "the sort switch moved or was renamed").toBeGreaterThan(-1);
  const end = halls.indexOf("return q;", start);
  expect(end, "could not find the end of buildQuery").toBeGreaterThan(start);
  const block = halls.slice(start, end);
  // Vacuity guard: all four cases must be in here, or the slice is wrong.
  for (const c of ["price-asc", "price-desc", "rating", "capacity"]) {
    expect(block, `sort slice does not contain ${c}`).toContain(c);
  }
  return block;
}

describe("an unpriced venue does not sort as the most expensive", () => {
  const block = sortBlock();

  it.each([["price-asc"], ["price-desc"]])(
    "%s pins NULL ordering instead of inheriting the Postgres default",
    (sortKey) => {
      const line = block.split("\n").find((l) => l.includes(`case "${sortKey}"`));
      expect(line, `no case for ${sortKey}`).toBeTruthy();
      expect(line).toContain("price_per_day");
      // The bug was the ABSENCE of this. DESC defaults to NULLS FIRST, so every
      // "Price on request" venue led the results.
      expect(line).toContain("nullsFirst: false");
    },
  );

  it("still orders by price_per_day, not by some derived column", () => {
    expect(block).toContain('q.order("price_per_day"');
  });
});

describe("a venue that publishes no calendar is not reported as free", () => {
  it("the card takes a dateFiltered flag", () => {
    // Without this the card cannot distinguish "free on your date" from
    // "we have no idea", and silence renders as a yes.
    expect(card).toContain("dateFiltered?: boolean");
  });

  it("the marker is shown only for a lead venue, and only under a date filter", () => {
    const line = card
      .split("\n")
      .find((l) => l.includes("const availabilityUnknown"));
    expect(line, "availabilityUnknown was removed").toBeTruthy();
    expect(line).toContain("dateFiltered === true");
    expect(line).toContain("isLeadGeneration(hall.booking_mode)");
  });

  it("and it actually renders something the reader can see", () => {
    expect(card).toContain("Availability on request");
  });

  it("the listing page passes effectiveDate, so 'Available Today' is covered too", () => {
    // ?available=today from the homepage tile is mapped onto `effectiveDate`,
    // NOT onto `date` — passing `date` here would leave that entry point lying.
    expect(listPage).toContain("dateFiltered={!!effectiveDate}");
  });
});

describe("the venue page does not fetch a calendar it will not draw", () => {
  it("the 30-day availability read is gated on the booking mode", () => {
    const start = halls.indexOf("const publishesCalendar");
    expect(start, "the availability gate was removed").toBeGreaterThan(-1);
    const region = halls.slice(start, start + 600);
    expect(region).toContain('=== "DIRECT_BOOKING"');
    expect(region).toContain('.from("availability")');
  });

  it("a lead venue is given the enquiry action instead of a grid of grey cells", () => {
    expect(detail).toContain("Ask the venue about your date");
    // The grid must be behind the direct-booking branch now.
    expect(detail).toContain("{!isLead && (");
  });

  it("the heading no longer promises thirty days of anything", () => {
    expect(detail).not.toContain('isLead ? "Next 30 days"');
    expect(detail).toContain('isLead ? "Your date"');
  });
});

describe("the location card does not render a map that failed to load", () => {
  it("the unconditional grey placeholder tile is gone", () => {
    // It rendered whether or not the venue had coordinates, at a fixed h-32,
    // and read as a broken map.
    expect(detail).not.toContain("Map placeholder tile");
    expect(detail).not.toMatch(/h-32[^\n]*bg-ivory-200/);
  });

  it("the Google Maps link survives, because that is the part that works", () => {
    expect(detail).toContain("View on Google Maps");
  });
});

describe("the budget filter's treatment of an unpriced venue is a decision, not an accident", () => {
  it("says so where the filter is built", () => {
    // .gte/.lte are both false against NULL, so a "Price on request" venue
    // vanishes from any budget-filtered search. That is intended — it cannot be
    // said to fall in a range — but it is silent, so it is written down.
    const start = halls.indexOf("A BUDGET FILTER DROPS AN UNPRICED VENUE");
    expect(start, "the explanation was deleted").toBeGreaterThan(-1);
    expect(halls.slice(start, start + 700)).toContain('q.gte("price_per_day"');
  });
});
