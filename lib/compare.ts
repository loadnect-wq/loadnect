// ─────────────────────────────────────────────────────────────────────────────
// lib/compare.ts — "compare up to three halls". Safe for the client.
//
// The family WhatsApp group decides between two or three halls, usually with a
// hand-typed list of prices and screenshots. /compare/<code> puts them side by
// side from what each hall lists on Hallnect, and the link goes back into the
// group. The code is a shortlist code (lib/shortlist.ts) holding 2–3 ids, so
// nothing is stored.
//
// A DASH IS "NOT LISTED", NEVER "NO". A hall that did not tick "Free Parking"
// may well have parking; the page says the hall has not listed it, and the
// legend tells the family to ask. Highlights ("lowest price", "most guests")
// are computed only from values a hall actually published, and only when the
// halls differ — a tie is not a winner.
// ─────────────────────────────────────────────────────────────────────────────

import { decodeShortlist, encodeShortlist } from "@/lib/shortlist";
import { formatHallPrice, hasPrice, isLeadGeneration } from "@/lib/booking-mode";
import type { BookingMode } from "@/lib/booking-mode";

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 3;

export type CompareHall = {
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string | null;
  capacityMin: number | null;
  capacityMax: number;
  pricePerDay: number | null;
  priceMorning: number | null;
  priceEvening: number | null;
  bookingMode: BookingMode;
  ratingAverage: number;
  ratingCount: number;
  venueTypes: string[];
  amenities: { slug: string; name: string }[];
  customAmenities: string[];
  coverUrl: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** The code for comparing these halls (the first three), or null for fewer than two. */
export function compareCode(ids: readonly string[]): string | null {
  const code = encodeShortlist(ids.slice(0, MAX_COMPARE));
  const decoded = code ? decodeShortlist(code) : null;
  return decoded && decoded.length >= MIN_COMPARE ? code : null;
}

/** 2–3 hall ids, or null for anything else. */
export function decodeCompare(code: string): string[] | null {
  const ids = decodeShortlist(code);
  return ids && ids.length >= MIN_COMPARE && ids.length <= MAX_COMPARE ? ids : null;
}

export function comparePath(code: string): string {
  return `/compare/${code}`;
}

export function compareTitle(count: number): string {
  return `Comparing ${count} halls`;
}

/** "Sri Mahal vs Kovai Hall vs Lakshmi Hall" */
export function versusLine(halls: readonly { name: string }[]): string {
  return halls.map((h) => h.name).join(" vs ");
}

/** The WhatsApp message, in the sender's voice, without the link. */
export function compareShareText(count: number): string {
  return `I'm comparing these ${count} halls on Hallnect. Which one should we pick?`;
}

export function mapsUrl(h: Pick<CompareHall, "latitude" | "longitude" | "address" | "name" | "city">): string {
  return h.latitude != null && h.longitude != null
    ? `https://maps.google.com/?q=${h.latitude},${h.longitude}`
    : `https://maps.google.com/?q=${encodeURIComponent(`${h.address ?? h.name}, ${h.city}`)}`;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export type CompareRow = {
  key: string;
  label: string;
  cells: string[];
  /** Columns that win this row, with the badge text. Empty when nothing stands out. */
  best: number[];
  bestLabel?: string;
};

/** Indexes holding the extreme of the values that exist — only when the halls genuinely differ. */
function winners(values: (number | null)[], pick: "min" | "max"): number[] {
  const real = values.filter((v): v is number => v != null);
  if (real.length < 2) return [];
  const target = pick === "min" ? Math.min(...real) : Math.max(...real);
  if (real.every((v) => v === target)) return [];
  return values.flatMap((v, i) => (v === target ? [i] : []));
}

function guests(h: CompareHall): string {
  if (h.capacityMin && h.capacityMin > 0 && h.capacityMin < h.capacityMax) {
    return `${h.capacityMin.toLocaleString("en-IN")}–${h.capacityMax.toLocaleString("en-IN")} guests`;
  }
  return `Up to ${h.capacityMax.toLocaleString("en-IN")} guests`;
}

function slotPrices(h: CompareHall): string {
  const parts = [
    hasPrice(h.priceMorning) ? `Morning ${formatHallPrice(h.priceMorning)}` : null,
    hasPrice(h.priceEvening) ? `Evening ${formatHallPrice(h.priceEvening)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

/**
 * The comparison, row by row. A row every hall leaves empty is dropped: a line
 * of dashes tells the family nothing.
 */
export function compareRows(halls: readonly CompareHall[], categoryLabels: Record<string, string>): CompareRow[] {
  const rows: CompareRow[] = [];

  rows.push({
    key: "price",
    label: "Price per day",
    cells: halls.map((h) => formatHallPrice(h.pricePerDay)),
    best: winners(halls.map((h) => (hasPrice(h.pricePerDay) ? h.pricePerDay : null)), "min"),
    bestLabel: "Lowest",
  });

  if (halls.some((h) => hasPrice(h.priceMorning) || hasPrice(h.priceEvening))) {
    rows.push({ key: "slots", label: "Half-day prices", cells: halls.map(slotPrices), best: [] });
  }

  rows.push({
    key: "guests",
    label: "Guests",
    cells: halls.map(guests),
    best: winners(halls.map((h) => h.capacityMax), "max"),
    bestLabel: "Most guests",
  });

  rows.push({
    key: "booking",
    label: "How to book",
    // Short: a third of a phone screen each. The venue page says the rest.
    cells: halls.map((h) => (isLeadGeneration(h.bookingMode) ? "Send an enquiry" : "Book online with an advance")),
    best: [],
  });

  if (halls.some((h) => h.ratingCount > 0)) {
    rows.push({
      key: "rating",
      label: "Reviews",
      cells: halls.map((h) =>
        h.ratingCount > 0
          ? `${h.ratingAverage.toFixed(1)} ★ (${h.ratingCount} ${h.ratingCount === 1 ? "review" : "reviews"})`
          : "No reviews yet",
      ),
      best: winners(halls.map((h) => (h.ratingCount > 0 ? h.ratingAverage : null)), "max"),
      bestLabel: "Top rated",
    });
  }

  if (halls.some((h) => h.venueTypes.length > 0)) {
    rows.push({
      key: "occasions",
      label: "Occasions",
      cells: halls.map((h) => {
        const names = h.venueTypes.map((s) => categoryLabels[s]).filter(Boolean);
        if (names.length === 0) return "—";
        return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
      }),
      best: [],
    });
  }

  if (halls.some((h) => h.customAmenities.length > 0)) {
    rows.push({
      key: "extras",
      label: "The hall also lists",
      cells: halls.map((h) => (h.customAmenities.length ? h.customAmenities.join(", ") : "—")),
      best: [],
    });
  }

  return rows;
}

/** Amenities any of the halls lists, in a fixed order families care about, then by name. */
const AMENITY_ORDER = [
  "air-conditioning", "free-parking", "valet-parking", "in-house-catering", "in-house-decor",
  "bridal-suite", "generator-backup", "av-stage-setup", "dj-music", "wheelchair-access",
  "outdoor-garden", "swimming-pool",
];

export function amenityRows(halls: readonly CompareHall[]): { slug: string; name: string; has: boolean[] }[] {
  const names = new Map<string, string>();
  for (const h of halls) for (const a of h.amenities) names.set(a.slug, a.name);
  const rank = (slug: string) => {
    const i = AMENITY_ORDER.indexOf(slug);
    return i === -1 ? AMENITY_ORDER.length : i;
  };
  return [...names.entries()]
    .sort(([a, an], [b, bn]) => rank(a) - rank(b) || an.localeCompare(bn))
    .map(([slug, name]) => ({ slug, name, has: halls.map((h) => h.amenities.some((a) => a.slug === slug)) }));
}
