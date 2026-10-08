// ─────────────────────────────────────────────────────────────────────────────
// lib/seo/city-aliases.ts — the names people actually type, mapped to the
// city page that exists.
//
// City pages live at the official name's slug (/wedding-halls/tiruchirappalli),
// but families search "wedding halls in Trichy", and /wedding-halls/trichy was
// a 404. Each alias here is a permanent (301) redirect to the canonical page,
// set up in next.config.ts — one URL per city, with the common name still
// arriving at it.
//
// PURE AND IMPORT-FREE on purpose: next.config.ts imports it, and that file is
// compiled before the "@/" path alias exists. Every target must be the slug of
// a city in SERVICE_AREA_CITIES (lib/seo/service-areas.ts) — a test checks it,
// so an alias can never redirect into a 404.
// ─────────────────────────────────────────────────────────────────────────────

export const CITY_ALIASES: Readonly<Record<string, string>> = {
  trichy:       "tiruchirappalli",
  tiruchy:      "tiruchirappalli",
  tiruchi:      "tiruchirappalli",
  kovai:        "coimbatore",
  tanjore:      "thanjavur",
  nellai:       "tirunelveli",
  tirupur:      "tiruppur",
  kancheepuram: "kanchipuram",
};

type Redirect = { source: string; destination: string; statusCode: 301 };

/** The redirects for every alias, on every page family that is keyed by city. */
export function cityAliasRedirects(): Redirect[] {
  return Object.entries(CITY_ALIASES).flatMap(([alias, city]) => [
    { source: `/wedding-halls/${alias}`, destination: `/wedding-halls/${city}`, statusCode: 301 as const },
    { source: `/ta/wedding-halls/${alias}`, destination: `/ta/wedding-halls/${city}`, statusCode: 301 as const },
    // Straight to the wedding hub: /venues/wedding/<city> itself redirects
    // there, and one hop is better than two.
    { source: `/venues/wedding/${alias}`, destination: `/wedding-halls/${city}`, statusCode: 301 as const },
    { source: `/venues/:category/${alias}`, destination: `/venues/:category/${city}`, statusCode: 301 as const },
  ]);
}
