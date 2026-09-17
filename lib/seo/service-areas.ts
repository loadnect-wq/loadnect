// ─────────────────────────────────────────────────────────────────────────────
// lib/seo/service-areas.ts — the cities Hallnect serves. ONE list, and nothing
// else in this file.
//
// WHY ITS OWN MODULE. This constant is needed by both a Server Component
// (lib/seo/cities.ts, which queries the database) and a Client Component (the
// owner's hall form, which renders the dropdown). Keeping it in cities.ts meant
// the client bundle pulled in a module that imports the server-only Supabase
// client, which fails the build outright. A bare constant with no imports can be
// read from either side.
//
// WHY IT MUST NOT BE DUPLICATED. Every city an owner can pick has to have a
// landing page: /sitemap.xml advertises a URL for any city that has inventory,
// and the homepage links to them. There were three divergent copies of this
// list — here, the hall form, and lib/mock-data — and the other two offered ten
// cities with no page behind them. The first approved venue in one of those
// would have put a 404 in the sitemap, which Search Console counts against the
// whole file, and linked the homepage straight into it.
// ─────────────────────────────────────────────────────────────────────────────

export const SERVICE_AREA_CITIES = [
  "Madurai",
  "Chennai",
  "Coimbatore",
  "Tiruchirappalli",
  "Salem",
  "Tirunelveli",
  "Thanjavur",
  "Dindigul",
  "Erode",
  "Tiruppur",
  "Vellore",
  "Kanchipuram",
  "Sivakasi",
  "Virudhunagar",
  "Karaikudi",
  "Rajapalayam",
  "Pollachi",
  "Chengalpattu",
  "Theni",
] as const;
