// ─────────────────────────────────────────────────────────────────────────────
// lib/venue-categories.server.ts — reading public.venue_categories (0102).
//
// Import only from Server Components, Route Handlers or Server Actions. The
// shape, grouping and wording live in lib/venue-categories.ts, which a Client
// Component may import; this file is the database half.
//
// THREE STATES, NOT TWO — the same rule as lib/seo/cities.ts, for the same
// reason. A failed read and a genuinely empty catalogue are different facts,
// and conflating them is the recurring defect in this codebase: a swallowed
// error returns an empty list, and the empty list renders as a confident
// statement about the world.
//
// Here the three callers want three different things:
//
//   * DECORATION (the homepage discovery grid, the /halls chips) takes the
//     lenient wrapper and renders nothing. A missing strip is honest.
//   * THE OWNER'S PICKER takes the strict one, because an empty picker in a
//     form that SAVES would let an owner wipe the categories their listing is
//     found by, having been shown no options to keep.
//   * ANYTHING DECIDING INDEXABILITY takes the strict one. Both such callers
//     are ISR, so a throw during revalidation makes Next keep serving the last
//     good version — exactly the right response to a transient blip in Sydney.
//
// CACHING. Wrapped in React `cache`, so the half-dozen components that each
// need the list during one render share a single round trip. It is NOT wrapped
// in unstable_cache: the admin edits this table and expects the change to show
// up, and the pages that render it are already ISR with their own revalidate.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";
import { cache } from "react";

import { getSupabasePublicClient } from "@/lib/supabase/public";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  isVenueCategoryGroup,
  sortCategories,
  type VenueCategory,
} from "@/lib/venue-categories";

type CatalogueResult =
  | { ok: true; rows: VenueCategory[] }
  | { ok: false; reason: string };

const SELECT =
  "id, slug, name, plural_noun, description, icon, category_group, is_active, display_order";

type Row = {
  id:             string;
  slug:           string;
  name:           string;
  plural_noun:    string;
  description:    string | null;
  icon:           string | null;
  category_group: string;
  is_active:      boolean;
  display_order:  number;
};

/**
 * A database row as the application's shape.
 *
 * An unrecognised category_group falls back to "other" rather than being
 * dropped. The CHECK in 0102 pins the four values, so this is unreachable
 * today — but a category that vanished from every picker because a fifth group
 * was added in SQL first would be a very quiet bug, and "Other" is a heading
 * that already exists and tells no lie.
 */
function toCategory(r: Row): VenueCategory {
  return {
    slug:         r.slug,
    name:         r.name,
    pluralNoun:   r.plural_noun,
    description:  r.description,
    icon:         r.icon,
    group:        isVenueCategoryGroup(r.category_group) ? r.category_group : "other",
    isActive:     Boolean(r.is_active),
    displayOrder: Number.isFinite(Number(r.display_order)) ? Number(r.display_order) : 1000,
  };
}

/**
 * Every ACTIVE category, in catalogue order.
 *
 * Cookie-free client: this is public reference data, identical for every
 * visitor, and reading cookies would make each page that renders it dynamic.
 * RLS additionally hides inactive rows from anon (0102), so the `.eq` below is
 * the second of two layers rather than the only one.
 */
const queryActive = cache(async (): Promise<CatalogueResult> => {
  try {
    const supabase = getSupabasePublicClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from("venue_categories")
      .select(SELECT)
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      // ── A MISSING TABLE IS A FACT, NOT AN UNKNOWN ────────────────────────
      //
      // PGRST205 / 42P01 = venue_categories does not exist, which is the
      // expected state in the window between this code shipping and 0102 being
      // applied. That is genuinely "there are no categories" — not "we could
      // not find out" — so it returns ok with an empty list rather than
      // failing, and every strict caller degrades correctly:
      //
      //   * the sitemap emits no category URLs (there are none to emit);
      //   * /venues/<anything> 404s (no category exists to have a page);
      //   * the owner's picker shows its "could not be loaded" notice and
      //     keeps the selections the hall already holds.
      //
      // THIS DISTINCTION IS LOAD-BEARING AND WAS FOUND BY THE BUILD. Treating
      // it as a failure threw inside app/sitemap.ts's strict read during
      // prerender and aborted `next build` entirely — so a deploy could not
      // reach production ahead of its migration even to sit harmlessly waiting
      // for it. Everything else still fails loudly: a timeout, a permission
      // error or a broken query is an unknown, and an unknown must never
      // render as "nothing here".
      if (error.code === "PGRST205" || error.code === "42P01") {
        console.info("[venue-categories] table missing — apply migration 0102.");
        return { ok: true, rows: [] };
      }
      console.error("[venue-categories] read failed:", error.message);
      return { ok: false, reason: error.message ?? "read failed" };
    }

    return { ok: true, rows: sortCategories((data ?? []).map(toCategory)) };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[venue-categories] read failed:", reason);
    return { ok: false, reason };
  }
});

/**
 * Lenient: [] on failure. ONLY for surfaces that can honestly render nothing —
 * a discovery strip disappears, a chip row shrinks. Never use this to build a
 * form that saves, and never to decide indexability.
 */
export async function fetchVenueCategories(): Promise<VenueCategory[]> {
  const result = await queryActive();
  return result.ok ? result.rows : [];
}

/**
 * Strict: throws on failure. For the owner's picker, the admin's table and
 * every caller whose answer changes what search engines are told.
 */
export async function fetchVenueCategoriesStrict(): Promise<VenueCategory[]> {
  const result = await queryActive();
  if (!result.ok) {
    throw new Error(`[venue-categories] catalogue unavailable: ${result.reason}`);
  }
  return result.rows;
}

/**
 * One ACTIVE category by slug, or null.
 *
 * STRICT underneath. This resolves a URL segment into a page, and a swallowed
 * error here would turn /venues/birthday-party — a live, indexed page — into a
 * 404 for as long as the blip lasted, which is the kind of thing Google
 * remembers.
 */
export async function fetchVenueCategoryBySlug(slug: string): Promise<VenueCategory | null> {
  const rows = await fetchVenueCategoriesStrict();
  return rows.find((c) => c.slug === slug) ?? null;
}

/**
 * EVERY category including the deactivated ones, with the number of approved
 * halls declaring each — the admin's view.
 *
 * SESSION CLIENT, not the cookie-free one: RLS returns inactive rows only to
 * is_admin(), which needs the caller's cookies. An admin page reading this
 * through the public client would silently see only the active half.
 *
 * Strict by construction — it throws — because this feeds a management screen
 * where "no categories exist" and "the read failed" would look identical and
 * the admin's next move (create them all again) would be wrong.
 */
export type AdminVenueCategory = VenueCategory & {
  /**
   * The primary key, which the PUBLIC VenueCategory shape deliberately lacks.
   *
   * Public pages render categories by slug and have no use for a UUID; the
   * admin's edit, reorder and deactivate actions all address rows by id.
   * Keeping it off the public type means it is not serialised into the RSC
   * payload of every venue page and every chip row.
   */
  id: string;
  /** Approved halls declaring this category. */
  hallCount: number;
};

export async function fetchVenueCategoriesForAdmin(): Promise<AdminVenueCategory[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [catalogue, halls] = await Promise.all([
    db.from("venue_categories").select(SELECT).order("display_order", { ascending: true }),
    // Approved halls only. The count is the admin's answer to "is anything
    // using this?" before they deactivate it, and a pending or rejected
    // listing is not something a visitor can reach.
    db.from("halls").select("venue_types").eq("status", "approved"),
  ]);

  if (catalogue.error) {
    throw new Error(`[venue-categories] admin read failed: ${catalogue.error.message}`);
  }
  // The counts are a nicety; the list is not. A failed hall read leaves every
  // count at zero, which would read as "nothing uses this, safe to retire" —
  // so it throws rather than under-reporting.
  if (halls.error) {
    throw new Error(`[venue-categories] hall usage read failed: ${halls.error.message}`);
  }

  const counts = new Map<string, number>();
  for (const row of (halls.data ?? []) as { venue_types: string[] | null }[]) {
    for (const slug of row.venue_types ?? []) {
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
  }

  const byId = new Map<string, string>();
  for (const r of (catalogue.data ?? []) as Row[]) byId.set(r.slug, r.id);

  return sortCategories((catalogue.data ?? []).map(toCategory)).map((c) => ({
    ...c,
    id:        byId.get(c.slug) ?? "",
    hallCount: counts.get(c.slug) ?? 0,
  }));
}

// ── Inventory, for discovery and for indexability ────────────────────────────

export type CategoryInventory = {
  slug:       string;
  venueCount: number;
  /** Venues in this category, per city name, for the city-level landing pages. */
  byCity:     Map<string, number>;
};

/**
 * How many approved halls declare each category, overall and per city.
 *
 * ONE QUERY, not one per category. The alternative — a count per category, or
 * worse a count per category per city — is 28 round trips to Sydney for the
 * homepage, then 560 for the sitemap. The array comes back once and is counted
 * here.
 */
const queryInventory = cache(async (): Promise<
  { ok: true; rows: Map<string, CategoryInventory> } | { ok: false; reason: string }
> => {
  try {
    const supabase = getSupabasePublicClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from("halls")
      .select("city, venue_types")
      .eq("status", "approved");

    if (error) {
      console.error("[venue-categories] inventory read failed:", error.message);
      return { ok: false, reason: error.message };
    }

    const rows = new Map<string, CategoryInventory>();
    for (const hall of (data ?? []) as { city: string | null; venue_types: string[] | null }[]) {
      const city = (hall.city ?? "").trim();
      // A hall may declare several categories and counts once in each. These
      // are "venues you could hold a birthday party in", not a partition.
      for (const slug of hall.venue_types ?? []) {
        let entry = rows.get(slug);
        if (!entry) {
          entry = { slug, venueCount: 0, byCity: new Map() };
          rows.set(slug, entry);
        }
        entry.venueCount += 1;
        if (city) entry.byCity.set(city, (entry.byCity.get(city) ?? 0) + 1);
      }
    }

    return { ok: true, rows };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[venue-categories] inventory read failed:", reason);
    return { ok: false, reason };
  }
});

/** Lenient: an empty map on failure. Decoration only. */
export async function fetchCategoryInventory(): Promise<Map<string, CategoryInventory>> {
  const result = await queryInventory();
  return result.ok ? result.rows : new Map();
}

/** Strict: throws. For the category pages and the sitemap. */
export async function fetchCategoryInventoryStrict(): Promise<Map<string, CategoryInventory>> {
  const result = await queryInventory();
  if (!result.ok) {
    throw new Error(
      `[venue-categories] refusing to decide indexability from a failed read: ${result.reason}`,
    );
  }
  return result.rows;
}

/**
 * Minimum approved venues before a category page earns a place in the index.
 *
 * The same rule and the same number as MIN_VENUES_FOR_INDEX for cities, and it
 * exists for the same reason: /venues/photoshoot listing nothing is a doorway
 * page. With 28 categories and ~20 service areas the combination space is 560
 * URLs, which is exactly the "thousands of low-value dynamic pages" that earns
 * a manual action. Gating every one of them on real inventory means the site
 * publishes the handful that are real and nothing else, and each flips to
 * indexable on its own the moment a venue declares it.
 */
export const MIN_VENUES_FOR_CATEGORY_INDEX = 1;
