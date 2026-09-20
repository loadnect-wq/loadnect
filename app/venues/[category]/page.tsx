// ─────────────────────────────────────────────────────────────────────────────
// /venues/[category] — one landing page per occasion.
//
// WHY /venues/… AND NOT /halls/… . app/halls/[slug] is the VENUE page, so
// /halls/wedding would collide with any hall whose slug happened to be
// "wedding" — a real listing silently replaced by a category page, or the
// reverse, depending on Next's route ranking. A separate namespace costs one
// path segment and removes the possibility.
//
// WHY /wedding-halls/[city] IS UNTOUCHED. It is the only set of pages on this
// site that currently ranks. Nothing here changes it, nothing redirects it, and
// /venues/wedding/[city] hands its traffic straight over to it rather than
// publishing a second page about the same venues — see that route.
//
// INDEXABILITY IS EARNED, exactly as it is for cities (lib/seo/cities.ts). A
// category page is indexable only when approved venues actually declare it.
// With 28 occasions and ~20 service areas the combination space is 560 URLs;
// publishing them all would be the doorway-page pattern that earns manual
// actions. Each page still RENDERS when empty — the occasion is real and a
// searcher arriving on it should not get a 404 — it is simply noindex and
// absent from the sitemap until a venue declares it, at which point it flips on
// its own with no deploy.
// ─────────────────────────────────────────────────────────────────────────────

import { notFound } from "next/navigation";
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
import { citySlug } from "@/lib/seo/cities";
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

type Props = { params: Promise<{ category: string }> };

/**
 * Five minutes, matching /wedding-halls/[city]: a newly approved venue should
 * appear here without anyone clearing anything, and the admin actions that
 * change the catalogue call revalidatePath as the usual case.
 */
export const revalidate = 300;

/**
 * Prerender the occasions that HAVE inventory; everything else renders on
 * demand (dynamicParams defaults to true).
 *
 * LENIENT. This runs at build time, and a build must not fail because Sydney
 * was slow — an empty list here means every page is rendered on request, which
 * is correct behaviour rather than an outage.
 */
export async function generateStaticParams() {
  const [categories, inventory] = await Promise.all([
    fetchVenueCategories(),
    fetchCategoryInventoryStrict().catch(() => new Map()),
  ]);
  return categories
    .filter((c) => (inventory.get(c.slug)?.venueCount ?? 0) > 0)
    .map((c) => ({ category: c.slug }));
}

/**
 * The description, written from this occasion's REAL inventory, so no two are
 * alike and none of them claims anything the database cannot back.
 *
 * NOT "verified", for the same reason lib/seo/cities.ts refuses the word: Terms
 * section 5 says Hallnect displays venue information as provided by owners and
 * does not independently verify every listing detail.
 */
function describeCategory(
  category: VenueCategory,
  venueCount: number,
  priceFrom: number | null,
  allLeadGeneration: boolean,
): string {
  const phrase = categoryVenuePhrase(category);
  if (venueCount === 0) {
    return (
      `Looking for ${phrase} in Tamil Nadu? Hallnect is adding venues for ${category.pluralNoun} — ` +
      `browse every hall listed meanwhile, or list your venue with us.`
    );
  }
  const price = priceFrom ? ` from ₹${Math.round(priceFrom).toLocaleString("en-IN")} per day` : "";
  const noun = venueCount === 1 ? "venue" : "venues";
  return (
    `Compare ${venueCount} ${noun} for ${category.pluralNoun} in Tamil Nadu${price} — photos, ` +
    `capacity and amenities. ` +
    (allLeadGeneration
      ? `Send an enquiry and the venue will confirm your date.`
      : `Check availability and book your date online.`)
  );
}

/** True only when EVERY listed venue takes enquiries — [] is false, not true. */
function allLead(halls: { booking_mode: string }[]): boolean {
  return halls.length > 0 && halls.every((h) => isLeadGeneration(h.booking_mode));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category: slug } = await params;
  const category = await fetchVenueCategoryBySlug(slug);
  if (!category) return { title: "Not found", robots: { index: false, follow: false } };

  const inventory = await fetchCategoryInventoryStrict();
  const venueCount = inventory.get(slug)?.venueCount ?? 0;
  const halls = venueCount ? await fetchHalls({ category: slug, sort: "rating" }) : [];

  // PRICED VENUES ONLY. Math.min over a list containing null yields 0, so one
  // "Contact for pricing" venue would advertise the whole occasion as
  // "from ₹0" — in the title, the meta description and the search snippet.
  const priced = halls.map((h) => h.price_per_day).filter(hasPrice);
  const priceFrom = priced.length ? Math.min(...priced) : null;

  return buildMetadata({
    title: `${categoryVenueLabel(category)} in Tamil Nadu`,
    description: describeCategory(category, venueCount, priceFrom, allLead(halls)),
    path: `/venues/${slug}`,
    indexable: venueCount >= MIN_VENUES_FOR_CATEGORY_INDEX,
  });
}

export default async function CategoryPage({ params }: Props) {
  const { category: slug } = await params;

  // An unknown OR DEACTIVATED occasion is a genuine 404. Deactivated matters:
  // fetchVenueCategoryBySlug reads only the active rows, so retiring a category
  // takes its page down rather than leaving a live URL nobody maintains.
  const category = await fetchVenueCategoryBySlug(slug);
  if (!category) notFound();

  const [advancePercent, halls, catalogue, inventory] = await Promise.all([
    getAdvancePercent(),
    fetchHalls({ category: slug, sort: "rating" }),
    fetchVenueCategories(),
    fetchCategoryInventoryStrict(),
  ]);

  const priced = halls.map((h) => h.price_per_day).filter(hasPrice);
  const priceFrom = priced.length ? Math.min(...priced) : null;
  const description = describeCategory(category, halls.length, priceFrom, allLead(halls));

  const categoryLabels = categoryLabelMap(catalogue);

  // Cities where THIS occasion has inventory, most first. Only these get a
  // link, because only these have a page worth landing on.
  const cities = [...(inventory.get(slug)?.byCity ?? new Map())]
    .map(([city, count]) => ({ city, count, slug: citySlug(city) }))
    .filter((c) => c.count > 0 && c.slug)
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));

  // Sibling occasions that have inventory — how a visitor who landed on the
  // wrong one gets to the right one without going back to the home page.
  const siblings = catalogue
    .filter((c) => c.slug !== slug && (inventory.get(c.slug)?.venueCount ?? 0) > 0)
    .slice(0, 12);

  return (
    <div className="min-h-screen bg-ivory-100">
      <JsonLd
        data={jsonLdGraph(
          categoryCollectionJsonLd({
            categoryName: category.name,
            path: `/venues/${slug}`,
            description,
            venues: halls.map((h) => ({ name: h.name, slug: h.slug })),
          }),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Venues", path: "/halls" },
            { name: categoryVenueLabel(category), path: `/venues/${slug}` },
          ]),
        )}
      />

      <AppHeader title={category.name} />

      {/* Visible breadcrumb — mirrors the BreadcrumbList above exactly. */}
      <nav aria-label="Breadcrumb" className="container-app pt-3 lg:max-w-7xl">
        <ol className="flex flex-wrap items-center gap-1 text-[11px] text-charcoal-500">
          <li><Link href="/" className="hover:text-maroon-700">Home</Link></li>
          <li aria-hidden>/</li>
          <li><Link href="/halls" className="hover:text-maroon-700">Venues</Link></li>
          <li aria-hidden>/</li>
          <li className="font-medium text-charcoal-700">{categoryVenueLabel(category)}</li>
        </ol>
      </nav>

      <header className="container-app pt-4 lg:max-w-7xl">
        <h1 className="font-serif text-2xl font-bold text-charcoal-900 lg:text-3xl">
          {categoryVenueLabel(category)} in Tamil Nadu
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-charcoal-600">{description}</p>
        {category.description && (
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-charcoal-500">
            {category.description}
          </p>
        )}
      </header>

      <main className="container-app py-6 lg:max-w-7xl">
        {halls.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title={`No ${categoryVenuePhrase(category)} listed yet`}
            description={
              `No venue on Hallnect has said it hosts ${category.pluralNoun} so far. ` +
              `Browse every listed hall instead — many suit more than one occasion.`
            }
            action={
              <Link
                href="/halls"
                className="inline-flex min-h-[44px] items-center rounded-full bg-maroon-600 px-5 text-sm font-semibold text-white"
              >
                Browse all venues
              </Link>
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

        {/* ── This occasion, city by city ──────────────────────────────── */}
        {cities.length > 0 && (
          <section className="mt-10">
            <h2 className="font-serif text-lg font-bold text-charcoal-900">
              {categoryVenueLabel(category)} by city
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {cities.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/venues/${slug}/${c.slug}`}
                    className="inline-block rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-charcoal-700 transition hover:border-maroon-300 hover:text-maroon-700"
                  >
                    {category.name} halls in {c.city}
                    <span className="ml-1 text-charcoal-400">({c.count})</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Other occasions ──────────────────────────────────────────── */}
        {siblings.length > 0 && (
          <section className="mt-8">
            <h2 className="font-serif text-lg font-bold text-charcoal-900">Other occasions</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {siblings.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/venues/${c.slug}`}
                    className="inline-block rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-charcoal-700 transition hover:border-maroon-300 hover:text-maroon-700"
                  >
                    {categoryVenueLabel(c)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
