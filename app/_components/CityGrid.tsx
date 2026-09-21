import Image from "next/image";
import Link from "next/link";
import { revealDelay } from "@/lib/motion";

interface City {
  name: string;
  state: string;
  gradient: string;
  /** Canonical city slug — the link target must be the indexable landing page. */
  slug: string;
  /** Has approved venues. False renders a "Coming soon" tile — see LAUNCH_CITIES. */
  live: boolean;
  /** Same-origin cover photo; the gradient shows when there is none. */
  image?: string;
}

/**
 * The phone homepage's city tiles, as one swipeable row.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THIS HAS BEEN A STRIP, THEN A GRID, AND IS A STRIP AGAIN — READ WHY FIRST
 * ════════════════════════════════════════════════════════════════════════════
 * It started as a sideways strip of 160x128 tiles. That showed two and a bit
 * cities and hid the rest behind a swipe nobody was told about, so it became a
 * 2x2 grid — which was right for four cities.
 *
 * There are six now, which made the grid three rows and 436px tall, and the
 * owner has asked for scrolling rows over stacked ones. The original objection
 * was never "strips are bad"; it was "this strip gives no sign it scrolls". So
 * the fix keeps the strip and answers that objection directly, the same way
 * the Featured Venues carousel already does: each tile is narrower than half
 * the screen, so a third one visibly PEEKS in from the right edge. A cut-off
 * card is the affordance — the swipe explains itself.
 *
 * If you are tempted to go back to a grid, the thing to measure is whether the
 * peek is still visible at 320px, not whether a grid "shows everything".
 */
export function CityGrid({ cities }: { cities: readonly City[] }) {
  return (
    // Snaps tile by tile. scroll-px matches the track's px-4 so a snapped tile
    // aligns with the page gutter instead of the screen edge.
    <div className="no-scrollbar snap-x snap-mandatory overflow-x-auto scroll-px-4">
      <ul className="flex w-max gap-3 px-4 pb-1">
        {cities.map((c, i) => (
          <li
            key={c.name}
            data-reveal="scale"
            style={revealDelay(i, 70)}
            // 42vw: two whole tiles plus a clear sliver of a third on any
            // phone from 320px up — that sliver is what says "swipe". The max
            // stops a tablet from getting two huge tiles and no peek.
            className="w-[42vw] max-w-[200px] shrink-0 snap-start"
          >
            <Link
              // /wedding-halls/<slug>, NOT /halls?city=… — the filtered
              // listing is deliberately noindex, so linking to it here spent
              // the mobile homepage's internal links on a page that cannot
              // rank while the city landing page received none.
              href={`/wedding-halls/${c.slug}`}
              className="relative block aspect-[4/5] overflow-hidden rounded-2xl shadow-card transition-transform active:scale-[0.97] motion-reduce:active:scale-100"
            >
              <div className="absolute inset-0" style={{ background: c.gradient }} aria-hidden />
              {c.image && (
                <Image
                  src={c.image}
                  alt=""
                  fill
                  // The tile is 42vw, capped at 200px.
                  sizes="(max-width: 476px) 42vw, 200px"
                  className="object-cover object-[50%_35%]"
                />
              )}
              {/* Heavier over a photo — see the measured note on the desktop
                  tiles in app/page.tsx. */}
              <div
                className={`absolute inset-0 bg-gradient-to-t to-transparent ${
                  c.image ? "from-black/90 via-black/50" : "from-black/70 via-black/20"
                }`}
              />
              {!c.live && (
                <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                  Coming soon
                </span>
              )}
              <div className="absolute bottom-0 left-0 right-0 p-3 text-white">
                <p className="font-serif text-base font-bold leading-tight">{c.name}</p>
                <p className="text-[11px] text-white/90">{c.state}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
