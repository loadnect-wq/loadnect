import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { fetchHallsResult, countActivePremiumHalls } from "@/lib/halls";
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
import { fetchCityInventory } from "@/lib/seo/cities";
import { fetchVenueCategories, fetchCategoryInventory } from "@/lib/venue-categories.server";
import { categoryLabelMap } from "@/lib/venue-categories";

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
  /** Upper bound of an inclusive availability range; only meaningful with `date`. */
  dateTo?:   string;
  sort?:     string;
  /** "today" from the homepage tile; mapped onto `date`. */
  available?: string;
}>;

/**
 * The parameters that genuinely produce a different result set. `sort` is
 * deliberately absent: re-ordering the same venues is the same collection, so
 * /halls?sort=rating stays indexable and consolidates to /halls.
 */
const FILTER_KEYS = [
  "city", "area", "capacity", "priceMin", "priceMax",
  "q", "category", "amenity", "date", "dateTo", "available",
] as const;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const sp = await searchParams;
  // NAME THE FILTERS, do not enumerate whatever arrived. The old test treated
  // every unknown parameter as a filter, so /halls?fbclid=… and /halls?utm_
  // source=whatsapp — the exact URLs a shared link carries — went noindex and
  // canonicalised away. A tracking parameter is not a filter; it is the same
  // page with a label stuck on it.
  const filtered = FILTER_KEYS.some((k) => {
    const v = sp[k];
    return typeof v === "string" && v.trim() !== "";
  });

  // A filtered view is a slice of the same collection: keep it out of the
  // index and keep following venue links. It does NOT also get a canonical
  // pointing at /halls — noindex plus a cross-canonical is a contradictory
  // pair (one says "index that instead", the other "index nothing"), and the
  // combination risks carrying the noindex over to /halls itself. noindex
  // alone does the job; buildMetadata self-canonicalises to path otherwise.
  return buildMetadata({
    title: filtered ? "Venue Search Results" : "Browse Halls & Venues for Every Occasion",
    description:
      "Browse every wedding hall, party hall, banquet and meeting venue listed on Hallnect. " +
      "Filter by occasion, city, guest capacity, budget, date and amenities.",
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
    dateTo   = "",
    sort     = "recommended",
  } = sp;

  // "Available Today" linked here with ?available=today and nothing read it,
  // so the tile showed the unfiltered list — every hall, including ones booked
  // solid. It maps onto the date filter, which already excludes halls blocked
  // for a given day. An explicit ?date= always wins.
  const effectiveDate = date || (sp.available === "today" ? todayInBusinessTz() : "");

  // One round of queries. These three are independent, and the premium count
  // used to be awaited inline in the JSX below, which serialised it behind the
  // whole search.
  // fetchHallsResult, not fetchHalls: an empty array from a BROKEN query and an
  // empty array from a genuine no-match are the same value, and this page's
  // whole job is to say which. Especially now, when zero venues is the expected
  // state and a failure would hide inside the ordinary empty screen.
  const [advancePercent, hallsResult, premiumCount, cityInventory, catalogue, categoryInventory] =
    await Promise.all([
    getAdvancePercent(),
    fetchHallsResult({
      city, area, capacity, priceMin, priceMax, q, category, amenity,
      date: effectiveDate, dateTo, sort,
    }),
    countActivePremiumHalls(),
    // Lenient by design: if this read fails the "Browse by city" block simply
    // does not render. A browse page must not 500 because a secondary
    // navigation aid could not load.
    fetchCityInventory(),
    // Same trade for the occasion chips — a failed read means fewer chips, not
    // a broken search.
    fetchVenueCategories(),
    fetchCategoryInventory(),
  ]);
  const { halls, failed: hallsFailed } = hallsResult;
  // Only cities that actually hold inventory get a link — the same gate that
  // decides whether their landing page is indexable at all.
  const citiesWithVenues = cityInventory.filter((c) => c.venueCount > 0);

  // Occasion chips, gated on live inventory for the same reason the city links
  // above are: a chip that filters to nothing is a control that looks like it
  // works. Eight is what fits a phone's scrolling row beside the sort button
  // and the two commercial chips; the rest are one tap away on the category
  // pages, and SearchControls always keeps whichever one the visitor arrived
  // on so they can switch it off.
  const chipCategories = catalogue
    .filter((c) => (categoryInventory.get(c.slug)?.venueCount ?? 0) > 0)
    .slice(0, 8)
    .map((c) => ({ slug: c.slug, name: c.name }));

  // Names for the badges on every card in this list. Built from the whole
  // active catalogue, not just the chips: a hall may declare an occasion that
  // did not make the eight-chip cut, and its badge should still read properly.
  const categoryLabels = categoryLabelMap(catalogue);

  // effectiveDate, not date — an "Available Today" visit with no matches must
  // read as a filter that found nothing, not as "no halls are listed yet".
  const hasFilters = !!(city || area || capacity || priceMin || priceMax || q || category || amenity || effectiveDate);

  return (
    <div className="min-h-screen bg-ivory-100">
      <JsonLd
        data={jsonLdGraph(
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Venues", path: "/halls" },
          ]),
        )}
      />
      <AppHeader title="Search" />

      {/* ── Controls (sticky on mobile) ───────────────────────────── */}
      <div className="sticky top-14 z-20 border-b border-border bg-white/95 backdrop-blur lg:top-16">
        <Suspense fallback={<div className="h-24" />}>
          {/* premiumCount: the Premium chip hides itself while there is no
              premium inventory, so it has to be told the live count — otherwise
              it stays hidden forever and does not come back when an owner
              actually buys a plan. */}
          <SearchControls
            premiumCount={premiumCount}
            categories={chipCategories}
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
            ? `Halls and venues in ${city}`
            : "Halls and venues for every occasion in Tamil Nadu"}
        </h1>
        <p className="mt-1 text-sm text-charcoal-600">
          {/* NOT "live availability". This list mixes both booking modes, and a
              lead-generation venue keeps no calendar here — see the Availability
              section in HallDetailView. Promising it on the list page sends
              customers to a venue page that (correctly) declines to make the
              claim. */}
          {halls.length > 0
            ? `${halls.length} ${halls.length === 1 ? "venue" : "venues"} with photos, capacity and pricing.`
            : "Venues with photos, capacity and pricing."}
        </p>
      </section>

      {/* ── Sponsored banner ─────────────────────────────────────── */}
      <section className="container-app pt-4 lg:max-w-7xl">
        <AdSlot placement="search_page_banner" limit={1} />
      </section>

      {/* ── Results ──────────────────────────────────────────────── */}
      <section className="container-app py-4 lg:max-w-7xl">
        {halls.length > 0 ? (
          <>
            {/* The document went h1 -> h3 (the card titles), skipping a level.
                Invisible, no layout change, and it names the result set for a
                screen reader rather than leaving the grid unlabelled. */}
            <h2 className="sr-only">
              {city ? `Venues in ${city}` : "Venues across Tamil Nadu"}
            </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {halls.map((hall, i) => (
              /* EVERY card animates, including the first row. `revealNow` puts
                 the top three on the CSS-keyframe path instead of the scroll
                 reveal: a keyframe finishes without JavaScript, so their paint
                 is gated on the blocking head script rather than on hydration
                 and the LCP cost is bounded to the stagger delay. That is what
                 previously forced the first row to sit the effect out. */
              <HallCard
                categoryLabels={categoryLabels}
                key={hall.id}
                hall={hall}
                advancePercent={advancePercent}
                revealIndex={i}
                revealNow={i < 3}
                eager={i === 0}
                // effectiveDate, not date — the homepage's "Available Today"
                // tile arrives as ?available=today and is mapped onto the same
                // filter, so it must mark lead venues too.
                dateFiltered={!!effectiveDate}
              />
            ))}
          </div>
          </>
        ) : (
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            // A failed query must never read as "we have no venues". Telling a
            // visitor the catalogue is empty when we simply could not read it
            // costs us the visit, and costs the venue a booking.
            title={hallsFailed ? "We couldn't load venues just now" : "No halls found"}
            description={
              hallsFailed
                ? "Something went wrong at our end — this is not a sign that no venues are listed. Please refresh, or try again in a moment."
                : hasFilters
                  ? "Try adjusting or clearing your filters to see more results."
                  : "No approved wedding halls are listed yet. Check back soon."
            }
            action={
              // Not on failure: clearing filters cannot fix a query that never
              // ran, and offering it implies the filters were the problem.
              hasFilters && !hallsFailed ? (
                <Link href="/halls" className="text-sm font-semibold text-maroon-600 hover:underline">
                  Clear all filters
                </Link>
              ) : undefined
            }
          />
        )}
      </section>

      {/* ── Browse by city ────────────────────────────────────────────
          /halls linked to no city landing page at all, which left
          /wedding-halls/<city> — the pages built specifically to rank for
          "wedding halls in <city>" — reachable only from the homepage. This is
          a real crawl path and a real reader path, rendered from live
          inventory so a city appears here on the same condition it becomes
          indexable: it has venues. Nothing renders when nothing qualifies, so
          there is no empty shell to maintain. */}
      {citiesWithVenues.length > 0 && (
        <section data-reveal="fade" className="container-app border-t border-border py-8 lg:max-w-7xl">
          <h2 className="font-serif text-base font-semibold text-charcoal-900">
            Browse wedding halls by city
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {citiesWithVenues.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/wedding-halls/${c.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-charcoal-700 transition-colors hover:border-maroon-300 hover:text-maroon-700"
                >
                  {c.city}
                  <span className="text-charcoal-400">
                    {c.venueCount}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
