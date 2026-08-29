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
import { getAdvancePercent } from "@/lib/platform-settings";
import { HallCard } from "@/app/halls/_components/HallCard";
import { AppHeader } from "@/components/app/AppHeader";
import { buildMetadata } from "@/lib/seo/metadata";
import { JsonLd } from "@/components/seo/JsonLd";
import { jsonLdGraph, breadcrumbJsonLd, cityCollectionJsonLd, faqJsonLd } from "@/lib/seo/jsonld";
import { cityFromSlug, fetchCityInventoryBySlug, citySlug } from "@/lib/seo/cities";

type Props = { params: Promise<{ city: string }> };

/** Description written from the city's REAL inventory, so no two are alike. */
function describeCity(city: string, venueCount: number, priceFrom: number | null): string {
  if (venueCount === 0) {
    return (
      `Looking for a wedding hall in ${city}? Hallnect is adding verified ${city} venues — ` +
      `browse halls across Tamil Nadu meanwhile, or list your ${city} venue with us.`
    );
  }
  const price = priceFrom ? ` from ₹${Math.round(priceFrom).toLocaleString("en-IN")} per day` : "";
  const noun = venueCount === 1 ? "venue" : "venues";
  return (
    `Compare ${venueCount} verified wedding ${noun} in ${city}${price} — real photos, ` +
    `guest capacity, amenities and live availability. Book your date online with Hallnect.`
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: slug } = await params;
  const city = cityFromSlug(slug);
  if (!city) return { title: "City not found", robots: { index: false, follow: false } };

  const inventory = await fetchCityInventoryBySlug(slug);
  const halls = inventory?.venueCount ? await fetchHalls({ city, sort: "rating" }) : [];
  const priceFrom = halls.length ? Math.min(...halls.map((h) => h.price_per_day)) : null;

  return buildMetadata({
    title: `Wedding Halls in ${city} | Marriage Halls & Venues`,
    description: describeCity(city, inventory?.venueCount ?? 0, priceFrom),
    path: `/wedding-halls/${citySlug(city)}`,
    // The gate: no inventory, no index.
    indexable: Boolean(inventory?.indexable),
  });
}

export default async function CityPage({ params }: Props) {
  const { city: slug } = await params;
  const city = cityFromSlug(slug);

  // An unknown city is a genuine 404, not an empty page pretending to be one.
  if (!city) notFound();

  const advancePercent = await getAdvancePercent();
  const halls = await fetchHalls({ city, sort: "rating" });
  const priceFrom = halls.length ? Math.min(...halls.map((h) => h.price_per_day)) : null;
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
      a: `Yes. Choose your date and slot, then pay the 25% advance plus a flat ₹200 platform fee through Cashfree, or ₹0 if you have a promotional code. The booking is confirmed once the venue owner accepts it, and the balance is paid directly to the venue.`,
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
              <dd>{halls.length} verified {halls.length === 1 ? "venue" : "venues"}</dd>
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
              verified hall across Tamil Nadu, or list your own venue.
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
