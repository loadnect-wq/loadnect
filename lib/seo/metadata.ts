// ─────────────────────────────────────────────────────────────────────────────
// lib/seo/metadata.ts — builders for Next.js Metadata objects.
//
// Every indexable page goes through buildMetadata() so that a canonical, an
// Open Graph block and a Twitter card can never be forgotten. Private pages go
// through noindexMetadata(), which is the ONLY way this app marks something
// non-indexable — so "is this page indexable?" has exactly one answer per route.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import {
  SITE_NAME, SITE_LOCALE, absoluteUrl, DEFAULT_OG_IMAGE,
} from "./config";

/**
 * Trims to a length without cutting a word in half.
 *
 * The ellipsis stands in for what was dropped, so any punctuation left sitting
 * at the cut point goes with it. Without that strip, a description clipped just
 * after a sentence rendered as "…and a swimming pool.…" — the SERP snippet is
 * the one line of Hallnect a stranger reads, and it was reading as a typo.
 */
export function clamp(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  // Falls back to the raw slice when the tail was punctuation all the way
  // down, so this can never hand Google a bare "…".
  const tidy = kept.replace(/[\s.,;:!?…·|/\\\-–—([{"'“”‘’]+$/u, "");
  return `${tidy || kept.trimEnd()}…`;
}

/**
 * THE SEARCH-RESULT BUDGETS (SEO phase 3, 2026-10-08).
 *
 * A title is measured AS IT RENDERS — including the " | Hallnect" the layout
 * template appends — and kept to 60 characters, where Google stops showing it.
 * A description is kept to 155. These were 65 (before the suffix, so up to 76
 * rendered) and 158.
 */
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 155;
const BRAND_SUFFIX = ` | ${SITE_NAME}`;

/**
 * The <title> for Next's metadata, fitted to TITLE_MAX.
 *
 * WHAT GIVES WAY FIRST IS THE BRAND, NOT THE PAGE'S OWN WORDS. If the title
 * plus " | Hallnect" fits, the layout template appends it as usual. If not, the
 * title is emitted absolute — no suffix — so "Sri Lakshmi Kalyana Mandapam |
 * Wedding Hall in Tiruchirappalli" keeps its city instead of losing it to the
 * brand. Only a title too long on its own is clamped. A title that already
 * ends in the brand (the homepage, whose segment the template does not reach)
 * is passed through as written.
 */
export function fitTitle(title: string): string | { absolute: string } {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.endsWith(BRAND_SUFFIX)) return { absolute: clamp(clean, TITLE_MAX) };
  if ((clean + BRAND_SUFFIX).length <= TITLE_MAX) return clean;
  return { absolute: clamp(clean, TITLE_MAX) };
}

/**
 * A description from whole sentences, in order, kept within DESCRIPTION_MAX:
 * a sentence that does not fit is DROPPED, not cut, so the snippet never ends
 * mid-thought ("…the hall gets your…"). The first sentence — the facts — is
 * always kept (clamped only if it is too long on its own).
 */
export function fitSentences(sentences: readonly string[], max = DESCRIPTION_MAX): string {
  const [first, ...rest] = sentences.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!first) return "";
  let out = clamp(first, max);
  for (const s of rest) {
    if (out.length + 1 + s.length > max) break;
    out = `${out} ${s}`;
  }
  return out;
}

/** The title exactly as a browser tab and a search result show it. */
export function renderedTitle(title: string): string {
  const fitted = fitTitle(title);
  return typeof fitted === "string" ? fitted + BRAND_SUFFIX : fitted.absolute;
}

export type SeoImage = { url: string; alt: string; width?: number; height?: number };

export type BuildMetadataInput = {
  /** Page title WITHOUT the site-name suffix — the template appends it. */
  title: string;
  description: string;
  /** Root-relative path, e.g. "/halls/royal-mahal-madurai". */
  path: string;
  images?: SeoImage[];
  /** "website" for landing pages, "article" for guides. */
  type?: "website" | "article";
  /** Set false for pages that exist publicly but should not be indexed. */
  indexable?: boolean;
  /**
   * hreflang → root-relative path, e.g. { "en-IN": "/wedding-halls/madurai",
   * "ta-IN": "/ta/wedding-halls/madurai", "x-default": ... }. Both twins pass
   * the SAME map. Emitted only on an indexable page, for the same reason the
   * canonical is: a noindex page nominates nothing.
   */
  languages?: Record<string, string>;
  /** og:locale. Defaults to SITE_LOCALE (en_IN); a Tamil page passes "ta_IN". */
  locale?: string;
};

/**
 * The one builder for indexable pages: canonical + OG + Twitter, always.
 * Titles are length-guarded so Google does not truncate mid-word in SERPs.
 */
export function buildMetadata(input: BuildMetadataInput): Metadata {
  const canonical = absoluteUrl(input.path);
  const images = (input.images?.length ? input.images : [DEFAULT_OG_IMAGE]).map((i) => ({
    url: i.url,
    alt: i.alt,
    ...(i.width ? { width: i.width } : {}),
    ...(i.height ? { height: i.height } : {}),
  }));
  // The page's own title for social cards (they carry the site name
  // separately, as og:site_name), and the fitted one for the <title>.
  const title = clamp(input.title, TITLE_MAX);
  const description = clamp(input.description, DESCRIPTION_MAX);
  const indexable = input.indexable !== false;

  return {
    title: fitTitle(input.title),
    description,
    // A NOINDEX PAGE NOMINATES NOTHING — the same rule noindexMetadata already
    // states and follows. This was set unconditionally, so /halls?city=Madurai
    // shipped `noindex, follow` AND `rel=canonical → /halls` together: one tag
    // says "index that instead", the other "index nothing". app/halls/(browse)/page.tsx
    // lines 71-76 explain at length why that pair is not wanted and assert it
    // does not happen — the comment was right about the intent and wrong about
    // the code. Google treats the combination as conflicting signals, and the
    // documented worry is the noindex carrying across to /halls itself.
    //
    // The OG url keeps the absolute URL either way: it is how the page
    // identifies itself when shared, not an indexing instruction.
    ...(indexable
      ? {
          alternates: {
            canonical,
            ...(input.languages
              ? {
                  languages: Object.fromEntries(
                    Object.entries(input.languages).map(([lang, path]) => [lang, absoluteUrl(path)]),
                  ),
                }
              : {}),
          },
        }
      : {}),
    robots: indexable
      ? { index: true, follow: true,
          googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } }
      : { index: false, follow: true },
    openGraph: {
      type: input.type ?? "website",
      siteName: SITE_NAME,
      locale: input.locale ?? SITE_LOCALE,
      url: canonical,
      title,
      description,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: images.map((i) => i.url),
    },
  };
}

/**
 * For dashboards, checkout, auth and every other private surface.
 * `follow` stays on so internal links are still discovered, but the page
 * itself never enters the index. Canonical is deliberately omitted: a
 * noindex page should not nominate itself as anything.
 */
export function noindexMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false, nocache: true,
              googleBot: { index: false, follow: false } },
  };
}

/**
 * For real public pages whose QUERY-STRING variants must not be indexed
 * (filtered listings). The page keeps a canonical pointing at its clean self,
 * so filter permutations consolidate instead of spawning crawl traps.
 */
export function filteredListingMetadata(input: BuildMetadataInput & { filtered: boolean }): Metadata {
  const base = buildMetadata({ ...input, indexable: !input.filtered });
  return base;
}
