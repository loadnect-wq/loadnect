// ─────────────────────────────────────────────────────────────────────────────
// app/sitemap.ts — dynamic sitemap built from live inventory.
//
// EVERY url here is: canonical (built by absoluteUrl), returns 200, self-
// canonicalising, and indexable. Nothing enters this file that is noindex,
// redirected, private or filtered — those are the four ways a sitemap loses
// Google's trust.
//
// Filtered listing URLs (/halls?city=…&sort=…) are deliberately ABSENT: they
// are query permutations of one page, they carry a canonical back to /halls,
// and listing them would invite Google to crawl an unbounded filter space.
//
// SCALE: Next.js emits a single sitemap.xml here. The 50,000-URL / 50MB limit
// is a long way off at current inventory; when venue count approaches it,
// generateSitemaps() splits this into an index without changing the data layer.
// ─────────────────────────────────────────────────────────────────────────────

import type { MetadataRoute } from "next";
import { absoluteUrl, isPublishableUrl } from "@/lib/seo/config";
import { fetchIndexableVenues } from "@/lib/seo/sitemap-data";
import { fetchIndexableCities } from "@/lib/seo/cities";

// Always reflect current inventory: a hall approved an hour ago should be
// discoverable today, not at the next deploy.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/halls"), lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: absoluteUrl("/premium"), lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    // The venue-owner landing page. robots.txt carries an explicit Allow for it
    // (it is the one public page under the otherwise-private /owner), but it was
    // missing here — the single page whose job is to win inventory was the one
    // page Google was not told about. High priority: with no venues there is no
    // marketplace.
    { url: absoluteUrl("/owner/register"), lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/contact"), lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    // Legal pages: low priority, but genuine, unique, indexable content that
    // Google likes to see on a marketplace handling payments.
    { url: absoluteUrl("/terms"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/privacy"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/refund-policy"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/cancellation-policy"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/disclaimer"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];

  const [venues, cities] = await Promise.all([
    fetchIndexableVenues(),
    fetchIndexableCities(),
  ]);

  // City pages appear ONLY when they hold real inventory (lib/seo/cities.ts).
  const cityEntries: MetadataRoute.Sitemap = cities.map((c) => ({
    url: absoluteUrl(`/wedding-halls/${c.slug}`),
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

  const venueEntries: MetadataRoute.Sitemap = venues.map((v) => ({
    url: absoluteUrl(`/halls/${v.slug}`),
    lastModified: v.updatedAt ? new Date(v.updatedAt) : now,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  // Final guard: nothing on a preview/localhost/retired host ever ships, even
  // if an env var is misconfigured at build time.
  return [...staticEntries, ...cityEntries, ...venueEntries].filter((e) =>
    isPublishableUrl(typeof e.url === "string" ? e.url : String(e.url)),
  );
}
