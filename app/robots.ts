// ─────────────────────────────────────────────────────────────────────────────
// app/robots.ts — production robots.txt, generated from the real route map.
//
// The disallow list below was derived by enumerating every route under app/ and
// classifying it, not copied from a template. Anything that is a dashboard, a
// checkout, an auth surface or a personal account page is blocked; every public
// discovery surface is left open.
//
// NOTE ON /api: blocking it is safe for SEO because no public content is served
// from an API route — BUT /.well-known/assetlinks.json must stay reachable
// (Android App Links verification fetches it), and it is not under /api, so the
// rules below do not touch it.
// ─────────────────────────────────────────────────────────────────────────────

import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo/config";

export default function robots(): MetadataRoute.Robots {
  // WHAT IS DELIBERATELY *NOT* BLOCKED, and why it matters more than what is.
  //
  // /login, /signup and /book/ used to be disallowed. All three carry a real
  // `noindex, nofollow` (app/(auth)/layout.tsx and noindexMetadata on the
  // booking wizard) and all three are linked from pages Google crawls — the
  // auth links sit in the header of every indexable page, and "Book Now" sits
  // on every venue page.
  //
  // A Disallow stops Googlebot FETCHING a URL, which means it never reads the
  // noindex on it; a URL that is linked but uncrawlable can still be indexed
  // from the anchor text alone, and then cannot be removed because the
  // instruction to remove it is behind the block. Disallow is how you PRESERVE
  // an unwanted listing. noindex is the only thing that removes one, and it
  // has to be readable to work.
  //
  // So: block what is private AND unlinked (crawl budget), and let noindex
  // handle what is private but linked.
  const disallow = [
    "/admin",          // admin console
    "/owner",          // owner dashboard (incl. hall management)
    "/customer",       // customer account area
    "/booking/",       // payment return / status: noindex AND never linked
    "/auth/",          // OAuth callback + role handoff routes
    "/verify-phone",
    "/approval-pending",
    "/profile",
    "/saved",
    "/bookings",
    "/api/",           // no public content is served from an API route
  ];

  return {
    rules: [
      {
        userAgent: "*",
        // Longest-match wins in robots.txt, so these Allow rules override the
        // broader Disallow entries below. /owner/register is a PUBLIC landing
        // page for venue owners — it must stay crawlable even though the rest
        // of /owner is the private dashboard.
        allow: ["/", "/owner/register"],
        disallow,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
