// ─────────────────────────────────────────────────────────────────────────────
// lib/venue-types.ts — the event types a venue serves, and how they are worded.
//
// PURE. No "server-only", no database, no env — so the same list and the same
// sentence are available to the public venue page (a Client Component), the
// owner's form, the admin list and the search filter, and none of them can
// disagree about what "banquet" means or how to print it.
//
// WHY IT MOVED OUT OF lib/halls.ts. The vocabulary used to live there, next to
// the query builder. lib/halls.ts reaches the database, so a Client Component
// importing the list for display would pull server code into the browser
// bundle. The list is now here and lib/halls.ts re-exports it, so the filter
// keeps its local binding and the UI gets a safe import.
//
// THE COLUMN IS `not null default '{}'` (migration 0037), and its own comment
// states the rule this module honours: "Empty = not specified by the owner".
// Empty is NOT "all of them", so an undeclared venue must say nothing at all —
// which is why the formatter returns null rather than a fallback sentence.
// ─────────────────────────────────────────────────────────────────────────────

/** Event types a venue can serve — pinned by halls_venue_types_allowed (0037). */
export const VENUE_TYPE_CATEGORIES = ["wedding", "reception", "party", "banquet"] as const;
export type VenueType = (typeof VENUE_TYPE_CATEGORIES)[number];

const VENUE_TYPE_NOUNS: Record<VenueType, string> = {
  wedding:   "weddings",
  reception: "receptions",
  party:     "parties",
  banquet:   "banquets",
};

/**
 * One plain sentence naming what a venue hosts, or null when it declared
 * nothing.
 *
 * Two deliberate properties:
 *
 *  1. NULL FOR EMPTY. The caller renders nothing. There is no default sentence,
 *     because "hosts weddings" about a venue that never said so is invented
 *     content on a page whose whole value is being accurate about a real place.
 *
 *  2. ITERATES THE CANONICAL LIST, not the stored array. The order is therefore
 *     the same no matter what order the owner ticked the boxes in — otherwise
 *     re-saving the form would silently reword an indexed page — and a value
 *     outside the 0037 vocabulary is dropped rather than printed raw.
 *
 * The join is manual rather than Intl.ListFormat: en-IN and en disagree about
 * the Oxford comma, and this string is asserted in tests.
 */
export function venueTypesSentence(
  raw: readonly string[] | null | undefined,
  hall: { name: string; city: string },
): string | null {
  const known = VENUE_TYPE_CATEGORIES.filter((t) => raw?.includes(t));
  if (known.length === 0) return null;

  const nouns = known.map((t) => VENUE_TYPE_NOUNS[t]);
  const list =
    nouns.length === 1
      ? nouns[0]
      : `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`;

  return `${hall.name} hosts ${list} in ${hall.city}.`;
}
