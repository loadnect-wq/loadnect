// ─────────────────────────────────────────────────────────────────────────────
// lib/venue-types.ts — how a venue's declared occasions are worded on its page.
//
// PURE. No "server-only", no database, no env — so the same sentence is
// available to the public venue page (a Client Component), the owner's form,
// the admin list and the search filter, and none of them can disagree.
//
// WHAT CHANGED IN 0102. The vocabulary used to be four values hard-coded here
// and repeated in a CHECK constraint. It is now public.venue_categories, which
// an admin edits without a deploy, so this module no longer OWNS a list — it
// formats one that is handed to it. lib/venue-categories.ts holds the shape and
// the ordering; lib/venue-categories.server.ts fetches it.
//
// THE COLUMN IS STILL `not null default '{}'` (migration 0037), and its rule is
// unchanged: "Empty = not specified by the owner". Empty is NOT "all of them",
// so an undeclared venue must say nothing at all — which is why the formatter
// returns null rather than a fallback sentence.
// ─────────────────────────────────────────────────────────────────────────────

import {
  joinCategoryNouns,
  selectCategories,
  ORIGINAL_VENUE_TYPE_SLUGS,
  type VenueCategory,
} from "@/lib/venue-categories";

/**
 * The four slugs the platform launched with.
 *
 * KEPT AS AN ALIAS, NOT AS THE VOCABULARY. Before 0102 this constant WAS the
 * list of permitted values; it is now just the four that must never disappear
 * from the catalogue, because every hall, lead and indexed page built before
 * the expansion refers to them. lib/__tests__/venue-categories.test.ts asserts
 * the seed still contains all four.
 *
 * New code should read the catalogue instead — see lib/venue-categories.server.
 */
export const VENUE_TYPE_CATEGORIES = ORIGINAL_VENUE_TYPE_SLUGS;
export type VenueType = (typeof VENUE_TYPE_CATEGORIES)[number];

/**
 * One plain sentence naming what a venue hosts, or null when it declared
 * nothing.
 *
 * Three deliberate properties:
 *
 *  1. NULL FOR EMPTY. The caller renders nothing. There is no default sentence,
 *     because "hosts weddings" about a venue that never said so is invented
 *     content on a page whose whole value is being accurate about a real place.
 *
 *  2. ITERATES THE CATALOGUE, not the stored array. The order is therefore the
 *     same no matter what order the owner ticked the boxes in — otherwise
 *     re-saving the form would silently reword an indexed page — and a value
 *     outside the catalogue is dropped rather than printed raw.
 *
 *  3. NULL WHEN THE CATALOGUE IS EMPTY, which is what a failed read looks like.
 *     The page then omits the sentence. That is under-reporting, and it is the
 *     right failure: the alternative is printing slugs, or guessing at wording
 *     for an occasion whose name we could not load.
 *
 * The join is manual rather than Intl.ListFormat: en-IN and en disagree about
 * the Oxford comma, and this string is asserted in tests.
 */
export function venueTypesSentence(
  raw: readonly string[] | null | undefined,
  hall: { name: string; city: string },
  catalogue: readonly VenueCategory[],
): string | null {
  return venueCategoriesSentence(selectCategories(raw, catalogue), hall);
}

/**
 * The same sentence, from categories that have ALREADY been resolved against
 * the catalogue.
 *
 * This is the form the venue page uses. It matters because that page is a
 * Client Component: passing it the whole 28-row catalogue so it can pick three
 * rows out of it would ship the entire vocabulary — names, descriptions, icons
 * — in the RSC payload of every venue page, to render one sentence and a row
 * of chips. The server resolves; the client receives what it renders.
 */
export function venueCategoriesSentence(
  categories: readonly VenueCategory[],
  hall: { name: string; city: string },
): string | null {
  const list = joinCategoryNouns(categories);
  if (!list) return null;
  return `${hall.name} hosts ${list} in ${hall.city}.`;
}
