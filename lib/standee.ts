// ─────────────────────────────────────────────────────────────────────────────
// lib/standee.ts — the printed QR standee at a hall's reception. PURE.
//
// WHY. Most families who book a mahal walk into it first. A standee on the
// reception desk turns each of those visits into a Hallnect visit: the family
// scans, sees the price, photos and (for a direct-booking hall) the free dates,
// and can enquire or pay the advance from their own phone — after they leave,
// when the decision is actually made at home.
//
// THE CODE POINTS AT /q/<slug>, NOT AT THE VENUE PAGE. The short route counts
// the scan (hall_qr_scans, 0107) and redirects, so the owner can see the
// standee working. A printed code cannot be changed later; a route can — if a
// venue page ever moves, /q keeps every standee already on a desk working.
//
// THE WORDING FOLLOWS THE BOOKING MODE. A lead-generation venue has no online
// checkout and makes no availability claim (see HallDetailView), so its
// standee must not say "check free dates and pay online". Printed copy that
// promises what the page does not do cannot be corrected after it is laminated.
// ─────────────────────────────────────────────────────────────────────────────

import type { BookingMode } from "@/lib/validation/schemas";
import { isLeadGeneration } from "@/lib/booking-mode";

/** The path every standee's QR code encodes. */
export function standeePath(slug: string): string {
  return `/q/${slug}`;
}

/** Slugs are lowercase words joined by hyphens; anything else is not a hall. */
export const STANDEE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Link-preview fetchers and crawlers are not people standing at a desk.
 * Counting them would tell an owner the standee works when nobody scanned it.
 * A phone camera hands the URL to a normal browser, which never matches.
 */
export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python|headless|lighthouse/i.test(
    userAgent,
  );
}

export type StandeeCopy = {
  /** Tamil headline — the line a family reads first. */
  ta: string;
  en: string;
};

/** What the standee promises, by what the venue page actually offers. */
export function standeeCopy(mode: BookingMode): StandeeCopy {
  return isLeadGeneration(mode)
    ? {
        ta: "விலை, புகைப்படங்கள், வசதிகளைப் பார்த்து இலவசமாக விசாரியுங்கள்",
        en: "See prices, photos and facilities. Enquire for free.",
      }
    : {
        ta: "காலியான தேதிகளைப் பார்த்து, முன்பணத்தை ஆன்லைனில் செலுத்துங்கள்",
        en: "Check free dates and pay the advance online.",
      };
}

export const STANDEE_SCAN_LINE = {
  ta: "உங்கள் கைபேசி கேமராவால் ஸ்கேன் செய்யுங்கள்",
  en: "Scan with your phone camera",
} as const;
