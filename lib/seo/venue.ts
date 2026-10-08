// ─────────────────────────────────────────────────────────────────────────────
// lib/seo/venue.ts — venue titles, descriptions and image alt text.
//
// Every string here is derived from the venue's OWN data (name, city, capacity,
// price, amenities), so two halls never receive the same metadata even when
// their names are similar — the duplicate-metadata failure the brief calls out.
// Nothing is padded with keywords: the description says what the venue is.
// ─────────────────────────────────────────────────────────────────────────────

import type { HallDetail } from "@/lib/halls";
import { clamp, DESCRIPTION_MAX, TITLE_MAX, fitSentences } from "./metadata";
import { hasPrice, isLeadGeneration } from "@/lib/booking-mode";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// The occasions (venue_categories slugs, 0102) that decide what KIND of hall a
// venue is called in its title. First match wins, in this order: a hall that
// hosts weddings is a wedding hall even if it also hosts birthdays.
const VENUE_KIND: ReadonlyArray<readonly [readonly string[], string]> = [
  [["wedding"], "Wedding Hall"],
  [["reception", "engagement"], "Reception Hall"],
  [["banquet"], "Banquet Hall"],
  [["party", "birthday-party", "anniversary", "baby-shower", "naming-ceremony", "family-function", "private-event"], "Party Hall"],
  [["conference", "meeting", "seminar", "workshop", "training", "corporate-event", "networking-event", "product-launch", "interview"], "Conference Hall"],
];

/**
 * What the venue is, from the occasions its owner declared — "Wedding Hall",
 * "Conference Hall"… — and "Event Venue" when none says. Every venue used to be
 * titled "Wedding Hall", including one that only hosts meetings.
 */
export function venueKind(venueTypes: readonly string[] | null | undefined): string {
  const declared = new Set(venueTypes ?? []);
  for (const [slugs, label] of VENUE_KIND) {
    if (slugs.some((s) => declared.has(s))) return label;
  }
  return "Event Venue";
}

/**
 * "Grand Lotus Mahal | Wedding Hall in Madurai" — the layout template adds
 * " | Hallnect" when the whole thing fits in TITLE_MAX (lib/seo/metadata.ts
 * fitTitle drops the brand first). For a name too long for that, the kind is
 * dropped next ("Name, City"), and the name is never cut while it fits alone.
 */
export function venueTitle(hall: Pick<HallDetail, "name" | "city" | "venue_types">): string {
  const full = `${hall.name} | ${venueKind(hall.venue_types)} in ${hall.city}`;
  if (full.length <= TITLE_MAX) return full;
  const short = `${hall.name}, ${hall.city}`;
  return short.length <= TITLE_MAX ? short : hall.name;
}

/**
 * A description built from THIS venue's facts. Falls back through progressively
 * less specific material so a sparse listing still gets a useful, unique
 * sentence rather than a template with one word swapped.
 */
/** How to book this venue, in one sentence a search snippet can carry. */
function bookingSentence(hall: Pick<HallDetail, "booking_mode">): string {
  return isLeadGeneration(hall.booking_mode)
    ? "Ask for a quote; the hall gets your number only if you accept."
    : "Check live availability and book your date online.";
}

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
    bits.push(bookingSentence(hall));
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
  if (!rest) return clamp(facts, DESCRIPTION_MAX);

  const room = DESCRIPTION_MAX - facts.length - 1; // -1 for the joining space
  if (room < 40) return clamp(facts, DESCRIPTION_MAX);

  let out = "";
  for (const sentence of rest.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [rest]) {
    const candidate = (out + sentence).trimEnd();
    if (candidate.length > room) break;
    out = candidate + " ";
  }
  out = out.trim();
  if (out) return `${facts} ${out}`;

  // NONE OF THE OWNER'S SENTENCES FIT WHOLE (phase 3). The live hall's first
  // sentence is ~95 characters, so its snippet was the facts alone — 76
  // characters saying nothing of how to book. The booking sentence is the
  // next most useful true thing to say, and it is short.
  return fitSentences([facts, bookingSentence(hall)]);
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

// ─────────────────────────────────────────────────────────────────────────────
// ANSWER FIRST (SEO phase 3, 2026-10-08). The venue page now opens with two
// sentences that answer "what is this place, how big, how much, how do I book"
// before anything else, and carries the same facts as a list ("At a glance")
// that a person can scan and a crawler can lift cleanly. Both are built ONLY
// from stored fields — nothing is said about a venue that its listing does not
// say — and computed on the server (the venue view is a client component).
// ─────────────────────────────────────────────────────────────────────────────

type VenueFactsHall = Pick<
  HallDetail,
  | "name" | "city" | "state" | "address" | "capacity_min" | "capacity_max"
  | "price_per_day" | "price_morning" | "price_evening" | "booking_mode"
  | "amenities" | "custom_amenities" | "venue_types" | "updated_at"
>;

type VenueFactsContext = {
  /** The venue's occasions, resolved against the catalogue (display names). */
  categoryNames: readonly string[];
  /** Live advance %, for a venue that takes online bookings. */
  advancePercent: number;
  /** lib/booking-switch.ts — online booking exists at all. */
  directBookingEnabled: boolean;
};

function capacityPhrase(hall: Pick<HallDetail, "capacity_min" | "capacity_max">): string {
  const max = hall.capacity_max.toLocaleString("en-IN");
  return hall.capacity_min && hall.capacity_min > 0 && hall.capacity_min < hall.capacity_max
    ? `${hall.capacity_min.toLocaleString("en-IN")} to ${max} guests`
    : `up to ${max} guests`;
}

const takesOnlineBooking = (hall: Pick<HallDetail, "booking_mode">, on: boolean) =>
  on && !isLeadGeneration(hall.booking_mode);

/** "17 September 2026", in India time, or null. */
export function listingUpdatedLabel(updatedAt: string | null | undefined): string | null {
  if (!updatedAt) return null;
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
}

/**
 * Two sentences, from stored fields only. "NS Mahal is a wedding and reception
 * venue in Madurai, Tamil Nadu, for 150 to 450 guests, listed at ₹1,60,000 per
 * day. It works on quotes: …"
 */
export function venueSummary(hall: VenueFactsHall, ctx: VenueFactsContext): string {
  const declared = ctx.categoryNames.slice(0, 2).map((n) => n.toLowerCase());
  const kind = declared.length ? `${declared.join(" and ")} venue` : venueKind(hall.venue_types).toLowerCase();
  const article = /^[aeiou]/i.test(kind) ? "an" : "a";
  const where = hall.state ? `${hall.city}, ${hall.state}` : hall.city;
  const price = hasPrice(hall.price_per_day) ? `, listed at ${inr(hall.price_per_day)} per day` : "";
  const first = `${hall.name} is ${article} ${kind} in ${where}, for ${capacityPhrase(hall)}${price}.`;

  const second = takesOnlineBooking(hall, ctx.directBookingEnabled)
    ? `It takes online bookings: you pay a ${ctx.advancePercent}% advance on Hallnect to hold your date, and the rest to the hall.`
    : hasPrice(hall.price_per_day)
      ? "It works on quotes: ask for its price for your date, and it gets your phone number only if you accept."
      : "It works on quotes and publishes no price: ask for one for your date, and it gets your phone number only if you accept.";

  return `${first} ${second}`;
}

export type VenueFact = { label: string; value: string; dateTime?: string };

/** The "At a glance" list. A fact the listing does not have is left out, never guessed. */
export function venueFacts(hall: VenueFactsHall, ctx: VenueFactsContext): VenueFact[] {
  const facts: VenueFact[] = [];

  const where = hall.address?.trim() || (hall.state ? `${hall.city}, ${hall.state}` : hall.city);
  facts.push({ label: "Location", value: where });
  facts.push({ label: "Capacity", value: capacityPhrase(hall).replace(/^up to/, "Up to") });

  if (hasPrice(hall.price_per_day)) {
    const slots = [
      hasPrice(hall.price_morning) ? `morning ${inr(hall.price_morning)}` : null,
      hasPrice(hall.price_evening) ? `evening ${inr(hall.price_evening)}` : null,
    ].filter(Boolean);
    facts.push({
      label: "Price",
      value: `${inr(hall.price_per_day)} per day${slots.length ? ` (${slots.join(", ")})` : ""}`,
    });
  } else {
    facts.push({ label: "Price", value: "Not published — ask the venue for a quote" });
  }

  facts.push({
    label: "How to book",
    value: takesOnlineBooking(hall, ctx.directBookingEnabled)
      ? `Online, with a ${ctx.advancePercent}% advance; the venue accepts or declines within 48 hours`
      : "Ask for a quote; the hall gets your number only if you accept",
  });

  if (ctx.categoryNames.length) {
    facts.push({ label: "Suitable for", value: ctx.categoryNames.join(", ") });
  }

  const amenities = [...hall.amenities.map((a) => a.name), ...hall.custom_amenities];
  if (amenities.length) {
    const shown = amenities.slice(0, 6);
    const more = amenities.length - shown.length;
    facts.push({ label: "Amenities", value: shown.join(", ") + (more > 0 ? ` and ${more} more` : "") });
  }

  const updated = listingUpdatedLabel(hall.updated_at);
  if (updated && hall.updated_at) {
    facts.push({ label: "Listing updated", value: updated, dateTime: hall.updated_at });
  }
  return facts;
}
