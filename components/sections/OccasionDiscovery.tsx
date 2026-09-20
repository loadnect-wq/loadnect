// ─────────────────────────────────────────────────────────────────────────────
// components/sections/OccasionDiscovery.tsx — "What are you planning?"
//
// A single ticker of occasions that drifts right to left, rather than the
// two-row grid this replaced. Ten tiles stacked 2x5 filled most of a phone
// screen and read as a wall; one moving line reads as a shelf.
//
// ════════════════════════════════════════════════════════════════════════════
// AN AUTO-SCROLLING STRIP OF LINKS IS A TRAP, AND HERE IS HOW IT IS DEFUSED
// ════════════════════════════════════════════════════════════════════════════
// Moving tap targets are the reason most marquees are a usability failure: the
// thing you reached for is not there when your finger lands. Four rules keep
// this one honest, and none of them is optional —
//
//   1. IT PAUSES WHEN ANYONE ENGAGES. Hover, keyboard focus anywhere inside,
//      and an active press (which is what a touch is) all stop it. So the
//      tile you are reaching for holds still the moment you touch it, and a
//      keyboard user tabbing through never chases a moving target.
//   2. REDUCED MOTION GETS NO MOTION AT ALL. Not a slower ticker — none. The
//      strip becomes an ordinary horizontally scrollable row, which is the
//      same content with the same reach.
//   3. THE DUPLICATE IS INVISIBLE TO ASSISTIVE TECH. A seamless loop needs
//      the list rendered twice; announcing twenty occasions when there are
//      ten, or letting Tab walk into a decorative copy, would be the cost of
//      a visual effect paid by the people least able to afford it. The clone
//      is aria-hidden and every link inside it is removed from the tab order.
//   4. IT IS STILL SCROLLABLE BY HAND. The track sits in an overflow-x-auto
//      container, so a flick works whether or not the animation is running.
//
// ════════════════════════════════════════════════════════════════════════════
// WHAT IS SHOWN vs WHAT IS INDEXED
// ════════════════════════════════════════════════════════════════════════════
// The strip shows every occasion the catalogue OFFERS (ten, migration 0103),
// including those no venue has listed for yet. The SEO layer still gates on
// inventory: /venues/baby-shower is noindex and out of the sitemap until a
// venue declares it. Do not re-gate the strip, and do not index the empty
// pages — an empty occasion page says so plainly and offers a way on.
//
// NO FABRICATED NUMBERS. A tile shows a venue count only when it is above
// zero. It never prints "0 venues", and never invents one.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";

import type { VenueCategory } from "@/lib/venue-categories";
import { CategoryIcon } from "@/components/venues/CategoryIcon";

export type OccasionTile = VenueCategory & { venueCount: number };

/**
 * Seconds per full cycle, derived from the tile count so the strip always
 * moves at the same READABLE SPEED.
 *
 * A fixed duration would make a five-item strip crawl and a twenty-item strip
 * race past. ~3.6s per tile is slow enough to read a two-word label.
 */
function cycleSeconds(tileCount: number): number {
  return Math.max(24, Math.round(tileCount * 3.6));
}

/**
 * Every offered occasion, the ones with venues first.
 *
 * ORDERING CARRIES THE HONESTY that hiding empty tiles used to: what Hallnect
 * can actually deliver today leads, and nothing is hidden behind it.
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
  const seconds = cycleSeconds(tiles.length);

  return (
    // group/marquee, not group: HallCard and others already use `group` inside
    // this tree, and an unnamed group would let a tile's own hover state be
    // driven by a parent that happens to share the name.
    // No width container here: the mobile strip is deliberately full-bleed so
    // tiles run to the screen edge, and the desktop call site already sits
    // inside container-page. Adding one would double-constrain the latter.
    <div className="group/marquee relative">
      {/* The track scrolls inside this, and the EDGE INSET LIVES HERE rather
          than on the track — see the note on the track's width below. */}
      <div className={`no-scrollbar overflow-x-auto ${mobile ? "px-4" : "px-1"}`}>
        <ul
          className={[
            // NO `gap` AND NO PADDING ON THE TRACK, AND THIS IS ARITHMETIC,
            // NOT STYLE. The animation travels exactly -50%, so the loop is
            // seamless only when half the track equals one list.
            //
            //   `gap-3` puts a gap BETWEEN items, so twenty tiles have
            //   nineteen gaps — one short of two complete lists. Add the
            //   track's own px-4 and half the track came out 10px past where
            //   the second list starts, which is a visible jolt once every
            //   cycle. Measured: 1170 vs 1160.
            //
            // So each tile carries its own trailing gap (pr-3 on the li) and
            // the inset moved to the scroll container, whose padding does not
            // count toward the track's width. Half of 20x116 is exactly 1160.
            // If you reintroduce `gap` here, re-measure the seam.
            "flex w-max items-stretch",
            "motion-safe:animate-marquee",
            // Rule 1 — anyone engaging stops it.
            "motion-safe:group-hover/marquee:[animation-play-state:paused]",
            "motion-safe:group-focus-within/marquee:[animation-play-state:paused]",
            "motion-safe:group-active/marquee:[animation-play-state:paused]",
            // Rule 2 — reduced motion gets none of it.
            "motion-reduce:animate-none",
          ].join(" ")}
          style={{ animationDuration: `${seconds}s` }}
        >
          {tiles.map((c) => (
            <OccasionCard key={c.slug} category={c} mobile={mobile} />
          ))}

          {/* Rule 3 — the seamless half. Present for the eye only: it is
              aria-hidden, and every link inside is out of the tab order. */}
          {tiles.map((c) => (
            <OccasionCard key={`clone-${c.slug}`} category={c} mobile={mobile} clone />
          ))}
        </ul>
      </div>

      {/* Fades that tell the eye the strip continues past the edge. Purely
          decorative and non-interactive, so they can never eat a tap. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-ivory-100 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-ivory-100 to-transparent"
      />
    </div>
  );
}

function OccasionCard({
  category: c,
  mobile,
  clone = false,
}: {
  category: OccasionTile;
  mobile: boolean;
  clone?: boolean;
}) {
  return (
    <li
      // pr-3 rather than a gap on the track: see the arithmetic there.
      className="shrink-0 pr-3"
      // The clone is scenery. Announcing it would double the list for a screen
      // reader reading a strip that visually contains ten things.
      {...(clone ? { "aria-hidden": true } : {})}
    >
      <Link
        href={`/venues/${c.slug}`}
        // Removed from the tab order rather than merely hidden: aria-hidden on
        // a focusable element is the classic combination that traps a keyboard
        // user on something their screen reader refuses to describe.
        tabIndex={clone ? -1 : undefined}
        className={[
          "group/tile relative flex flex-col items-center justify-center gap-2 overflow-hidden",
          "rounded-2xl border border-border bg-white text-center",
          mobile ? "h-[104px] w-[104px] px-2" : "h-[132px] w-[132px] px-3",
          "transition-all duration-300 ease-out",
          "hover:-translate-y-1 hover:border-gold-300 hover:shadow-card-hover",
          "active:scale-95 motion-reduce:active:scale-100",
          "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        ].join(" ")}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0 bg-gradient-to-t from-maroon-50 to-transparent transition-all duration-300 ease-out group-hover/tile:h-full motion-reduce:transition-none motion-reduce:group-hover/tile:h-0"
        />

        <span
          className={[
            "relative flex items-center justify-center rounded-2xl",
            "bg-maroon-50 text-maroon-600 ring-1 ring-maroon-100",
            mobile ? "h-10 w-10" : "h-12 w-12",
            "transition-all duration-300 ease-out",
            "group-hover/tile:scale-110 group-hover/tile:bg-white group-hover/tile:text-maroon-700 group-hover/tile:ring-gold-300",
            "motion-reduce:transition-none motion-reduce:group-hover/tile:scale-100",
          ].join(" ")}
        >
          <CategoryIcon name={c.icon} className="h-5 w-5" />
        </span>

        <span className="relative text-[11px] font-semibold leading-tight text-charcoal-800 sm:text-xs">
          {c.name}
        </span>

        {/* A REAL COUNT OR NOTHING AT ALL. An occasion nobody has listed for
            yet is an invitation, not a report. */}
        {c.venueCount > 0 && (
          <span className="relative text-[10px] font-medium text-maroon-600">
            {c.venueCount} {c.venueCount === 1 ? "venue" : "venues"}
          </span>
        )}
      </Link>
    </li>
  );
}
