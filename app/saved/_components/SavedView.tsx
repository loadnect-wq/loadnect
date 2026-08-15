"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { useSavedHalls } from "@/lib/hooks/useSavedHalls";
import { MOCK_HALLS } from "@/lib/mock-data";
import { type HallListing } from "@/lib/halls";
import { HallCard } from "@/app/halls/_components/HallCard";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";

// Saved halls are stored as IDs in localStorage. Until the saved-list moves
// to Supabase, we re-shape the mock data so it fits the HallCard contract.
function toListing(m: typeof MOCK_HALLS[number]): HallListing {
  return {
    id:             m.id,
    slug:           m.slug,
    name:           m.name,
    city:           m.city,
    address:        null,
    capacity_max:   m.capacity,
    price_per_day:  m.pricePerDay,
    is_premium:     m.isPremium,
    premium_tier:   m.isPremium ? "premium" : null,
    rating_average: m.rating,
    rating_count:   m.reviewCount,
    cover_url:      null,
    amenities:      m.amenities,
  };
}

export function SavedView() {
  const { ids } = useSavedHalls();
  const halls = MOCK_HALLS.filter((h) => ids.includes(h.id)).map(toListing);

  return (
    <section className="container-app py-5 lg:max-w-7xl">
      {halls.length === 0 ? (
        <EmptyState
          icon={<Heart className="h-8 w-8" />}
          title="No saved halls yet"
          description="Tap the heart on any hall to save it for later."
          action={
            <Link href="/halls" className={buttonVariants({ variant: "gold", size: "sm" })}>
              Browse Halls
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {halls.map((h) => <HallCard key={h.id} hall={h} />)}
        </div>
      )}
    </section>
  );
}
