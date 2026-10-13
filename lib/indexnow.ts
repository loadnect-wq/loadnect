// ─────────────────────────────────────────────────────────────────────────────
// lib/indexnow.ts — tell Bing (and the other IndexNow engines) when a public
// page changes, instead of waiting for them to recrawl.
//
// WHY (2026-10-12). ChatGPT search and Microsoft Copilot answer from Bing's
// index, and Bing had never been told hallnect.com exists: no Webmaster Tools,
// no pings. IndexNow is the protocol Bing reads change notices from; one POST
// reaches Bing, Yandex, Seznam and Naver. Google does not use it (Search
// Console covers Google).
//
// THE KEY IS PUBLIC BY DESIGN. IndexNow proves we own the host by fetching
// https://hallnect.com/<key>.txt and checking it contains the key, so the key
// is not a secret and lives here and in public/<key>.txt (a test pins that the
// two agree). Anyone can learn it; all it lets them do is notify search engines
// about URLs on hallnect.com, which they could crawl anyway.
//
// NEVER THROWS, AND PRODUCTION ONLY. A notice is a courtesy to a search engine;
// it must never fail the hall approval or edit that triggered it. Preview and
// local builds stay silent, so a test deployment cannot advertise URLs that do
// not exist on hallnect.com.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

export const INDEXNOW_KEY = "74aec56e445410aa0d6d6bb389f0ba9e";

const HOST = "hallnect.com";
const ORIGIN = `https://${HOST}`;
const ENDPOINT = "https://api.indexnow.org/indexnow";
/** IndexNow accepts up to 10,000 URLs per request. */
const MAX_URLS = 10_000;

export function indexNowEnabled(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * The request body for a set of URLs, or null when none is on our host.
 * Pure, so the filtering is tested: a URL on any other host would make the
 * whole request fail (IndexNow rejects a batch that is not all one host).
 */
export function indexNowPayload(urls: readonly string[]) {
  const urlList = [...new Set(urls)]
    .filter((u) => {
      try { return new URL(u).host === HOST; } catch { return false; }
    })
    .slice(0, MAX_URLS);
  if (urlList.length === 0) return null;
  return {
    host: HOST,
    key: INDEXNOW_KEY,
    keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`,
    urlList,
  };
}

/** Sends the notice. True only on a 200/202 from IndexNow. Never throws. */
export async function submitToIndexNow(urls: readonly string[]): Promise<boolean> {
  if (!indexNowEnabled()) return false;
  const body = indexNowPayload(urls);
  if (!body) return false;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 200 || res.status === 202) return true;
    console.error("[indexnow] rejected:", res.status, await res.text().catch(() => ""));
    return false;
  } catch (e) {
    console.error("[indexnow] failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Every public page a venue change can affect: each live venue page, /halls,
 * and each city page in English and Tamil. A whole set rather than the one
 * hall, because the callers (revalidateVenuePages) know a hall's id, not its
 * slug, and the catalogue is small. A hall that was just suspended is not in
 * the set; its page now 404s and is dropped on the next crawl.
 */
export async function notifyVenueChanges(): Promise<void> {
  if (!indexNowEnabled()) return;
  try {
    const { fetchIndexableVenues } = await import("@/lib/seo/sitemap-data");
    const { citySlug } = await import("@/lib/seo/cities");
    const venues = await fetchIndexableVenues();
    const cities = [...new Set(venues.map((v) => citySlug(v.city)))];
    await submitToIndexNow([
      `${ORIGIN}/halls`,
      ...venues.map((v) => `${ORIGIN}/halls/${v.slug}`),
      ...cities.flatMap((c) => [`${ORIGIN}/wedding-halls/${c}`, `${ORIGIN}/ta/wedding-halls/${c}`]),
    ]);
  } catch (e) {
    console.error("[indexnow] venue notice failed:", e instanceof Error ? e.message : e);
  }
}
