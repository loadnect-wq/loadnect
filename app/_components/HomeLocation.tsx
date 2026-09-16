"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, MapPin } from "lucide-react";
import { BottomSheet } from "@/components/app/BottomSheet";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// THE CITY PICKER UNDER THE HOMEPAGE H1.
//
// It used to be a dead control, and it was the most prominent one on the site.
// Selecting a city wrote it to localStorage under "hallnect:city" and stopped
// there: nothing in the codebase ever read that key, so the picker changed a
// label and nothing else. Worse, its list came from lib/mock-data's CITIES —
// seventeen hardcoded names including several Hallnect has never had a venue
// in, so even a working version would have offered empty searches.
//
// Now it navigates, and its list is the live inventory the server already
// computed for the "Browse by city" links (lib/seo/cities.ts). Every option
// leads to a search with results in it. If there is no inventory anywhere the
// component renders nothing at all — an absent control beats a lying one.
//
// The localStorage write is gone rather than "kept just in case": a stored
// preference nothing consumes is exactly how this became dead the first time.
// If a remembered city is wanted later, add the reader in the same change.
// ─────────────────────────────────────────────────────────────────────────────

/** Structural — mirrors CityInventory from lib/seo/cities (server-only there). */
type CityOption = {
  city:       string;
  slug:       string;
  venueCount: number;
};

export function HomeLocation({
  cities,
  /**
   * Render for a dark background. The mobile homepage now sits this control
   * over the hero video, where charcoal-on-video fails contrast badly; the
   * light tokens are the same ones the desktop hero already uses.
   */
  onDark = false,
}: {
  cities: readonly CityOption[];
  onDark?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (cities.length === 0) return null;

  function goToCity(city: string) {
    setOpen(false);
    router.push(`/halls?city=${encodeURIComponent(city)}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "hit-44 mt-2 inline-flex items-center gap-1.5 text-sm font-medium",
          // White, not ivory-200. Over the mobile hero video this label
          // measured 4.69:1 against a 4.5 bar — a 4% margin, on a number
          // derived from a single poster frame. White takes it to 5.49:1
          // (+22%) and is indistinguishable at 14px on a dark video.
          onDark ? "text-white" : "text-charcoal-700",
        )}
      >
        <MapPin className={cn("h-4 w-4", onDark ? "text-gold-300" : "text-maroon-500")} />
        <span>Browse by city</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5", onDark ? "text-ivory-400" : "text-charcoal-500")}
        />
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Cities with venues">
        <ul className="grid grid-cols-2 gap-2 pb-4">
          {cities.map((c) => (
            <li key={c.slug}>
              <button
                type="button"
                onClick={() => goToCity(c.city)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl border border-border bg-white",
                  "px-3 py-2.5 text-left text-sm text-charcoal-800",
                )}
              >
                <MapPin className="h-4 w-4 shrink-0 text-charcoal-400" />
                <span className="min-w-0">
                  <span className="block truncate">{c.city}</span>
                  {/* The real count, so the tap is an informed one. */}
                  <span className="block text-[11px] text-charcoal-500">
                    {c.venueCount} {c.venueCount === 1 ? "venue" : "venues"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  );
}
