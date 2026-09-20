// ─────────────────────────────────────────────────────────────────────────────
// lib/venue-categories.ts — the occasions a venue hosts, as the UI sees them.
//
// PURE. No "server-only", no database, no env. The homepage discovery grid, the
// /halls chips, the owner's picker, the admin table, the venue page and the
// category landing pages all render from this shape, so none of them can
// disagree about what "birthday-party" is called or which heading it sits under.
//
// The DATA comes from public.venue_categories (migration 0102) and is fetched
// by lib/venue-categories.server.ts. This file holds only the shape, the
// grouping, and the formatting — the parts a Client Component may import.
//
// WHY A TABLE AND NOT A CONSTANT HERE. Adding an occasion used to mean editing
// five hard-coded arrays and a CHECK constraint, i.e. a deploy. It is now one
// admin form. The trade-off is that this module cannot know the list at build
// time, which is why every list below arrives as an argument rather than being
// imported — and why nothing here has a "default vocabulary" to fall back on.
// See fetchVenueCategoriesResult for what a failed read is allowed to render.
// ─────────────────────────────────────────────────────────────────────────────

/** A row of public.venue_categories, as the application reads it. */
export type VenueCategory = {
  slug:         string;
  name:         string;
  /** Lower-case plural for use inside a sentence: "weddings", "baby showers". */
  pluralNoun:   string;
  description:  string | null;
  /** A lucide-react export name. Resolved through a lookup with a fallback —
   *  never interpolated into markup. */
  icon:         string | null;
  group:        VenueCategoryGroup;
  isActive:     boolean;
  displayOrder: number;
};

/** The four headings categories are organised under. Pinned by 0102's CHECK. */
export const VENUE_CATEGORY_GROUPS = ["celebrations", "corporate", "community", "other"] as const;
export type VenueCategoryGroup = (typeof VENUE_CATEGORY_GROUPS)[number];

export const VENUE_CATEGORY_GROUP_LABELS: Record<VenueCategoryGroup, string> = {
  celebrations: "Events & celebrations",
  corporate:    "Corporate & business",
  community:    "Social & community",
  other:        "Other",
};

/** True for a value that is one of the four groups, for validating input. */
export function isVenueCategoryGroup(value: unknown): value is VenueCategoryGroup {
  return typeof value === "string" && (VENUE_CATEGORY_GROUPS as readonly string[]).includes(value);
}

/**
 * The slug shape 0102's CHECK enforces, restated so a bad value gets a sentence
 * from Zod instead of a Postgres error string.
 */
export const VENUE_CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isVenueCategorySlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 2 &&
    value.length <= 48 &&
    VENUE_CATEGORY_SLUG_PATTERN.test(value)
  );
}

// ── The four original types ──────────────────────────────────────────────────

/**
 * The 0037 vocabulary, kept as a constant for ONE job: proving in a test that
 * the catalogue still contains the four slugs every existing hall, lead and
 * indexed page was built on.
 *
 * NOT a fallback list and not a default. Rendering these four when the
 * catalogue read fails would quietly tell an owner their venue can only host
 * weddings, receptions, parties and banquets — which is the product as it was
 * before this expansion, presented as if it were current.
 */
export const ORIGINAL_VENUE_TYPE_SLUGS = ["wedding", "reception", "party", "banquet"] as const;

// ── Selecting and ordering ───────────────────────────────────────────────────

/**
 * The categories a given hall declared, in CATALOGUE order rather than the
 * order the owner ticked the boxes in.
 *
 * The ordering is the point. If this followed the stored array, re-saving the
 * owner's form could reword an indexed sentence and reshuffle the badges on a
 * card without anything about the venue having changed. A slug that is not in
 * the catalogue at all is DROPPED rather than printed: the trigger in 0102 is
 * supposed to make that impossible, but the render must not be the thing that
 * trusts it — an unknown value reaching the page would be arbitrary
 * owner-supplied text on a page a stranger reads as fact.
 */
export function selectCategories(
  slugs: readonly string[] | null | undefined,
  catalogue: readonly VenueCategory[],
): VenueCategory[] {
  if (!slugs || slugs.length === 0) return [];
  const wanted = new Set(slugs);
  return catalogue.filter((c) => wanted.has(c.slug));
}

/** Catalogue order: by group, then display_order, then name. */
export function sortCategories(rows: readonly VenueCategory[]): VenueCategory[] {
  const groupIndex = (g: VenueCategoryGroup) => VENUE_CATEGORY_GROUPS.indexOf(g);
  return [...rows].sort(
    (a, b) =>
      groupIndex(a.group) - groupIndex(b.group) ||
      a.displayOrder - b.displayOrder ||
      a.name.localeCompare(b.name, "en"),
  );
}

/** The catalogue split into its four headings, empty groups omitted. */
export function groupCategories(
  rows: readonly VenueCategory[],
): { group: VenueCategoryGroup; label: string; categories: VenueCategory[] }[] {
  return VENUE_CATEGORY_GROUPS.map((group) => ({
    group,
    label: VENUE_CATEGORY_GROUP_LABELS[group],
    categories: sortCategories(rows.filter((c) => c.group === group)),
  })).filter((g) => g.categories.length > 0);
}

export function findCategory(
  slug: string | null | undefined,
  catalogue: readonly VenueCategory[],
): VenueCategory | null {
  if (!slug) return null;
  return catalogue.find((c) => c.slug === slug) ?? null;
}

/**
 * slug -> display name, for components that render badges without holding the
 * whole catalogue (HallCard). A lookup rather than a list because a card has
 * one hall's slugs and no reason to carry twenty-eight rows to name three.
 */
export function categoryLabelMap(rows: readonly VenueCategory[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of rows) out[c.slug] = c.name;
  return out;
}

// ── Wording ──────────────────────────────────────────────────────────────────

/**
 * A plain list of plural nouns — "weddings, receptions and birthday parties".
 *
 * Manual join rather than Intl.ListFormat: en-IN and en disagree about the
 * Oxford comma, and these strings are asserted in tests and printed on indexed
 * pages.
 */
export function joinCategoryNouns(rows: readonly VenueCategory[]): string | null {
  const nouns = sortCategories(rows).map((c) => c.pluralNoun);
  if (nouns.length === 0) return null;
  if (nouns.length === 1) return nouns[0];
  return `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`;
}

/**
 * How a category names the venues in it: "Birthday Party" -> "Birthday Party
 * Halls". Used for page titles and tile labels.
 *
 * Categories whose name already ends in a venue-ish word ("Banquet") still read
 * correctly as "Banquet Halls"; the ones that would read badly ("Photoshoot
 * Halls") are the reason this is one function rather than a template literal
 * scattered across four files — fix the wording here and every surface follows.
 */
export function categoryVenueLabel(category: VenueCategory): string {
  return `${category.name} Halls`;
}

/** "wedding halls", for use mid-sentence. */
export function categoryVenuePhrase(category: VenueCategory): string {
  return `${category.name.toLowerCase()} halls`;
}
