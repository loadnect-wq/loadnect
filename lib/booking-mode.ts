// ─────────────────────────────────────────────────────────────────────────────
// lib/booking-mode.ts — how a venue's mode and price are PRESENTED.
//
// PURE. No "server-only", no database, no env — so the same helpers render the
// public catalogue (server components), the owner's form (a client component)
// and the admin list, and all three say the same thing about the same venue.
//
// WHY A MODULE FOR WHAT LOOKS LIKE A STRING. `price_per_day` became nullable in
// migration 0073, and a null has to become words on eighteen surfaces. Left to
// each call site, a few of them would have written `₹${price}` and shipped
// "₹null", and one or two would have chosen a different phrase for the same
// state — so a venue would read "Contact for pricing" on its card and "Price on
// request" on its page. One function, one phrase.
// ─────────────────────────────────────────────────────────────────────────────

import { formatPrice } from "@/lib/mock-data";
import { DIRECT_BOOKING_ENABLED } from "@/lib/booking-switch";
import type { BookingMode } from "@/lib/validation/schemas";

export type { BookingMode };

/** The one phrase for a venue that publishes no price. */
export const PRICE_ON_REQUEST = "Contact for pricing";

/** Short label for a badge or chip. */
export const BOOKING_MODE_LABEL: Record<BookingMode, string> = {
  DIRECT_BOOKING: "Direct Booking",
  LEAD_GENERATION: "Lead Generation",
};

/**
 * ONLINE BOOKING IS BACK (2026-10-07, migration 0114) as each hall's choice:
 * DIRECT_BOOKING takes an advance online, LEAD_GENERATION works on quotes
 * (0112). Between 2026-10-05 and then it was switched off — the database
 * refused DIRECT_BOOKING (halls_direct_booking_switched_off) and every mode
 * read here was LEAD_GENERATION. While DIRECT_BOOKING_ENABLED is false that is
 * still what happens; switching it off again means restoring those 0112
 * constraints too.
 */
export { DIRECT_BOOKING_ENABLED };

/**
 * Normalises whatever came back from the database.
 *
 * With online booking on, null and anything unrecognised read as
 * DIRECT_BOOKING — the mode with the stricter rules, and a hall misread that
 * way shows a Book button that the server (createBookingRequest) and the
 * database (0114's guard) both refuse. The column is NOT NULL, so this is a
 * fallback, not a path. With it switched off there is one mode.
 */
export function toBookingMode(raw: unknown): BookingMode {
  if (!DIRECT_BOOKING_ENABLED) return "LEAD_GENERATION";
  return raw === "LEAD_GENERATION" ? "LEAD_GENERATION" : "DIRECT_BOOKING";
}

export function isLeadGeneration(raw: unknown): boolean {
  return toBookingMode(raw) === "LEAD_GENERATION";
}

/**
 * A venue's headline price, or the enquire phrase when it has none.
 *
 * NOT `price ?? PRICE_ON_REQUEST` at each call site: this also refuses a zero
 * and a NaN, which are the shapes a failed Number() conversion takes. "Free"
 * and "₹NaN" are both worse than "Contact for pricing".
 */
export function formatHallPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price) || price <= 0) return PRICE_ON_REQUEST;
  return formatPrice(price);
}

/** True when this venue has a real, displayable price. */
export function hasPrice(price: number | null | undefined): price is number {
  return price != null && Number.isFinite(price) && price > 0;
}

/**
 * Where the primary call-to-action on a venue page should go.
 *
 * Centralised because getting it wrong is not a cosmetic bug: sending a
 * lead-generation customer to /book/[slug] lands them on a checkout for a
 * venue whose price may be null, and sending a direct-booking customer to
 * /enquiry/[slug] is refused by the server (createLeadEnquiry checks the mode)
 * after they have filled in a form.
 */
export function primaryCtaHref(mode: unknown, slug: string): string {
  return isLeadGeneration(mode) ? `/enquiry/${slug}` : `/book/${slug}`;
}

/** The label on that call to action. */
export function primaryCtaLabel(mode: unknown): string {
  return isLeadGeneration(mode) ? "Get a quote" : "Book Now";
}
