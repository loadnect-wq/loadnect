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
  const disallow = [
    "/admin",          // admin console
    "/owner",          // owner dashboard (incl. hall management)
    "/customer",       // customer account area
    "/book/",          // checkout: booking wizard
    "/booking/",       // payment return / status pages
    "/login",
    "/signup",
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
        allow: "/",
        disallow,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
