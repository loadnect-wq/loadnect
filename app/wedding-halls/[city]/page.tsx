// ─────────────────────────────────────────────────────────────────────────────
// /wedding-halls/[city] — the city landing pages.
//
// INDEXABILITY IS EARNED, NOT ASSUMED. A city page is indexable only when it
// actually lists approved venues (lib/seo/cities.ts). A city Hallnect serves
// but has no inventory in yet still renders — people search for it and the
// guidance is real — but it is marked noindex and stays out of the sitemap
// until a venue is approved there, at which point it flips automatically.
//
// This is the difference between a city page and a doorway page, and it is why
// this route does NOT pre-generate a page for every city name it can think of.
// ─────────────────────────────────────────────────────────────────────────────

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { Building2, MapPin, Users, Wallet } from "lucide-react";
import { fetchHalls } from "@/lib/halls";
import { hasPrice } from "@/lib/booking-mode";
import { getAdvancePercent } from "@/lib/platform-settings";
import { HallCard } from "@/app/halls/_components/HallCard";
import { AppHeader } from "@/components/app/AppHeader";
import { platformFeeDisclosure } from "@/lib/booking-payment";
import { buildMetadata } from "@/lib/seo/metadata";
import { JsonLd } from "@/components/seo/JsonLd";
import { jsonLdGraph, breadcrumbJsonLd, cityCollectionJsonLd, faqJsonLd } from "@/lib/seo/jsonld";
import { cityFromSlug, fetchCityInventoryBySlug, citySlug, SERVICE_AREA_CITIES } from "@/lib/seo/cities";

type Props = { params: Promise<{ city: string }> };

/**
 * Description written from the city's REAL inventory, so no two are alike.
 *
 * NOT "verified". This string is the city page's meta description as well as
 * its visible intro, and Terms section 5 states that Hallnect displays venue
 * information as provided by owners and does not independently verify every
 * listing detail. Advertising "verified venues" against that is a misleading
 * advertisement, and a city page is exactly where a searcher forms the
 * impression. Same reasoning as APP_DESCRIPTION in lib/constants.ts.
 */
function describeCity(city: string, venueCount: number, priceFrom: number | null): string {
  if (venueCount === 0) {
    return (
      `Looking for a wedding hall in ${city}? Hallnect is adding ${city} venues — ` +
      `browse halls across Tamil Nadu meanwhile, or list your ${city} venue with us.`
    );
  }
  const price = priceFrom ? ` from ₹${Math.round(priceFrom).toLocaleString("en-IN")} per day` : "";
  const noun = venueCount === 1 ? "venue" : "venues";
  return (
    `Compare ${venueCount} owner-listed wedding ${noun} in ${city}${price} — real photos, ` +
    `guest capacity, amenities and live availability. Book your date online with Hallnect.`
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: slug } = await params;
  const city = cityFromSlug(slug);
  if (!city) return { title: "City not found", robots: { index: false, follow: false } };

  const inventory = await fetchCityInventoryBySlug(slug);
  const halls = inventory?.venueCount ? await fetchHalls({ city, sort: "rating" }) : [];
  // PRICED VENUES ONLY. Math.min over a list containing null yields 0
  // (Math.min coerces null to 0), so one "Contact for pricing" venue in a city
  // would advertise that whole city as "wedding halls from Rs.0" — in the page
  // title, the meta description and the search snippet.
  const pricedFrom = halls.map((h) => h.price_per_day).filter(hasPrice);
  const priceFrom = pricedFrom.length ? Math.min(...pricedFrom) : null;

  return buildMetadata({
    title: `Wedding Halls in ${city} | Marriage Halls & Venues`,
    description: describeCity(city, inventory?.venueCount ?? 0, priceFrom),
    path: `/wedding-halls/${citySlug(city)}`,
    // The gate: no inventory, no index.
    indexable: Boolean(inventory?.indexable),
  });
}

/**
 * CACHED, AND THAT IS THE WHOLE POINT.
 *
 * Every public page on this site used to be served
 * `Cache-Control: private, no-cache, no-store` with `X-Vercel-Cache: MISS`,
 * so each visitor paid for a full function invocation and a fresh round of
 * queries to a database on another continent — to be shown exactly the same
 * approved venues as the visitor before them. Nothing on this page differs per
 * person: the header resolves the signed-in user in the browser, and saved
 * halls live in the browser too.
 *
 * The only reason it was dynamic is that the catalogue queries happened to go
 * through the cookie-reading Supabase client. They now use the cookie-free one
 * (lib/supabase/public.ts), so this render can be reused.
 *
 * Five minutes, not longer: a newly approved venue should appear without anyone
 * clearing anything. Admin actions that change what belongs here also call
 * revalidatePath, so the usual case is immediate and this is the backstop.
 */
export const revalidate = 300;

/**
 * PRERENDERED, one page per service area.
 *
 * Without this a dynamic segment cannot be prerendered at all: Next has no list
 * of paths to build, so every /wedding-halls/<city> was rendered per request
 * and served no-store, even with `revalidate` set. These are SEO landing pages
 * whose whole job is to be fast for a stranger arriving from Google, and the
 * set is a fixed, small list we control — so there is nothing to discover at
 * runtime.
 *
 * cityFromSlug still validates on the way in, so a slug outside this list is a
 * genuine 404 rather than an empty page pretending to be one.
 */
export function generateStaticParams() {
  return SERVICE_AREA_CITIES.map((city) => ({ city: citySlug(city) }));
}


export default async function CityPage({ params }: Props) {
  const { city: slug } = await params;
  const city = cityFromSlug(slug);

  // An unknown city is a genuine 404, not an empty page pretending to be one.
  if (!city) notFound();

  const [advancePercent, halls] = await Promise.all([
    getAdvancePercent(),
    fetchHalls({ city, sort: "rating" }),
  ]);
  // PRICED VENUES ONLY. Math.min over a list containing null yields 0
  // (Math.min coerces null to 0), so one "Contact for pricing" venue in a city
  // would advertise that whole city as "wedding halls from Rs.0" — in the page
  // title, the meta description and the search snippet.
  const pricedFrom = halls.map((h) => h.price_per_day).filter(hasPrice);
  const priceFrom = pricedFrom.length ? Math.min(...pricedFrom) : null;
  const largest = halls.length ? Math.max(...halls.map((h) => h.capacity_max)) : null;
  const description = describeCity(city, halls.length, priceFrom);

  // FAQs answered from THIS city's real numbers, and rendered visibly below —
  // which is what makes the FAQPage markup legitimate.
  const faqs = [
    {
      q: `How much does a wedding hall in ${city} cost?`,
      a: priceFrom
        ? `Wedding halls listed in ${city} on Hallnect start from ₹${Math.round(priceFrom).toLocaleString("en-IN")} per day. ` +
          `The exact price depends on the date, the slot you choose and the venue's own tariff, and is shown on each listing.`
        : `Pricing varies by venue, date and slot. Each Hallnect listing shows the venue's day rate and the advance payable before you book.`,
    },
    {
      q: `How do I check whether a ${city} hall is free on my date?`,
      a: `Open any venue and its availability calendar shows the next 30 days, marked by morning, evening and full-day slots. Availability is re-checked on the server when you book, so two people cannot hold the same date.`,
    },
    {
      q: `Can I book a wedding hall in ${city} online?`,
      // advancePercent, not a literal 25. The advance is an admin setting
      // (platform_settings) that checkout reads live, and this page already
      // fetches it above — the hardcoded "25%" quoted a figure the customer
      // would not actually be asked for the moment an admin changed it, on the
      // one page Google shows for "book wedding hall in <city>".
      a: `Yes. Choose your date and slot, then pay the ${advancePercent}% advance plus a ${platformFeeDisclosure()} through Cashfree — or ₹0 with a promotional code. On a small booking the fee is capped at a quarter of the advance. The booking is confirmed once the venue owner accepts it, and the balance is paid directly to the venue.`,
    },
    ...(largest
      ? [{
          q: `What is the largest wedding hall in ${city} on Hallnect?`,
          a: `The largest ${city} venue currently listed seats up to ${largest.toLocaleString("en-IN")} guests. Each listing states its maximum capacity so you can shortlist by guest count.`,
        }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-ivory-100">
      <JsonLd
        data={jsonLdGraph(
          cityCollectionJsonLd({
            city,
            path: `/wedding-halls/${citySlug(city)}`,
            description,
            venues: halls.map((h) => ({ name: h.name, slug: h.slug })),
          }),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Tamil Nadu", path: "/halls" },
            { name: city, path: `/wedding-halls/${citySlug(city)}` },
          ]),
          faqJsonLd(faqs),
        )}
      />

      <AppHeader title={city} />

      {/* Visible breadcrumb — mirrors the BreadcrumbList above exactly. */}
      <nav aria-label="Breadcrumb" className="container-app pt-3 lg:max-w-7xl">
        <ol className="flex flex-wrap items-center gap-1 text-[11px] text-charcoal-500">
          <li><Link href="/" className="hover:text-maroon-700">Home</Link></li>
          <li aria-hidden="true">/</li>
          <li><Link href="/halls" className="hover:text-maroon-700">Tamil Nadu</Link></li>
          <li aria-hidden="true">/</li>
          <li className="font-medium text-charcoal-700" aria-current="page">{city}</li>
        </ol>
      </nav>

      <header className="container-app pt-3 lg:max-w-7xl">
        <h1 className="font-serif text-xl font-bold text-charcoal-900 lg:text-3xl">
          Wedding Halls in {city}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-charcoal-600">{description}</p>

        {halls.length > 0 && (
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-charcoal-600">
            <div className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-maroon-500" />
              <dt className="sr-only">Venues listed</dt>
              <dd>{halls.length} {halls.length === 1 ? "venue" : "venues"} listed</dd>
            </div>
            {priceFrom != null && (
              <div className="flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5 text-maroon-500" />
                <dt className="sr-only">Starting price</dt>
                <dd>From ₹{Math.round(priceFrom).toLocaleString("en-IN")} per day</dd>
              </div>
            )}
            {largest != null && (
              <div className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-maroon-500" />
                <dt className="sr-only">Largest capacity</dt>
                <dd>Up to {largest.toLocaleString("en-IN")} guests</dd>
              </div>
            )}
          </dl>
        )}
      </header>

      <section className="container-app py-5 lg:max-w-7xl">
        {halls.length > 0 ? (
          <>
            <h2 className="sr-only">Venues in {city}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {halls.map((hall) => (
                <HallCard key={hall.id} hall={hall} advancePercent={advancePercent} />
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-border bg-white p-6 text-center">
            <MapPin className="mx-auto h-8 w-8 text-charcoal-300" />
            <h2 className="mt-3 font-serif text-base font-bold text-charcoal-900">
              No {city} venues listed yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-charcoal-600">
              Hallnect is onboarding venues in {city}. In the meantime you can browse every
              hall listed across Tamil Nadu, or list your own venue.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link
                href="/halls"
                className="rounded-xl bg-maroon-700 px-4 py-2 text-xs font-semibold text-white hover:bg-maroon-800"
              >
                Browse all wedding halls
              </Link>
              <Link
                href="/owner/register"
                className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-charcoal-700 hover:border-maroon-300"
              >
                List your {city} venue
              </Link>
            </div>
          </div>
        )}
      </section>

      {/* FAQ — the visible answers behind the FAQPage markup above. */}
      <section className="container-app border-t border-border py-8 lg:max-w-7xl">
        <h2 className="font-serif text-lg font-bold text-charcoal-900">
          Booking a wedding hall in {city}
        </h2>
        <dl className="mt-3 max-w-3xl space-y-4">
          {faqs.map((f) => (
            <div key={f.q}>
              <dt className="text-sm font-semibold text-charcoal-900">{f.q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-charcoal-600">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
