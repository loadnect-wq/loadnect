// ─────────────────────────────────────────────────────────────────────────────
// lib/seo/venue.ts — venue titles, descriptions and image alt text.
//
// Every string here is derived from the venue's OWN data (name, city, capacity,
// price, amenities), so two halls never receive the same metadata even when
// their names are similar — the duplicate-metadata failure the brief calls out.
// Nothing is padded with keywords: the description says what the venue is.
// ─────────────────────────────────────────────────────────────────────────────

import type { HallDetail } from "@/lib/halls";
import { clamp } from "./metadata";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * "Grand Lotus Mahal | Wedding Hall in Madurai | Hallnect"
 * The site name is appended by the title template in app/layout.tsx, so it is
 * deliberately not repeated here.
 */
export function venueTitle(hall: Pick<HallDetail, "name" | "city">): string {
  return `${hall.name} | Wedding Hall in ${hall.city}`;
}

/**
 * A description built from THIS venue's facts. Falls back through progressively
 * less specific material so a sparse listing still gets a useful, unique
 * sentence rather than a template with one word swapped.
 */
export function venueDescription(hall: HallDetail): string {
  const bits: string[] = [];

  const where = hall.address?.trim()
    ? `${hall.name} in ${hall.city}`
    : `${hall.name}, ${hall.city}`;
  bits.push(
    `${where} seats up to ${hall.capacity_max.toLocaleString("en-IN")} guests` +
      ` from ${inr(hall.price_per_day)} per day.`,
  );

  // The owner's own description is the most distinguishing text available.
  const own = hall.description?.replace(/\s+/g, " ").trim();
  if (own && own.length > 30) {
    bits.push(own);
  } else {
    const amenities = hall.amenities.slice(0, 4).map((a) => a.name.toLowerCase());
    if (amenities.length) {
      bits.push(`Facilities include ${amenities.join(", ")}.`);
    }
    bits.push("Check live availability and book your date online.");
  }

  return clamp(bits.join(" "), 158);
}

/**
 * Descriptive alt text for a venue photo.
 *
 * Why this exists: every image on a venue page previously rendered
 * alt={img.alt_text ?? hallName}, and alt_text is null for every row in
 * practice — so a gallery of eight photos repeated one identical alt string.
 * That is useless to a screen reader and to image search alike. This generates
 * a distinct, honest description per image WITHOUT keyword-stuffing: it says
 * what the picture is of, and stops.
 */
export function venueImageAlt(
  hall: Pick<HallDetail, "name" | "city">,
  index: number,
  stored?: string | null,
): string {
  const own = stored?.trim();
  if (own) return own;

  // Index 0 is the cover shot; the rest are gallery views.
  if (index === 0) return `${hall.name}, a wedding hall in ${hall.city}`;
  return `${hall.name} in ${hall.city} — photo ${index + 1}`;
}
