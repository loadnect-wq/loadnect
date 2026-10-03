// The comparison itself: hall columns, one row per fact, amenity checks, map
// links and each hall's call to action. A server component; /compare/<code>
// supplies the rows (lib/compare.ts decides what they say).

import Image from "next/image";
import Link from "next/link";
import { Check, MapPin } from "lucide-react";
import { primaryCtaHref, primaryCtaLabel } from "@/lib/booking-mode";
import { mapsUrl, type CompareHall, type CompareRow } from "@/lib/compare";

export function CompareTable({
  halls,
  rows,
  amenities,
}: {
  halls: CompareHall[];
  rows: CompareRow[];
  amenities: { slug: string; name: string; has: boolean[] }[];
}) {
  const cols = { gridTemplateColumns: `repeat(${Math.max(halls.length, 1)}, minmax(0, 1fr))` };
  return (
    <div className="mt-5 rounded-2xl bg-white shadow-card ring-1 ring-border">
      {/* The hall names stay in view while the rows scroll past. */}
      <div className="sticky top-14 z-10 grid gap-3 rounded-t-2xl border-b border-border bg-white p-3 lg:top-16" style={cols}>
        {halls.map((h) => (
          <Link key={h.id} href={`/halls/${h.slug}`} className="min-w-0 group">
            <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-ivory-200">
              {h.coverUrl && (
                <Image src={h.coverUrl} alt="" fill sizes="(max-width: 1024px) 33vw, 300px" className="object-cover" />
              )}
            </div>
            <p className="mt-2 line-clamp-2 text-sm font-bold leading-snug text-charcoal-900 group-hover:text-maroon-700">
              {h.name}
            </p>
            <p className="text-xs text-charcoal-600">{h.city}</p>
          </Link>
        ))}
      </div>

      {rows.map((r) => (
        <div key={r.key} className="border-b border-border px-3 py-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">{r.label}</h2>
          <div className="mt-1 grid gap-3" style={cols}>
            {r.cells.map((cell, i) => (
              <div key={i} className="min-w-0 break-words text-sm text-charcoal-900">
                {cell}
                {r.best.includes(i) && r.bestLabel && (
                  <span className="ml-1 inline-block rounded-full bg-gold-50 px-2 py-0.5 text-[10px] font-semibold text-gold-800 ring-1 ring-gold-300/70">
                    {r.bestLabel}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {amenities.length > 0 && (
        <div className="border-b border-border px-3 py-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Amenities the hall lists</h2>
          {amenities.map((a) => (
            <div key={a.slug} className="mt-2">
              <p className="text-xs text-charcoal-600">{a.name}</p>
              <div className="grid gap-3" style={cols}>
                {a.has.map((has, i) => (
                  <div key={i} className="text-sm">
                    {has ? (
                      <span className="inline-flex items-center gap-1 font-medium text-green-800">
                        <Check className="h-4 w-4" aria-hidden /> Listed
                      </span>
                    ) : (
                      <span className="text-charcoal-400" aria-label="Not listed">—</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-b border-border px-3 py-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Location</h2>
        <div className="mt-1 grid gap-3" style={cols}>
          {halls.map((h) => (
            <div key={h.id} className="min-w-0 text-sm text-charcoal-900">
              <p className="line-clamp-3 break-words">{h.address ?? h.city}</p>
              <a
                href={mapsUrl(h)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex min-h-[32px] items-center gap-1 text-xs font-semibold text-maroon-700 hover:underline"
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden /> Map
              </a>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 p-3" style={cols}>
        {halls.map((h) => (
          <div key={h.id} className="flex min-w-0 flex-col gap-2">
            <Link
              href={primaryCtaHref(h.bookingMode, h.slug)}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-maroon-700 px-2 text-center text-sm font-semibold text-white hover:bg-maroon-800"
            >
              {primaryCtaLabel(h.bookingMode)}
            </Link>
            <Link
              href={`/halls/${h.slug}`}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-border px-2 text-center text-sm font-semibold text-charcoal-800 hover:bg-ivory-100"
            >
              View hall
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
