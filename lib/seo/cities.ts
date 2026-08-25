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

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";

/** Minimum approved venues before a city page earns a place in the index. */
export const MIN_VENUES_FOR_INDEX = 1;

/** Cities Hallnect actively serves. Presence here does NOT imply indexable. */
export const SERVICE_AREA_CITIES = [
  "Madurai",
  "Chennai",
  "Coimbatore",
  "Tiruchirappalli",
  "Salem",
  "Tirunelveli",
  "Thanjavur",
  "Erode",
] as const;

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
 * Live approved-venue counts per city, straight from the database.
 * Uses the session client, so RLS applies: only publicly visible (approved)
 * halls are ever counted, which is precisely the indexability question.
 */
export async function fetchCityInventory(): Promise<CityInventory[]> {
  try {
    const supabase = await getSupabaseServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from("halls")
      .select("city")
      .eq("status", "approved");

    if (error) {
      console.error("[seo/cities] inventory query failed:", error.message);
      return [];
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

    return [...names]
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
  } catch (e) {
    console.error("[seo/cities] inventory failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Inventory for one city, or null when the slug is not a service area. */
export async function fetchCityInventoryBySlug(slug: string): Promise<CityInventory | null> {
  const city = cityFromSlug(slug);
  if (!city) return null;
  const all = await fetchCityInventory();
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
  return (await fetchCityInventory()).filter((c) => c.indexable);
}
