// ─────────────────────────────────────────────────────────────────────────────
// components/sections/OccasionDiscovery.tsx — "What are you planning?"
//
// EVERY occasion in the catalogue, whether or not a venue has declared it yet.
// Hallnect is a multi-purpose venue marketplace and this grid is where a
// visitor learns that; showing only the two occasions that currently have
// inventory made the product look like the wedding-hall site it used to be.
//
// ════════════════════════════════════════════════════════════════════════════
// WHAT IS SHOWN vs WHAT IS INDEXED — TWO DIFFERENT DECISIONS
// ════════════════════════════════════════════════════════════════════════════
// This grid deliberately does NOT gate on inventory. The SEO layer still does,
// and that separation is the whole reason showing everything here is safe:
//
//   * a visitor clicking "Baby Shower" gets a real page that says, plainly,
//     that no venue has listed for it yet, and offers the two things that
//     actually help — browse everything, or list your venue;
//   * Google is told nothing of the sort. /venues/baby-shower is noindex and
//     absent from the sitemap until a venue declares it (see
//     MIN_VENUES_FOR_CATEGORY_INDEX). Twenty-six thin pages in a sitemap is
//     the doorway-page pattern that earns manual actions; twenty-six honest
//     pages a human can reach from a grid is a catalogue.
//
// So: humans see the full marketplace, crawlers see only what is real. Do not
// "simplify" this by gating the grid again, and do not "simplify" it by
// indexing the empty pages.
//
// NO FABRICATED NUMBERS. A tile shows a venue count only when that count is
// above zero. It never prints "0 venues", because a grid of zeroes is worse
// than a grid without counts — and it never invents one.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";

import type { VenueCategory } from "@/lib/venue-categories";
import { CategoryIcon } from "@/components/venues/CategoryIcon";

export type OccasionTile = VenueCategory & { venueCount: number };

/**
 * Every active occasion, the ones with venues first.
 *
 * ORDERING CARRIES THE HONESTY the filter used to. Nothing is hidden, but what
 * Hallnect can actually deliver today leads — so the grid reads as a real
 * marketplace with depth in some corners rather than a uniform wall that
 * implies inventory everywhere.
 *
 * `limit` is optional and unset by default: the caller decides, and the home
 * page shows all of them.
 */
export function occasionTiles(
  categories: readonly VenueCategory[],
  counts: Map<string, { venueCount: number }>,
  limit?: number,
): OccasionTile[] {
  const tiles = categories
    .map((c) => ({ ...c, venueCount: counts.get(c.slug)?.venueCount ?? 0 }))
    .sort((a, b) => b.venueCount - a.venueCount || a.displayOrder - b.displayOrder);
  return typeof limit === "number" ? tiles.slice(0, limit) : tiles;
}

export function OccasionDiscovery({
  tiles,
  variant,
}: {
  tiles: OccasionTile[];
  variant: "mobile" | "desktop";
}) {
  if (tiles.length === 0) return null;

  const mobile = variant === "mobile";

  return (
    <ul
      className={
        mobile
          ? "container-app grid grid-cols-3 gap-2.5"
          : "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6"
      }
    >
      {tiles.map((c, i) => (
        <li
          key={c.slug}
          data-reveal="scale"
          // Capped, not i * 50: with 28 tiles an uncapped stagger would leave
          // the last row waiting 1.4s after the first.
          style={{ animationDelay: `${Math.min(i, 11) * 45}ms` }}
        >
          <Link
            href={`/venues/${c.slug}`}
            className={
              mobile
                ? "flex min-h-[92px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-white px-2 py-3 text-center shadow-card transition-transform active:scale-95 motion-reduce:active:scale-100"
                : "group flex flex-col items-center gap-2 rounded-2xl border border-border bg-white p-4 transition-all hover:-translate-y-1 hover:border-maroon-300 hover:shadow-card-hover"
            }
          >
            <span
              className={
                mobile
                  ? "flex h-9 w-9 items-center justify-center rounded-full bg-maroon-50 text-maroon-600"
                  : "flex h-12 w-12 items-center justify-center rounded-xl bg-maroon-50 text-maroon-600 transition-colors group-hover:bg-maroon-100"
              }
            >
              <CategoryIcon name={c.icon} className={mobile ? "h-4 w-4" : "h-5 w-5"} />
            </span>

            <span className="text-center text-[11px] font-semibold leading-tight text-charcoal-800 sm:text-xs">
              {c.name}
            </span>

            {/* A REAL COUNT OR NOTHING AT ALL. Never "0 venues" — an occasion
                nobody has listed for yet is an invitation, not a report. */}
            {c.venueCount > 0 && (
              <span className="text-[10px] text-charcoal-500">
                {c.venueCount} {c.venueCount === 1 ? "venue" : "venues"}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
