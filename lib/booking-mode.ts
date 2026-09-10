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
 * Normalises whatever came back from the database.
 *
 * Defaults to DIRECT_BOOKING for null, undefined and anything unrecognised.
 * That is the safe direction in both senses: it is what every hall listed
 * before this feature is, and it is the mode with the STRICTER rules — a hall
 * mistakenly treated as direct-booking shows a price and a Book button, which
 * is visibly wrong; the reverse silently hides a working checkout.
 */
export function toBookingMode(raw: unknown): BookingMode {
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
  return isLeadGeneration(mode) ? "Send Enquiry" : "Book Now";
}
