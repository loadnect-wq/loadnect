import { describe, it, expect } from "vitest";
import { venueTypesSentence, venueCategoriesSentence, VENUE_TYPE_CATEGORIES } from "@/lib/venue-types";
import type { VenueCategory } from "@/lib/venue-categories";

// ─────────────────────────────────────────────────────────────────────────────
// venue_types is required of every owner, stored, GIN-indexed and used as a
// search filter — and it was once rendered on no page a crawler could read. It
// is now one sentence in the About section plus the "Suitable for" chips, which
// makes its exact wording part of an indexed page and therefore worth pinning.
//
// WHAT MIGRATION 0102 CHANGED HERE. The vocabulary used to be four constants in
// this module; it is now public.venue_categories, which an admin edits. So the
// catalogue is passed IN, and these tests build one. The invariants under test
// are unchanged — null for undeclared, catalogue order not click order, unknown
// values dropped — plus one new one: an empty catalogue (a failed read) must
// say nothing rather than guess.
//
// Pure functions, no database: these run in microseconds.
// ─────────────────────────────────────────────────────────────────────────────

const HALL = { name: "NS KHALYAANA MAHAL", city: "Madurai" };

function cat(
  slug: string,
  name: string,
  pluralNoun: string,
  displayOrder: number,
  group: VenueCategory["group"] = "celebrations",
): VenueCategory {
  return { slug, name, pluralNoun, description: null, icon: null, group, isActive: true, displayOrder };
}

/** The four original types, in the order migration 0102 seeds them. */
const CATALOGUE: VenueCategory[] = [
  cat("wedding", "Wedding", "weddings", 110),
  cat("reception", "Reception", "receptions", 120),
  cat("banquet", "Banquet", "banquets", 140),
  cat("party", "Party", "parties", 200),
];

/** One of the occasions the expansion added, with a two-word plural. */
const BIRTHDAY = cat("birthday-party", "Birthday Party", "birthday parties", 150);

describe("venueTypesSentence", () => {
  it("says nothing when the owner declared nothing", () => {
    // The column is `not null default '{}'` and migration 0037's own comment
    // says empty means UNDECLARED, not "all of them". A fallback sentence here
    // would be inventing a claim about a real venue.
    expect(venueTypesSentence([], HALL, CATALOGUE)).toBeNull();
    expect(venueTypesSentence(null, HALL, CATALOGUE)).toBeNull();
    expect(venueTypesSentence(undefined, HALL, CATALOGUE)).toBeNull();
  });

  it("says nothing when the catalogue could not be read", () => {
    // NEW IN 0102. fetchVenueCategories is lenient on the venue page and
    // returns [] when the read fails. Under-reporting is the right failure
    // here; the alternative is printing slugs, or inventing wording for an
    // occasion whose name we could not load.
    expect(venueTypesSentence(["wedding"], HALL, [])).toBeNull();
  });

  it("names a single type", () => {
    expect(venueTypesSentence(["wedding"], HALL, CATALOGUE)).toBe(
      "NS KHALYAANA MAHAL hosts weddings in Madurai.",
    );
  });

  it("uses the catalogue order, not the order the owner ticked boxes in", () => {
    // THE REGRESSION THIS EXISTS FOR. If the sentence followed the stored
    // array, re-saving the owner's form could reword an indexed page without
    // anything about the venue having changed.
    const a = venueTypesSentence(["reception", "wedding"], HALL, CATALOGUE);
    const b = venueTypesSentence(["wedding", "reception"], HALL, CATALOGUE);
    expect(a).toBe("NS KHALYAANA MAHAL hosts weddings and receptions in Madurai.");
    expect(a).toBe(b);
  });

  it("lists all four without an Oxford comma", () => {
    expect(venueTypesSentence([...VENUE_TYPE_CATEGORIES], HALL, CATALOGUE)).toBe(
      "NS KHALYAANA MAHAL hosts weddings, receptions, banquets and parties in Madurai.",
    );
  });

  it("reads correctly with an occasion whose plural is two words", () => {
    // "birthday parties", not "birthday-partys". The plural is a stored column
    // precisely because English plurals are not a function of the singular.
    expect(
      venueTypesSentence(["wedding", "birthday-party"], HALL, [...CATALOGUE, BIRTHDAY]),
    ).toBe("NS KHALYAANA MAHAL hosts weddings and birthday parties in Madurai.");
  });

  it("drops a value outside the catalogue rather than printing it", () => {
    // The trigger in 0102 should make this impossible, but the render must not
    // be the thing that trusts it — an unknown value reaching the page would be
    // arbitrary owner-supplied text in an indexed sentence. It is also the
    // ordinary state of a hall whose category was later deactivated and then
    // renamed away.
    expect(venueTypesSentence(["nightclub"], HALL, CATALOGUE)).toBeNull();
    expect(venueTypesSentence(["nightclub", "wedding"], HALL, CATALOGUE)).toBe(
      "NS KHALYAANA MAHAL hosts weddings in Madurai.",
    );
  });

  it("reads naturally for any venue name and city", () => {
    expect(venueTypesSentence(["banquet"], { name: "Sri Hall", city: "Chennai" }, CATALOGUE)).toBe(
      "Sri Hall hosts banquets in Chennai.",
    );
  });
});

describe("venueCategoriesSentence", () => {
  it("is what venueTypesSentence resolves to", () => {
    // The venue page takes this form, because it receives its few already
    // resolved rows rather than the whole 28-row catalogue — see the doc
    // comment. The two must not drift.
    const resolved = CATALOGUE.filter((c) => c.slug === "wedding" || c.slug === "party");
    expect(venueCategoriesSentence(resolved, HALL)).toBe(
      venueTypesSentence(["party", "wedding"], HALL, CATALOGUE),
    );
  });

  it("says nothing for an empty list", () => {
    expect(venueCategoriesSentence([], HALL)).toBeNull();
  });
});
