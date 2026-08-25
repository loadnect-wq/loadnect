// ─────────────────────────────────────────────────────────────────────────────
// lib/seo/config.ts — the SINGLE source of truth for everything SEO.
//
// CANONICAL HOST. Every canonical URL, Open Graph URL, JSON-LD @id, sitemap
// entry and robots directive resolves from SITE_URL below — there is exactly
// one place to change it.
//
// Why www and not the apex: the apex is not the serving host. Verified live:
//     https://hallnect.com/         -> 301  https://www.hallnect.com/
//     https://www.hallnect.com/     -> 200
//     https://hallnect5.vercel.app/ -> 404  (alias released; no duplicate host)
// A canonical must name the URL that actually returns 200. Pointing canonicals
// at the apex while the apex 301s would make every canonical a redirect, which
// Google resolves back to www anyway — the tag would fight the server and slow
// indexing rather than help it.
//
// TO MAKE THE APEX CANONICAL INSTEAD: switch the primary domain in Vercel so
// hallnect.com serves 200 and www redirects to it, then set the env var
// NEXT_PUBLIC_SITE_URL=https://hallnect.com. No code change is needed — the
// override is read first (lib/app-url.ts). Do NOT set it before flipping
// Vercel, or every canonical will point at a redirect.
// ─────────────────────────────────────────────────────────────────────────────

import { getCanonicalAppUrl } from "@/lib/app-url";

/** Absolute public origin, no trailing slash. */
export const SITE_URL = getCanonicalAppUrl();

export const SITE_NAME = "Hallnect";
export const SITE_LOCALE = "en_IN";
export const SITE_LANG = "en-IN";

/** Hosts that must never appear in a canonical, sitemap or JSON-LD. */
export const FORBIDDEN_CANONICAL_HOSTS = [
  "hallnect5.vercel.app",
  "localhost",
  "127.0.0.1",
  "vercel.app",
];

/**
 * Builds an absolute canonical URL from a root-relative path.
 * Query strings are stripped: a canonical must name ONE URL, and
 * /halls?sort=rating is the same page as /halls for indexing purposes.
 */
export function absoluteUrl(path = "/"): string {
  const clean = path.split("?")[0].split("#")[0];
  const normalised =
    clean === "" || clean === "/"
      ? "/"
      : `/${clean.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  return `${SITE_URL}${normalised === "/" ? "" : normalised}`;
}

/** True when a URL is safe to publish as canonical/sitemap. */
export function isPublishableUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:") return false;
    return !FORBIDDEN_CANONICAL_HOSTS.some(
      (bad) => hostname === bad || hostname.endsWith(`.${bad}`),
    );
  } catch {
    return false;
  }
}

/** Default social share image. */
export const DEFAULT_OG_IMAGE = {
  url: `${SITE_URL}/og-default.png`,
  width: 1200,
  height: 630,
  alt: "Hallnect — wedding halls and event venues across Tamil Nadu",
};

/** Business facts. One place, so JSON-LD and visible copy cannot drift. */
export const BUSINESS = {
  legalName: "HALLNECT LLP",
  email: "hallnect@gmail.com",
  phone: "+91 9344040013",
  street: "No. 68, Venkateshwara Nagar, Sundar Nagar Extension, Tirunagar",
  locality: "Madurai",
  region: "Tamil Nadu",
  postalCode: "625006",
  country: "IN",
} as const;
