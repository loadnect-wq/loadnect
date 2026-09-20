// ─────────────────────────────────────────────────────────────────────────────
// components/sections/OccasionDiscovery.tsx — "What are you planning?"
//
// Every occasion the catalogue OFFERS, which is ten (migration 0103). Twenty-
// eight was a directory; ten is a choice, and a choice is what this grid is for.
// Nothing here caps or filters — the catalogue decides what is offered, and an
// admin changes that at /admin/venue-categories without a release.
//
// ════════════════════════════════════════════════════════════════════════════
// WHAT IS SHOWN vs WHAT IS INDEXED — TWO DIFFERENT DECISIONS
// ════════════════════════════════════════════════════════════════════════════
// This grid does NOT gate on inventory; the SEO layer still does, and that
// separation is what makes showing everything safe:
//
//   * a visitor clicking "Baby Shower" gets a real page that says plainly no
//     venue has listed for it yet, and offers the two things that help —
//     browse everything, or list your venue;
//   * Google is told nothing of the sort. /venues/baby-shower stays noindex
//     and out of the sitemap until a venue declares it.
//
// Do not re-gate the grid, and do not index the empty pages.
//
// ════════════════════════════════════════════════════════════════════════════
// THE COLUMN COUNTS ARE CHOSEN SO ROWS FILL
// ════════════════════════════════════════════════════════════════════════════
// 2 / 5 / 5 divide ten exactly, so no breakpoint leaves a widowed tile sitting
// alone on a final row. Three columns would (3+3+3+1), which is why the old
// grid-cols-3 is gone. If the offered count ever stops being ten, revisit this
// — a trailing orphan is the one thing that makes a neat grid look accidental.
//
// NO FABRICATED NUMBERS. A tile shows a venue count only when that count is
// above zero. It never prints "0 venues", and never invents one.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";

import type { VenueCategory } from "@/lib/venue-categories";
import { CategoryIcon } from "@/components/venues/CategoryIcon";
import { revealDelay } from "@/lib/motion";

export type OccasionTile = VenueCategory & { venueCount: number };

/**
 * Every offered occasion, the ones with venues first.
 *
 * ORDERING CARRIES THE HONESTY that hiding empty tiles used to: what Hallnect
 * can actually deliver today leads, and nothing is hidden behind it.
 *
 * `limit` stays available for callers that want a shortlist; the home page
 * passes nothing, because the catalogue is already the curated set.
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
          ? "container-app grid grid-cols-2 gap-3"
          : "grid grid-cols-2 gap-4 sm:grid-cols-5"
      }
    >
      {tiles.map((c, i) => (
        <li
          key={c.slug}
          // The house reveal system, not a hand-rolled animationDelay: it
          // staggers through --reveal-delay-base, which the stylesheet then
          // SHORTENS on small screens. An inline animation-delay would beat
          // that media query and leave the last tile waiting on a phone.
          data-reveal="scale"
          style={revealDelay(i)}
        >
          <Link
            href={`/venues/${c.slug}`}
            className={[
              "group relative flex h-full flex-col items-center justify-center gap-2 overflow-hidden",
              "rounded-2xl border border-border bg-white text-center",
              mobile ? "min-h-[104px] px-2 py-4" : "px-3 py-5",
              // The hover state is the whole "animated" brief on desktop: the
              // card lifts onto a gold edge while a maroon wash fades up from
              // the bottom. Transform and colour only — both composited, so a
              // ten-tile grid animates on the GPU and never reflows.
              "transition-all duration-300 ease-out",
              "hover:-translate-y-1 hover:border-gold-300 hover:shadow-card-hover",
              // A phone has no hover, so the feedback there is the press.
              "active:scale-95 motion-reduce:active:scale-100",
              "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
            ].join(" ")}
          >
            {/* The wash. Purely decorative and behind everything, so it can
                never intercept the tap. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-0 bg-gradient-to-t from-maroon-50 to-transparent transition-all duration-300 ease-out group-hover:h-full motion-reduce:transition-none motion-reduce:group-hover:h-0"
            />

            <span
              className={[
                "relative flex items-center justify-center rounded-2xl",
                "bg-maroon-50 text-maroon-600 ring-1 ring-maroon-100",
                mobile ? "h-11 w-11" : "h-12 w-12",
                "transition-all duration-300 ease-out",
                "group-hover:scale-110 group-hover:bg-white group-hover:text-maroon-700 group-hover:ring-gold-300",
                "motion-reduce:transition-none motion-reduce:group-hover:scale-100",
              ].join(" ")}
            >
              <CategoryIcon name={c.icon} className={mobile ? "h-5 w-5" : "h-5 w-5"} />
            </span>

            <span className="relative text-xs font-semibold leading-tight text-charcoal-800">
              {c.name}
            </span>

            {/* A REAL COUNT OR NOTHING AT ALL. An occasion nobody has listed
                for yet is an invitation, not a report — so it says nothing
                rather than "0 venues". */}
            {c.venueCount > 0 && (
              <span className="relative text-[10px] font-medium text-maroon-600">
                {c.venueCount} {c.venueCount === 1 ? "venue" : "venues"}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
