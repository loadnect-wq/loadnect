import Image from "next/image";
import Link from "next/link";

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

export function CitiesRow({ cities }: { cities: readonly City[] }) {
  return (
    <div data-reveal="scale" className="no-scrollbar overflow-x-auto">
      <ul className="flex w-max gap-3 px-4 sm:px-6">
        {cities.map((c) => (
          <li key={c.name}>
            <Link
              // /wedding-halls/<slug>, NOT /halls?city=… — the filtered
              // listing is deliberately noindex, so linking to it here spent
              // the mobile homepage's internal links on a page that cannot
              // rank while the city landing page received none.
              href={`/wedding-halls/${c.slug}`}
              className="relative block h-32 w-40 overflow-hidden rounded-2xl shadow-card transition-transform active:scale-95"
            >
              <div className="absolute inset-0" style={{ background: c.gradient }} aria-hidden />
              {c.image && (
                <Image
                  src={c.image}
                  alt=""
                  fill
                  sizes="160px"
                  className="object-cover object-[50%_35%]"
                />
              )}
              {/* Heavier over a photo — see the measured note on the desktop
                  tiles in app/page.tsx. */}
              <div
                className={`absolute inset-0 bg-gradient-to-t to-transparent ${
                  c.image ? "from-black/80 via-black/30" : "from-black/70 via-black/20"
                }`}
              />
              {!c.live && (
                <span className="absolute right-2 top-2 rounded-full bg-black/40 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                  Coming soon
                </span>
              )}
              <div className="absolute bottom-0 left-0 right-0 p-3 text-white">
                <p className="font-serif text-base font-bold leading-tight">{c.name}</p>
                <p className="text-[10px] text-white/90">{c.state}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
