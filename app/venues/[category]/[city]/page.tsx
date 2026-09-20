// ─────────────────────────────────────────────────────────────────────────────
// /venues/[category]/[city] — "birthday party halls in Madurai".
//
// The commercially valuable shape: almost nobody searches for an occasion
// without a place. This is the page that answers those queries, and the reason
// the category system exists at all beyond a filter chip.
//
// ════════════════════════════════════════════════════════════════════════════
// /venues/wedding/<city> REDIRECTS. IT DOES NOT RENDER.
// ════════════════════════════════════════════════════════════════════════════
// /wedding-halls/<city> already exists, already targets exactly this query for
// weddings, and is the only page set on this site that currently ranks.
// Rendering /venues/wedding/madurai would publish a SECOND page about the same
// venues with the same intent — textbook duplicate content, competing with the
// one page we would rather keep. So that combination 308s to the existing URL
// and the legacy page keeps every signal it has.
//
// This is also why the two are not "unified": moving /wedding-halls/<city> to
// the new namespace would trade a ranking page for a redirect chain to buy
// consistency nobody outside the codebase can see.
//
// ════════════════════════════════════════════════════════════════════════════
// INDEXABILITY
// ════════════════════════════════════════════════════════════════════════════
// 28 occasions x ~20 service areas = 560 potential URLs. Indexing them wholesale
// is the programmatic-SEO spam that earns manual actions, so — exactly as for
// cities — a page is indexable only when approved venues really do declare that
// occasion in that city. Everything else renders (the question is real) and is
// noindex, out of the sitemap, and linked from nowhere.
// ─────────────────────────────────────────────────────────────────────────────

import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";

import { fetchHalls } from "@/lib/halls";
import { hasPrice, isLeadGeneration } from "@/lib/booking-mode";
import { getAdvancePercent } from "@/lib/platform-settings";
import { HallCard } from "@/app/halls/_components/HallCard";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { buildMetadata } from "@/lib/seo/metadata";
import { JsonLd } from "@/components/seo/JsonLd";
import { jsonLdGraph, breadcrumbJsonLd, categoryCollectionJsonLd } from "@/lib/seo/jsonld";
import { cityFromSlug, citySlug } from "@/lib/seo/cities";
import {
  fetchVenueCategories,
  fetchVenueCategoryBySlug,
  fetchCategoryInventoryStrict,
  MIN_VENUES_FOR_CATEGORY_INDEX,
} from "@/lib/venue-categories.server";
import {
  categoryLabelMap,
  categoryVenueLabel,
  categoryVenuePhrase,
  type VenueCategory,
} from "@/lib/venue-categories";

type Props = { params: Promise<{ category: string; city: string }> };

export const revalidate = 300;

/**
 * The occasion whose city pages are served by /wedding-halls/[city] instead.
 *
 * A constant with a name, not a bare string in an if: the next person to add a
 * legacy landing page needs to find this list, and the redirect below and the
 * sitemap's exclusion must agree about it.
 */
const LEGACY_CITY_ROUTE_CATEGORIES: Record<string, (citySlug: string) => string> = {
  wedding: (city) => `/wedding-halls/${city}`,
};

function describe(
  category: VenueCategory,
  city: string,
  venueCount: number,
  priceFrom: number | null,
  allLeadGeneration: boolean,
): string {
  const phrase = categoryVenuePhrase(category);
  if (venueCount === 0) {
    return (
      `Looking for ${phrase} in ${city}? Hallnect is adding ${city} venues for ` +
      `${category.pluralNoun} — browse every hall in ${city} meanwhile.`
    );
  }
  const price = priceFrom ? ` from ₹${Math.round(priceFrom).toLocaleString("en-IN")} per day` : "";
  const noun = venueCount === 1 ? "venue" : "venues";
  return (
    `Compare ${venueCount} ${noun} for ${category.pluralNoun} in ${city}${price} — photos, ` +
    `capacity and amenities. ` +
    (allLeadGeneration
      ? `Send an enquiry and the venue will confirm your date.`
      : `Check availability and book your date online.`)
  );
}

function allLead(halls: { booking_mode: string }[]): boolean {
  return halls.length > 0 && halls.every((h) => isLeadGeneration(h.booking_mode));
}

/**
 * Resolves both segments, or null.
 *
 * Shared by generateMetadata and the page so the two cannot disagree about
 * which combinations exist — the failure mode being a page that renders while
 * its metadata says "Not found", or the reverse.
 */
async function resolve(categorySlug: string, city: string) {
  const [category, cityName] = await Promise.all([
    fetchVenueCategoryBySlug(categorySlug),
    Promise.resolve(cityFromSlug(city)),
  ]);
  if (!category || !cityName) return null;
  return { category, city: cityName };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category: slug, city: cityParam } = await params;
  if (LEGACY_CITY_ROUTE_CATEGORIES[slug]) {
    // The page redirects; metadata for a URL nobody should land on stays out
    // of the index either way.
    return { title: "Redirecting…", robots: { index: false, follow: false } };
  }

  const resolved = await resolve(slug, cityParam);
  if (!resolved) return { title: "Not found", robots: { index: false, follow: false } };
  const { category, city } = resolved;

  const inventory = await fetchCategoryInventoryStrict();
  const venueCount = inventory.get(slug)?.byCity.get(city) ?? 0;
  const halls = venueCount ? await fetchHalls({ category: slug, city, sort: "rating" }) : [];

  const priced = halls.map((h) => h.price_per_day).filter(hasPrice);
  const priceFrom = priced.length ? Math.min(...priced) : null;

  return buildMetadata({
    title: `${categoryVenueLabel(category)} in ${city}`,
    description: describe(category, city, venueCount, priceFrom, allLead(halls)),
    path: `/venues/${slug}/${citySlug(city)}`,
    indexable: venueCount >= MIN_VENUES_FOR_CATEGORY_INDEX,
  });
}

export default async function CategoryCityPage({ params }: Props) {
  const { category: slug, city: cityParam } = await params;

  // Before anything else: hand weddings back to the page that already owns
  // that query. 308, so the signal transfers rather than being re-earned.
  const legacy = LEGACY_CITY_ROUTE_CATEGORIES[slug];
  if (legacy) permanentRedirect(legacy(cityParam));

  const resolved = await resolve(slug, cityParam);
  if (!resolved) notFound();
  const { category, city } = resolved;

  const [advancePercent, halls, catalogue] = await Promise.all([
    getAdvancePercent(),
    fetchHalls({ category: slug, city, sort: "rating" }),
    fetchVenueCategories(),
  ]);

  const priced = halls.map((h) => h.price_per_day).filter(hasPrice);
  const priceFrom = priced.length ? Math.min(...priced) : null;
  const description = describe(category, city, halls.length, priceFrom, allLead(halls));
  const categoryLabels = categoryLabelMap(catalogue);

  return (
    <div className="min-h-screen bg-ivory-100">
      <JsonLd
        data={jsonLdGraph(
          categoryCollectionJsonLd({
            categoryName: category.name,
            city,
            path: `/venues/${slug}/${citySlug(city)}`,
            description,
            venues: halls.map((h) => ({ name: h.name, slug: h.slug })),
          }),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: categoryVenueLabel(category), path: `/venues/${slug}` },
            { name: city, path: `/venues/${slug}/${citySlug(city)}` },
          ]),
        )}
      />

      <AppHeader title={`${category.name} · ${city}`} />

      <nav aria-label="Breadcrumb" className="container-app pt-3 lg:max-w-7xl">
        <ol className="flex flex-wrap items-center gap-1 text-[11px] text-charcoal-500">
          <li><Link href="/" className="hover:text-maroon-700">Home</Link></li>
          <li aria-hidden>/</li>
          <li>
            <Link href={`/venues/${slug}`} className="hover:text-maroon-700">
              {categoryVenueLabel(category)}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li className="font-medium text-charcoal-700">{city}</li>
        </ol>
      </nav>

      <header className="container-app pt-4 lg:max-w-7xl">
        <h1 className="font-serif text-2xl font-bold text-charcoal-900 lg:text-3xl">
          {categoryVenueLabel(category)} in {city}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-charcoal-600">{description}</p>
      </header>

      <main className="container-app py-6 lg:max-w-7xl">
        {halls.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title={`No ${categoryVenuePhrase(category)} in ${city} yet`}
            description={
              `No ${city} venue has said it hosts ${category.pluralNoun} so far. ` +
              `Two things worth trying instead:`
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link
                  href={`/halls?city=${encodeURIComponent(city)}`}
                  className="inline-flex min-h-[44px] items-center rounded-full bg-maroon-600 px-5 text-sm font-semibold text-white"
                >
                  All venues in {city}
                </Link>
                <Link
                  href={`/venues/${slug}`}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-white px-5 text-sm font-semibold text-charcoal-800"
                >
                  {categoryVenueLabel(category)} elsewhere
                </Link>
              </div>
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {halls.map((hall, i) => (
              <li key={hall.id}>
                <HallCard
                  hall={hall}
                  advancePercent={advancePercent}
                  revealIndex={i}
                  revealNow={i < 3}
                  eager={i < 3}
                  categoryLabels={categoryLabels}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
