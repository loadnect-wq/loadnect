// ─────────────────────────────────────────────────────────────────────────────
// components/sections/OccasionDiscovery.tsx — "What are you planning?"
//
// The homepage's entry point into the multi-purpose catalogue: a tile per
// occasion, each leading to that occasion's landing page.
//
// EVERY TILE HERE HAS INVENTORY BEHIND IT. The caller passes counts and this
// component drops anything at zero, which is the single most important rule on
// the page and the one this codebase has had to learn twice:
//
//   * the four venue-type tiles that this replaces linked to ?category=… with
//     nothing checking whether any hall declared it, so "Party Halls" could
//     lead to "No halls found";
//   * the "✦ Premium" tile and chip did exactly the same for a tier no hall
//     held, and had to be hidden until premium_listings was non-empty.
//
// A grid of 28 occasions where 24 lead nowhere is that defect at scale. So the
// list is gated on live counts and the whole section disappears when nothing
// qualifies — which is the correct homepage for a marketplace with no
// inventory, and it fills itself in, tile by tile, as owners declare more.
//
// NO FABRICATED VARIETY. It would be easy to render all 28 and call it a
// marketplace. The counts are real or the tile is absent.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";

import type { VenueCategory } from "@/lib/venue-categories";
import { CategoryIcon } from "@/components/venues/CategoryIcon";

export type OccasionTile = VenueCategory & { venueCount: number };

/**
 * Tiles worth showing, most inventory first.
 *
 * Cut at twelve. Beyond that the strip stops being a shortcut and becomes a
 * list the visitor has to read — and everything below the cut is still one tap
 * away through "See all", which the caller renders.
 */
export function occasionTiles(
  categories: readonly VenueCategory[],
  counts: Map<string, { venueCount: number }>,
  limit = 12,
): OccasionTile[] {
  return categories
    .map((c) => ({ ...c, venueCount: counts.get(c.slug)?.venueCount ?? 0 }))
    .filter((c) => c.venueCount > 0)
    .sort((a, b) => b.venueCount - a.venueCount || a.displayOrder - b.displayOrder)
    .slice(0, limit);
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
        <li key={c.slug} data-reveal="scale" style={{ animationDelay: `${i * 50}ms` }}>
          <Link
            href={`/venues/${c.slug}`}
            className={
              mobile
                ? "flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-2xl bg-white px-2 py-3 text-center shadow-card transition-transform active:scale-95 motion-reduce:active:scale-100"
                : "group flex flex-col items-center gap-2 rounded-2xl border border-border bg-white p-4 transition-all hover:-translate-y-1 hover:border-maroon-300 hover:shadow-card-hover"
            }
          >
            <span
              className={
                mobile
                  ? "flex h-10 w-10 items-center justify-center rounded-full bg-maroon-50 text-maroon-600"
                  : "flex h-12 w-12 items-center justify-center rounded-xl bg-maroon-50 text-maroon-600 transition-colors group-hover:bg-maroon-100"
              }
            >
              <CategoryIcon name={c.icon} className="h-5 w-5" />
            </span>
            <span className="text-center text-xs font-semibold leading-tight text-charcoal-800">
              {c.name}
            </span>
            {/* The real count, or nothing. A tile never reaches this component
                at zero, so this line is always a fact. */}
            <span className="text-[10px] text-charcoal-500">
              {c.venueCount} {c.venueCount === 1 ? "venue" : "venues"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
