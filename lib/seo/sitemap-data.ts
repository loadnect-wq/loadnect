// ─────────────────────────────────────────────────────────────────────────────
// lib/seo/sitemap-data.ts — the ONLY query that decides what gets indexed.
//
// A sitemap is a promise: every URL in it returns 200, is canonical, is
// indexable and has content worth crawling. So this query mirrors, exactly, the
// condition the venue route uses to serve a page instead of a 404 —
// status = 'approved'. A draft, rejected, suspended or deleted hall is absent
// from both, by construction, rather than by two rules that can drift apart.
//
// It also selects updated_at, which the public fetchers do not expose, so
// lastModified is real rather than "now" on every crawl.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabasePublicClient } from "@/lib/supabase/public";

export type SitemapVenue = {
  slug: string;
  city: string;
  updatedAt: string;
};

/**
 * Every publicly indexable venue. Uses the session client so RLS enforces
 * public visibility as a second, independent guarantee alongside the explicit
 * status filter.
 */
export async function fetchIndexableVenues(): Promise<SitemapVenue[]> {
  try {
    // Cookie-free: this is the list of approved, public hall slugs, and reading
    // cookies was the only thing forcing /sitemap.xml to be rendered per request.
    const supabase = getSupabasePublicClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from("halls")
      .select("slug, city, updated_at, created_at")
      .eq("status", "approved")
      .order("updated_at", { ascending: false })
      .limit(5000);

    if (error) {
      // THROW, DO NOT RETURN []. The sitemap is the one document whose empty
      // state is a positive claim: "these URLs no longer exist." Returning []
      // here published that claim with an HTTP 200 every time a transient
      // database error happened to land on a revalidation. app/sitemap.ts is
      // ISR (revalidate 3600), so throwing makes Next keep serving the last
      // good sitemap — stale by up to an hour, which costs nothing, instead of
      // correct-looking and wrong.
      //
      // A genuinely empty catalogue is NOT this case: it returns ok with zero
      // rows and the sitemap simply carries its static entries.
      console.error("[seo/sitemap] venue query failed:", error.message);
      throw new Error(`[seo/sitemap] venue query failed: ${error.message}`);
    }

    return ((data ?? []) as { slug: string; city: string; updated_at: string | null; created_at: string }[])
      .filter((h) => typeof h.slug === "string" && h.slug.length > 0)
      .map((h) => ({
        slug: h.slug,
        city: (h.city ?? "").trim(),
        updatedAt: h.updated_at ?? h.created_at,
      }));
  } catch (e) {
    // Rethrow rather than swallow, for the reason above. The log stays so the
    // failure is visible in Vercel's function logs either way.
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[seo/sitemap] failed:", reason);
    throw e instanceof Error ? e : new Error(reason);
  }
}
