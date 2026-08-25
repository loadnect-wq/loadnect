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

import { getSupabaseServerClient } from "@/lib/supabase/server";

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
    const supabase = await getSupabaseServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from("halls")
      .select("slug, city, updated_at, created_at")
      .eq("status", "approved")
      .order("updated_at", { ascending: false })
      .limit(5000);

    if (error) {
      console.error("[seo/sitemap] venue query failed:", error.message);
      return [];
    }

    return ((data ?? []) as { slug: string; city: string; updated_at: string | null; created_at: string }[])
      .filter((h) => typeof h.slug === "string" && h.slug.length > 0)
      .map((h) => ({
        slug: h.slug,
        city: (h.city ?? "").trim(),
        updatedAt: h.updated_at ?? h.created_at,
      }));
  } catch (e) {
    console.error("[seo/sitemap] failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
