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
import { hasPrice, isLeadGeneration } from "@/lib/booking-mode";

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
  // The price clause is DROPPED, not zeroed, for a venue that publishes none.
  // inr(null) would read "from Rs.0 per day" in the meta description Google
  // shows under the result — an advertised price of zero on a wedding hall.
  bits.push(
    hasPrice(hall.price_per_day)
      ? `${where} seats up to ${hall.capacity_max.toLocaleString("en-IN")} guests` +
          ` from ${inr(hall.price_per_day)} per day.`
      : `${where} seats up to ${hall.capacity_max.toLocaleString("en-IN")} guests.` +
          ` Contact the venue for pricing.`,
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
    // "book your date online" IS NOT TRUE OF A LEAD VENUE. Hallnect takes no
    // payment for one and holds no date — the customer sends an enquiry and the
    // venue arranges it directly. This sentence is the meta description Google
    // prints under the result, so promising a checkout that does not exist
    // brings someone to the page expecting to book and hands them a form.
    bits.push(
      isLeadGeneration(hall.booking_mode)
        ? "Send an enquiry and the venue will confirm your date."
        : "Check live availability and book your date online.",
    );
  }

  // BUDGET, DO NOT CLAMP. The owner's description is appended whole and then
  // cut to fit, which is how the only venue on the site shipped a snippet
  // ending "…is a premium wedding and event venue located in…" — the sentence
  // stops on a preposition, in the one line Google prints under the result.
  //
  // The facts sentence is never sacrificed: it is built from structured data
  // and is the part that answers the searcher. Whatever room is left goes to
  // whole sentences of the owner's prose, and a sentence that does not fit is
  // dropped rather than halved. If none fits, the facts stand alone — a short
  // true description beats a long truncated one.
  const facts = bits[0];
  const rest = bits.slice(1).join(" ");
  if (!rest) return clamp(facts, 158);

  const room = 158 - facts.length - 1; // -1 for the joining space
  if (room < 40) return clamp(facts, 158);

  let out = "";
  for (const sentence of rest.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [rest]) {
    const candidate = (out + sentence).trimEnd();
    if (candidate.length > room) break;
    out = candidate + " ";
  }
  out = out.trim();
  return out ? `${facts} ${out}` : facts;
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
