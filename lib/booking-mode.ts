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
 * DIRECT BOOKING IS SWITCHED OFF (2026-10-05). Every venue takes enquiries,
 * answered with a quote (migration 0112). The online-booking code stays —
 * premium plans and commission settlement still use the payment path — but no
 * hall can be in DIRECT_BOOKING mode: the database refuses it
 * (halls_direct_booking_switched_off), and while this is false every mode
 * read here and every mode written through the forms is LEAD_GENERATION.
 * Switching back means the flag (lib/booking-switch.ts) AND dropping the 0112
 * constraints.
 */
export { DIRECT_BOOKING_ENABLED };

/**
 * Normalises whatever came back from the database.
 *
 * While direct booking was on, null and anything unrecognised meant
 * DIRECT_BOOKING — the mode with the stricter rules. With it switched off
 * there is one mode, and every hall is read as taking enquiries.
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
