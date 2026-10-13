// ─────────────────────────────────────────────────────────────────────────────
// lib/seo/definition.ts — what Hallnect is, in one paragraph, said ONE way.
//
// SEO phase 5 (AI search, 2026-10-10). Answer engines describe a business from
// what its pages say about it; three slightly different self-descriptions read
// as three different claims. So the home page ("What is Hallnect?"), the About
// page and /llms.txt all print this one paragraph. It names what Hallnect is,
// who it serves, where it operates and who runs it — and says only what is
// true of the product today (online booking only while it is switched on).
// Pure: no server-only imports, safe in any component.
// ─────────────────────────────────────────────────────────────────────────────

export function hallnectDefinition(opts: { directBookingEnabled: boolean; legalName: string }): string {
  return (
    "Hallnect is an online marketplace for wedding halls, kalyana mandapams, reception, party, " +
    "banquet and meeting venues in Tamil Nadu, India. Families compare venues by city, guest " +
    "capacity, price and amenities, then ask a hall for a quote" +
    (opts.directBookingEnabled ? " or, where the hall offers it, book online with an advance" : "") +
    ". Venue owners list their halls for free and answer families from an owner dashboard. " +
    `Hallnect is run by ${opts.legalName}, based in Madurai.`
  );
}

/**
 * What Hallnect does to check a listing, in one sentence for every machine
 * reader (llms.txt and the site assistant).
 *
 * "Sometimes" is the owner's own answer (2026-10-12): the team visits some
 * venues in person, not every one. The old line, "Hallnect does not visit
 * venues", contradicted the Google Business Profile, whose eligibility rests on
 * in-person contact, and AI systems discount a source that contradicts itself.
 * A visit is still not an inspection: the Disclaimer's "we do not inspect" stays
 * true, which is why this says families should confirm details with the venue.
 */
export const LISTING_CHECKS =
  "Every listing is submitted by the venue's owner and checked by Hallnect for completeness before " +
  "it goes live. The Hallnect team visits some venues in person, but not every one, so families " +
  "should confirm details with the venue.";

type AnswerHall = {
  city: string;
  capacity_max: number;
  price_per_day: number | null;
  /** Normalised booking mode (lib/booking-mode toBookingMode). */
  booking_mode: string;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * The opening of /halls, answer first and from the live list: how many venues,
 * in how many cities, from what price, for how many guests, and how to book.
 * null when there is nothing to answer from (the page keeps its plain line).
 */
export function hallsAnswer(halls: readonly AnswerHall[], directBookingEnabled: boolean): string | null {
  if (!halls.length) return null;
  const cities = new Set(halls.map((h) => h.city.trim()).filter(Boolean));
  const priced = halls.map((h) => h.price_per_day).filter((p): p is number => typeof p === "number" && p > 0);
  const largest = Math.max(...halls.map((h) => h.capacity_max));
  const venues = `${halls.length} ${halls.length === 1 ? "venue" : "venues"}`;
  const inCities = `in ${cities.size} ${cities.size === 1 ? "city" : "cities"}`;
  const from = priced.length ? `, from ${inr(Math.min(...priced))} per day` : "";
  const facts = `Hallnect lists ${venues} ${inCities} of Tamil Nadu${from}, for up to ${largest.toLocaleString("en-IN")} guests.`;
  const anyOnline = directBookingEnabled && halls.some((h) => h.booking_mode === "DIRECT_BOOKING");
  const how = anyOnline
    ? "Ask a hall for a quote, or book online where the hall offers it."
    : "Ask a hall for a quote; it gets your number only if you accept.";
  return `${facts} ${how}`;
}
