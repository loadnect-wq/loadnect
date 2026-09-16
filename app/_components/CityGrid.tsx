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
 * The phone homepage's city tiles, two to a row.
 *
 * Was a sideways-scrolling strip of 160x128 tiles, which showed two and a bit
 * cities and hid the rest behind a swipe nobody was told about. With four
 * launch cities a 2x2 grid shows every one at once, and each photo gets twice
 * the area.
 */
export function CityGrid({ cities }: { cities: readonly City[] }) {
  return (
    <ul className="container-app grid grid-cols-2 gap-3">
      {cities.map((c, i) => (
        <li key={c.name} data-reveal="scale" style={revealDelay(i, 70)}>
          <Link
            // /wedding-halls/<slug>, NOT /halls?city=… — the filtered
            // listing is deliberately noindex, so linking to it here spent
            // the mobile homepage's internal links on a page that cannot
            // rank while the city landing page received none.
            href={`/wedding-halls/${c.slug}`}
            className="relative block aspect-[4/3] overflow-hidden rounded-2xl shadow-card transition-transform active:scale-[0.97] motion-reduce:active:scale-100"
          >
            <div className="absolute inset-0" style={{ background: c.gradient }} aria-hidden />
            {c.image && (
              <Image
                src={c.image}
                alt=""
                fill
                // Half of container-app (max 512px) less the gutter.
                sizes="(max-width: 512px) 50vw, 250px"
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
  );
}
