// ─────────────────────────────────────────────────────────────────────────────
// lib/seo/cities.ts — city landing pages, gated on REAL inventory.
//
// THE RULE THAT SHAPES THIS FILE: a city page is indexable only when Hallnect
// actually has approved venues in that city. Publishing /wedding-halls/chennai
// with zero halls is a doorway page — thin, useless to a searcher, and exactly
// the programmatic-SEO spam that earns manual actions. So indexability is
// computed from a live count, never from a hard-coded list of ambitions.
//
// The page still EXISTS for a zero-inventory city (people do search for it, and
// the guide content is genuinely useful) — it is simply marked noindex and kept
// out of the sitemap until inventory arrives, at which point it flips to
// indexable automatically with no code change.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";
import { SERVICE_AREA_CITIES } from "./service-areas";

import { getSupabasePublicClient } from "@/lib/supabase/public";
import { slugify } from "@/lib/utils";

/** Minimum approved venues before a city page earns a place in the index. */
export const MIN_VENUES_FOR_INDEX = 1;

/** Cities Hallnect actively serves. Presence here does NOT imply indexable. */
// The list lives in service-areas.ts so a Client Component can read it too;
// re-exported here because most callers already import it from this module.
export { SERVICE_AREA_CITIES } from "./service-areas";

export type CityInventory = {
  city: string;
  slug: string;
  venueCount: number;
  indexable: boolean;
};

/** Canonical slug for a city name ("Tiruchirappalli" -> "tiruchirappalli"). */
export function citySlug(city: string): string {
  return slugify(city);
}

/** Resolves a URL slug back to the canonical city name, or null. */
export function cityFromSlug(slug: string): string | null {
  const target = slug.trim().toLowerCase();
  return SERVICE_AREA_CITIES.find((c) => citySlug(c) === target) ?? null;
}

/**
 * THREE STATES, NOT TWO. A failed query and a genuinely empty catalogue are
 * different facts and this module must never conflate them.
 *
 * Returning [] for a failed read is the defect that made this refactor
 * necessary: fetchCityInventoryBySlug turns an absent city into
 * `{ venueCount: 0, indexable: false }`, so ONE swallowed database error was
 * enough to re-render /wedding-halls/madurai — the only page on this site that
 * targets "wedding halls in Madurai" — as noindex, and to empty the sitemap
 * behind an HTTP 200. Both pages would have looked perfectly healthy.
 *
 * So the query reports failure, and each caller decides what to do with it:
 *   - UI that can degrade (the homepage's city tiles) takes the lenient
 *     wrapper and shows nothing.
 *   - Anything that decides INDEXABILITY takes the strict one and throws.
 *     Both the city page and the sitemap are ISR, so a throw during
 *     revalidation makes Next keep serving the last good version — which is
 *     exactly the behaviour we want from a transient database blip.
 */
type InventoryResult =
  | { ok: true; rows: CityInventory[] }
  | { ok: false; reason: string };

async function queryCityInventory(): Promise<InventoryResult> {
  try {
    // Cookie-free: reading cookies makes the route dynamic, and this page
    // has nothing per-visitor on it — counts approved halls per city.
    const supabase = getSupabasePublicClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from("halls")
      .select("city")
      .eq("status", "approved");

    if (error) {
      console.error("[seo/cities] inventory query failed:", error.message);
      return { ok: false, reason: error.message };
    }

    const counts = new Map<string, number>();
    for (const row of (data ?? []) as { city: string }[]) {
      const name = (row.city ?? "").trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    // Every city with inventory, plus the declared service areas (which may
    // legitimately have zero and therefore stay out of the index).
    const names = new Set<string>([...counts.keys(), ...SERVICE_AREA_CITIES]);

    const rows = [...names]
      .map((city) => {
        const venueCount = counts.get(city) ?? 0;
        return {
          city,
          slug: citySlug(city),
          venueCount,
          indexable: venueCount >= MIN_VENUES_FOR_INDEX,
        };
      })
      .sort((a, b) => b.venueCount - a.venueCount || a.city.localeCompare(b.city));

    return { ok: true, rows };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[seo/cities] inventory failed:", reason);
    return { ok: false, reason };
  }
}

/**
 * Lenient: [] on failure. ONLY for UI that can honestly render nothing — the
 * homepage's city tiles disappear, which is a smaller lie than a 500. Never
 * use this to decide whether a page is indexable.
 */
export async function fetchCityInventory(): Promise<CityInventory[]> {
  const result = await queryCityInventory();
  return result.ok ? result.rows : [];
}

/**
 * Strict: throws on failure. For every caller whose answer changes what search
 * engines are told. Both such callers are ISR, so the throw preserves the last
 * good render instead of publishing a wrong one.
 */
export async function fetchCityInventoryStrict(): Promise<CityInventory[]> {
  const result = await queryCityInventory();
  if (!result.ok) {
    throw new Error(
      `[seo/cities] refusing to decide indexability from a failed read: ${result.reason}`,
    );
  }
  return result.rows;
}

/** Inventory for one city, or null when the slug is not a service area. */
export async function fetchCityInventoryBySlug(slug: string): Promise<CityInventory | null> {
  const city = cityFromSlug(slug);
  if (!city) return null;
  // STRICT. This value becomes the page's `indexable` flag; a swallowed error
  // here is how a live city page silently goes noindex.
  const all = await fetchCityInventoryStrict();
  return (
    all.find((c) => c.slug === citySlug(city)) ?? {
      city,
      slug: citySlug(city),
      venueCount: 0,
      indexable: false,
    }
  );
}

/** Only the cities that have earned indexing — the sitemap's source. */
export async function fetchIndexableCities(): Promise<CityInventory[]> {
  // STRICT: an empty sitemap served with a 200 tells Google these URLs are
  // gone. Better to throw and let ISR keep serving the previous sitemap.
  return (await fetchCityInventoryStrict()).filter((c) => c.indexable);
}
