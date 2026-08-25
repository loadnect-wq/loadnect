// ─────────────────────────────────────────────────────────────────────────────
// lib/seo/config.ts — the SINGLE source of truth for everything SEO.
//
// CANONICAL HOST. Every canonical URL, Open Graph URL, JSON-LD @id, sitemap
// entry and robots directive resolves from SITE_URL below — there is exactly
// one place to change it.
//
// The canonical host is the APEX, hallnect.com. Verified live after the
// 2026-08-25 Vercel cut-over:
//     https://hallnect.com/         -> 200  (Production)
//     https://www.hallnect.com/     -> 301  https://hallnect.com/  (path-preserving)
//     https://hallnect5.vercel.app/ -> 404  (alias released; no duplicate host)
//
// A canonical must always name the URL that actually returns 200 — a canonical
// pointing at a redirect fights the server and slows indexing. If the primary
// domain is ever switched back to www, change PRODUCTION_ORIGIN in
// lib/app-url.ts (or set NEXT_PUBLIC_SITE_URL, which is read first) IN THE SAME
// CHANGE as the Vercel flip, never before it.
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
