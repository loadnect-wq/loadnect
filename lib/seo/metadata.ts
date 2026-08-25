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

/** Trims to a length without cutting a word in half. */
export function clamp(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
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
  const title = clamp(input.title, 65);
  const description = clamp(input.description, 158);
  const indexable = input.indexable !== false;

  return {
    title,
    description,
    alternates: { canonical },
    robots: indexable
      ? { index: true, follow: true,
          googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } }
      : { index: false, follow: true },
    openGraph: {
      type: input.type ?? "website",
      siteName: SITE_NAME,
      locale: SITE_LOCALE,
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
