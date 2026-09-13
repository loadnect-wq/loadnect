import { describe, it, expect } from "vitest";
import { VENUE_TYPE_CATEGORIES, venueTypesSentence } from "@/lib/venue-types";

// ─────────────────────────────────────────────────────────────────────────────
// venue_types is required of every owner, stored, GIN-indexed and used as a
// search filter — and it was rendered on no page a crawler could read. Now it
// is one sentence in the About section, which makes its exact wording part of
// an indexed page and therefore worth pinning.
//
// Pure function, no database: these run in microseconds.
// ─────────────────────────────────────────────────────────────────────────────

const HALL = { name: "NS KHALYAANA MAHAL", city: "Madurai" };

describe("venueTypesSentence", () => {
  it("says nothing when the owner declared nothing", () => {
    // The column is `not null default '{}'` and migration 0037's own comment
    // says empty means UNDECLARED, not "all of them". A fallback sentence here
    // would be inventing a claim about a real venue.
    expect(venueTypesSentence([], HALL)).toBeNull();
    expect(venueTypesSentence(null, HALL)).toBeNull();
    expect(venueTypesSentence(undefined, HALL)).toBeNull();
  });

  it("names a single type", () => {
    expect(venueTypesSentence(["wedding"], HALL)).toBe(
      "NS KHALYAANA MAHAL hosts weddings in Madurai.",
    );
  });

  it("uses the canonical order, not the order the owner ticked boxes in", () => {
    // THE REGRESSION THIS EXISTS FOR. If the sentence followed the stored
    // array, re-saving the owner's form could reword an indexed page without
    // anything about the venue having changed.
    const a = venueTypesSentence(["reception", "wedding"], HALL);
    const b = venueTypesSentence(["wedding", "reception"], HALL);
    expect(a).toBe("NS KHALYAANA MAHAL hosts weddings and receptions in Madurai.");
    expect(a).toBe(b);
  });

  it("lists all four without an Oxford comma", () => {
    expect(venueTypesSentence([...VENUE_TYPE_CATEGORIES], HALL)).toBe(
      "NS KHALYAANA MAHAL hosts weddings, receptions, parties and banquets in Madurai.",
    );
  });

  it("drops a value outside the 0037 vocabulary rather than printing it", () => {
    // The CHECK constraint should make this impossible, but the render must not
    // be the thing that trusts it — an unknown value reaching the page would be
    // arbitrary owner-supplied text in an indexed sentence.
    expect(venueTypesSentence(["nightclub"], HALL)).toBeNull();
    expect(venueTypesSentence(["nightclub", "wedding"], HALL)).toBe(
      "NS KHALYAANA MAHAL hosts weddings in Madurai.",
    );
  });

  it("reads naturally for any venue name and city", () => {
    expect(venueTypesSentence(["banquet"], { name: "Sri Hall", city: "Chennai" })).toBe(
      "Sri Hall hosts banquets in Chennai.",
    );
  });
});

describe("the vocabulary is the one the database enforces", () => {
  it("matches halls_venue_types_allowed from migration 0037", () => {
    expect([...VENUE_TYPE_CATEGORIES].sort()).toEqual([
      "banquet",
      "party",
      "reception",
      "wedding",
    ]);
  });
});
