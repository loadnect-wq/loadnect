// ─────────────────────────────────────────────────────────────────────────────
// lib/seo/tamil.ts — what the Tamil pages need that the English ones do not.
//
// NO IMPORTS FROM THE DATABASE LAYER. Plain data and pure functions, so tests
// and client code can use it.
//
// WHY TAMIL PAGES. The national sites and directories serve their listings in
// English. Searches such as "மதுரை திருமண மண்டபம்" face far fewer competing
// pages than "wedding halls in Madurai", and many families — and most hall
// managers — read Tamil first.
//
// ONE PAGE PER CITY, PAIRED WITH THE ENGLISH ONE. /ta/wedding-halls/<slug>
// mirrors /wedding-halls/<slug> and the two name each other with hreflang. The
// Tamil page passes through EXACTLY the same inventory gate as the English one
// (lib/seo/cities.ts), so a Tamil page is indexable precisely when its English
// twin is. That is the doorway-page rule this codebase already keeps; a second
// language does not loosen it.
//
// TAMIL COPY lives in the page, not here. Have a native copywriter review it
// before promoting the page anywhere.
// ─────────────────────────────────────────────────────────────────────────────

import { SERVICE_AREA_CITIES } from "./service-areas";

/**
 * Tamil names for every service-area city, in the spelling used on road signs
 * and in Tamil newspapers. A city missing from this map gets no Tamil page.
 */
export const TAMIL_CITY_NAMES: Readonly<Record<(typeof SERVICE_AREA_CITIES)[number], string>> = {
  Madurai: "மதுரை",
  Chennai: "சென்னை",
  Coimbatore: "கோயம்புத்தூர்",
  Tiruchirappalli: "திருச்சிராப்பள்ளி",
  Salem: "சேலம்",
  Tirunelveli: "திருநெல்வேலி",
  Thanjavur: "தஞ்சாவூர்",
  Dindigul: "திண்டுக்கல்",
  Erode: "ஈரோடு",
  Tiruppur: "திருப்பூர்",
  Vellore: "வேலூர்",
  Kanchipuram: "காஞ்சிபுரம்",
  Sivakasi: "சிவகாசி",
  Virudhunagar: "விருதுநகர்",
  Karaikudi: "காரைக்குடி",
  Rajapalayam: "ராஜபாளையம்",
  Pollachi: "பொள்ளாச்சி",
  Chengalpattu: "செங்கல்பட்டு",
  Theni: "தேனி",
};

export function tamilCityName(city: string): string | null {
  return (TAMIL_CITY_NAMES as Record<string, string>)[city] ?? null;
}

/** The Tamil twin of /wedding-halls/<slug>. */
export function tamilCityPath(slug: string): string {
  return `/ta/wedding-halls/${slug}`;
}

/** The English page of a city. Kept here so both twins build the pair the same way. */
export function englishCityPath(slug: string): string {
  return `/wedding-halls/${slug}`;
}

/**
 * hreflang for a city pair. Same object on both pages, which is what Google
 * requires: each page lists itself AND its twin, and x-default points at the
 * English page for every other language.
 */
export function cityLanguageAlternates(slug: string): Record<string, string> {
  return {
    "en-IN": englishCityPath(slug),
    "ta-IN": tamilCityPath(slug),
    "x-default": englishCityPath(slug),
  };
}

export const TAMIL_MONTHS = [
  "ஜனவரி", "பிப்ரவரி", "மார்ச்", "ஏப்ரல்", "மே", "ஜூன்",
  "ஜூலை", "ஆகஸ்ட்", "செப்டம்பர்", "அக்டோபர்", "நவம்பர்", "டிசம்பர்",
] as const;

export const TAMIL_WEEKDAYS = ["ஞாயிறு", "திங்கள்", "செவ்வாய்", "புதன்", "வியாழன்", "வெள்ளி", "சனி"] as const;

/**
 * "25 அக்டோபர், ஞாயிறு" for "2026-10-25".
 *
 * Written out rather than left to Intl: the ta-IN short format renders
 * "அக். 25, ஞாயி." — abbreviated, month first — which reads like a machine
 * wrote it. UTC throughout, like every date-only value in this codebase.
 */
export function formatTamilDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${d} ${TAMIL_MONTHS[m - 1]}, ${TAMIL_WEEKDAYS[weekday]}`;
}

/** "₹1,60,000" — Indian digit grouping, no decimals. */
export function formatRupees(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
