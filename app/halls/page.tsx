import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { fetchHalls } from "@/lib/halls";
import { EmptyState } from "@/components/ui/empty-state";
import { HallCard } from "./_components/HallCard";
import { SearchControls } from "./_components/SearchControls";
import { AppHeader } from "@/components/app/AppHeader";
import { AdSlot } from "@/components/ads/AdSlot";

export const metadata: Metadata = { title: "Browse Wedding Halls" };

type SearchParams = Promise<{
  city?:     string;
  area?:     string;
  capacity?: string;
  priceMin?: string;
  priceMax?: string;
  q?:        string;
  category?: string;
  amenity?:  string;
  date?:     string;
  sort?:     string;
}>;

export default async function HallsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const {
    city     = "",
    area     = "",
    capacity = "",
    priceMin = "",
    priceMax = "",
    q        = "",
    category = "",
    amenity  = "",
    date     = "",
    sort     = "recommended",
  } = sp;

  const halls = await fetchHalls({
    city, area, capacity, priceMin, priceMax, q, category, amenity, date, sort,
  });

  const hasFilters = !!(city || area || capacity || priceMin || priceMax || q || category || amenity || date);

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Search" />

      {/* ── Controls (sticky on mobile) ───────────────────────────── */}
      <div className="sticky top-14 z-20 border-b border-border bg-white/95 backdrop-blur lg:top-16">
        <Suspense fallback={<div className="h-24" />}>
          <SearchControls
            defaultCity={city}
            defaultArea={area}
            defaultCapacity={capacity}
            defaultPriceMin={priceMin}
            defaultPriceMax={priceMax}
            defaultQuery={q}
            defaultCategory={category}
            defaultAmenity={amenity}
            defaultDate={date}
            defaultSort={sort}
            count={halls.length}
          />
        </Suspense>
      </div>

      {/* ── Sponsored banner ─────────────────────────────────────── */}
      <section className="container-app pt-4 lg:max-w-7xl">
        <AdSlot placement="search_page_banner" limit={1} />
      </section>

      {/* ── Results ──────────────────────────────────────────────── */}
      <section className="container-app py-4 lg:max-w-7xl">
        {halls.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {halls.map((hall) => (
              <HallCard key={hall.id} hall={hall} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="No halls found"
            description={
              hasFilters
                ? "Try adjusting or clearing your filters to see more results."
                : "No approved wedding halls are listed yet. Check back soon."
            }
            action={
              hasFilters ? (
                <Link href="/halls" className="text-sm font-semibold text-maroon-600 hover:underline">
                  Clear all filters
                </Link>
              ) : undefined
            }
          />
        )}
      </section>
    </div>
  );
}
