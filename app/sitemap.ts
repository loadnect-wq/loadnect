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
import { fetchIndexableCities, citySlug } from "@/lib/seo/cities";
import { legalLastModified } from "@/lib/content";

// Always reflect current inventory: a hall approved an hour ago should be
// discoverable today, not at the next deploy.
export const revalidate = 3600;

/**
 * Newest of a set of ISO timestamps, or undefined when there is nothing real to
 * report.
 *
 * Date.parse, not a string compare: the offset format is PostgREST's to choose
 * and lexicographic order is not something to bet the sitemap on. Unparseable
 * values are DROPPED rather than passed through — an Invalid Date is truthy, so
 * it would reach Next's .toISOString() and 500 the whole sitemap over one bad
 * row.
 */
function newestDate(values: string[]): Date | undefined {
  let best = -Infinity;
  for (const v of values) {
    const t = Date.parse(v);
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best === -Infinity ? undefined : new Date(best);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // A PAGE GETS A lastmod ONLY WHEN SOMETHING IN THE TREE GENUINELY BOUNDS WHEN
  // ITS CONTENT CHANGED. Six entries used to carry `new Date()`, which told
  // Google every one of them was rewritten on every crawl.
  //
  //   * / , /halls and each city page  -> halls.updated_at, the inventory they
  //     actually render.
  //   * the six legal pages            -> LEGAL_LAST_UPDATED, the same constant
  //     that prints "Last updated" on the page itself.
  //   * /premium, /about, /contact, /owner/register -> NOTHING, so they carry
  //     no lastmod at all. premium_plans.updated_at tracks prices, not this
  //     page's copy; and there is no per-file git timestamp at runtime, because
  //     the function bundle ships compiled output, not .git.
  //
  // Omitting is the honest option and it costs nothing. Google ignores a
  // lastmod it can disprove — and disproving one teaches it to distrust the
  // other ten, which is how a real signal gets thrown away to dress up four
  // fake ones.
  const [venues, cities] = await Promise.all([
    fetchIndexableVenues(),
    fetchIndexableCities(),
  ]);

  // The only honest date this file has for a listing page: the newest change to
  // the approved inventory those pages render.
  const inventoryUpdated = newestDate(venues.map((v) => v.updatedAt));
  const inventoryLastModified = inventoryUpdated ? { lastModified: inventoryUpdated } : {};

  const staticEntries: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), ...inventoryLastModified, changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/halls"), ...inventoryLastModified, changeFrequency: "daily", priority: 0.9 },
    { url: absoluteUrl("/premium"), changeFrequency: "monthly", priority: 0.5 },
    // The venue-owner landing page. robots.txt carries an explicit Allow for it
    // (it is the one public page under the otherwise-private /owner), but it was
    // missing here — the single page whose job is to win inventory was the one
    // page Google was not told about. High priority: with no venues there is no
    // marketplace.
    { url: absoluteUrl("/owner/register"), changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/about"), changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/contact"), changeFrequency: "yearly", priority: 0.3 },
    // Legal pages: low priority, but genuine, unique, indexable content that
    // Google likes to see on a marketplace handling payments.
    //
    // Their dates come from LEGAL_LAST_UPDATED, the same constant that prints
    // the "Last updated" line on the page itself. They used to be `now` like
    // everything else, which told Google all six policies were rewritten on
    // every crawl while the pages themselves said August — a lastModified a
    // crawler can check and find wrong is worth less than none, and these are
    // exactly the pages where a stale-looking date matters least and a false
    // one matters most.
    { url: absoluteUrl("/terms"), lastModified: legalLastModified("/terms"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/privacy"), lastModified: legalLastModified("/privacy"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/refund-policy"), lastModified: legalLastModified("/refund-policy"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/cancellation-policy"), lastModified: legalLastModified("/cancellation-policy"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/disclaimer"), lastModified: legalLastModified("/disclaimer"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/grievance-redressal"), lastModified: legalLastModified("/grievance-redressal"), changeFrequency: "yearly", priority: 0.2 },
  ];

  // PER CITY, not the global maximum: /wedding-halls/madurai changing is a
  // statement about Madurai's inventory, and a city with no venue row gets no
  // date rather than one borrowed from somewhere else.
  const newestByCitySlug = new Map<string, number>();
  for (const v of venues) {
    const t = Date.parse(v.updatedAt);
    if (!Number.isFinite(t)) continue;
    const slug = citySlug(v.city);
    if (!slug) continue;
    const prev = newestByCitySlug.get(slug);
    if (prev === undefined || t > prev) newestByCitySlug.set(slug, t);
  }

  // City pages appear ONLY when they hold real inventory (lib/seo/cities.ts).
  const cityEntries: MetadataRoute.Sitemap = cities.map((c) => {
    const t = newestByCitySlug.get(c.slug);
    return {
      url: absoluteUrl(`/wedding-halls/${c.slug}`),
      ...(t !== undefined ? { lastModified: new Date(t) } : {}),
      changeFrequency: "daily" as const,
      priority: 0.8,
    };
  });

  const venueEntries: MetadataRoute.Sitemap = venues.map((v) => {
    // Parsed, not trusted. `new Date(badString)` is an Invalid Date, which is
    // truthy and blows up in Next's serializer — one malformed timestamp would
    // 500 the entire sitemap. No usable date means no lastmod for that venue.
    const t = Date.parse(v.updatedAt ?? "");
    return {
      url: absoluteUrl(`/halls/${v.slug}`),
      ...(Number.isFinite(t) ? { lastModified: new Date(t) } : {}),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    };
  });

  // Final guard: nothing on a preview/localhost/retired host ever ships, even
  // if an env var is misconfigured at build time.
  return [...staticEntries, ...cityEntries, ...venueEntries].filter((e) =>
    isPublishableUrl(typeof e.url === "string" ? e.url : String(e.url)),
  );
}
