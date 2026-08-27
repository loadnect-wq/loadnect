import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { fetchHalls } from "@/lib/halls";
import { todayInBusinessTz } from "@/lib/dates";
import { getAdvancePercent } from "@/lib/platform-settings";
import { EmptyState } from "@/components/ui/empty-state";
import { HallCard } from "./_components/HallCard";
import { SearchControls } from "./_components/SearchControls";
import { AppHeader } from "@/components/app/AppHeader";
import { AdSlot } from "@/components/ads/AdSlot";
import { buildMetadata } from "@/lib/seo/metadata";
import { JsonLd } from "@/components/seo/JsonLd";
import { jsonLdGraph, breadcrumbJsonLd } from "@/lib/seo/jsonld";

/**
 * CRAWL-TRAP CONTROL. This route accepts TEN independent query parameters
 * (city, area, capacity, priceMin, priceMax, q, category, amenity, date, sort),
 * whose combinations are effectively unbounded. Left open, Googlebot would
 * spend its crawl budget enumerating filter permutations of one page.
 *
 * The canonical below therefore always names the CLEAN /halls URL, so every
 * filtered variant consolidates into it, and generateMetadata additionally
 * marks filtered variants noindex,follow — indexing nothing, still following
 * the venue links so individual halls are discovered.
 */

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
  /** "today" from the homepage tile; mapped onto `date`. */
  available?: string;
}>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const sp = await searchParams;
  const filtered = Object.entries(sp).some(
    ([k, v]) => k !== "sort" && typeof v === "string" && v.trim() !== "",
  );

  // A filtered view is a slice of the same collection: keep it out of the
  // index, keep the canonical pointed at /halls, keep following venue links.
  return buildMetadata({
    title: filtered ? "Wedding Hall Search Results" : "Browse Wedding Halls & Event Venues",
    description:
      "Browse every verified wedding hall, marriage hall and event venue on Hallnect. " +
      "Filter by city, guest capacity, budget, date and amenities, then book your date online.",
    path: "/halls",
    indexable: !filtered,
  });
}

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

  // "Available Today" linked here with ?available=today and nothing read it,
  // so the tile showed the unfiltered list — every hall, including ones booked
  // solid. It maps onto the date filter, which already excludes halls blocked
  // for a given day. An explicit ?date= always wins.
  const effectiveDate = date || (sp.available === "today" ? todayInBusinessTz() : "");

  const advancePercent = await getAdvancePercent();
  const halls = await fetchHalls({
    city, area, capacity, priceMin, priceMax, q, category, amenity,
    date: effectiveDate, sort,
  });

  const hasFilters = !!(city || area || capacity || priceMin || priceMax || q || category || amenity || date);

  return (
    <div className="min-h-screen bg-ivory-100">
      <JsonLd
        data={jsonLdGraph(
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Wedding Halls", path: "/halls" },
          ]),
        )}
      />
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

      {/* ── Page heading ─────────────────────────────────────────────
          This template previously had NO h1 at all — the most commercially
          important listing page gave a crawler nothing to rank. The heading
          reflects the active city filter so a filtered view still reads
          correctly to a human, while the canonical keeps /halls as the one
          indexable URL. */}
      <section className="container-app pt-4 lg:max-w-7xl">
        <h1 className="font-serif text-xl font-bold text-charcoal-900 lg:text-2xl">
          {city
            ? `Wedding halls in ${city}`
            : "Wedding halls and event venues in Tamil Nadu"}
        </h1>
        <p className="mt-1 text-sm text-charcoal-600">
          {halls.length > 0
            ? `${halls.length} verified ${halls.length === 1 ? "venue" : "venues"} with photos, capacity, pricing and live availability.`
            : "Verified venues with photos, capacity, pricing and live availability."}
        </p>
      </section>

      {/* ── Sponsored banner ─────────────────────────────────────── */}
      <section className="container-app pt-4 lg:max-w-7xl">
        <AdSlot placement="search_page_banner" limit={1} />
      </section>

      {/* ── Results ──────────────────────────────────────────────── */}
      <section className="container-app py-4 lg:max-w-7xl">
        {halls.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {halls.map((hall) => (
              <HallCard key={hall.id} hall={hall} advancePercent={advancePercent} />
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
