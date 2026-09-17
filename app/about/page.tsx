// ─────────────────────────────────────────────────────────────────────────────
// app/about/page.tsx — who operates Hallnect, and how it actually works.
//
// EVERY FACT ON THIS PAGE COMES FROM THE REPO. The legal entity, LLPIN, GSTIN,
// registered address, phone, email and support hours are the CONTACT and
// SUPPORT_HOURS constants that the contact page and the JSON-LD already read,
// so this page cannot drift from them. The service areas come from
// SERVICE_AREA_CITIES, and the city links are gated on live inventory — a city
// is linked here on the same condition that makes its landing page indexable.
//
// WHAT IS DELIBERATELY NOT HERE: a founding story, a team, a customer count, a
// "trusted by" line, or any claim that Hallnect vets venues. Terms section 5
// says plainly that Hallnect does not independently verify every listing
// detail, so an About page cannot imply otherwise — see the note on
// APP_DESCRIPTION in lib/constants.ts, where "verified" was removed for exactly
// this reason. An About page is where a business is most tempted to invent
// itself; there is enough true material here without it.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { Building2, MapPin, Phone, Mail, Clock, Scale } from "lucide-react";
import { buildMetadata } from "@/lib/seo/metadata";
import { JsonLd } from "@/components/seo/JsonLd";
import { jsonLdGraph, organizationJsonLd, breadcrumbJsonLd } from "@/lib/seo/jsonld";
import { fetchCityInventory } from "@/lib/seo/cities";
import { CONTACT, SUPPORT_HOURS, APP_NAME } from "@/lib/constants";
import { SERVICE_AREA_CITIES } from "@/lib/seo/service-areas";

export const metadata: Metadata = buildMetadata({
  // "About Us", not "About Hallnect": buildMetadata's template appends
  // " | Hallnect", so the latter renders "About Hallnect | Hallnect" — the
  // exact duplication this pass removed from two other pages. Caught by
  // lib/__tests__/seo-invariants.test.ts on the page I had just written.
  title: "About Us",
  description:
    "Hallnect is a wedding hall marketplace for Tamil Nadu, operated by HALLNECT LLP " +
    "from Madurai. How listings, enquiries and bookings work, and what we charge.",
  path: "/about",
});

// Same cache posture as the other public pages: nothing here is per-visitor,
// and the only live value is which cities currently hold inventory.
export const revalidate = 3600;

export default async function AboutPage() {
  const cityInventory = await fetchCityInventory();
  const citiesWithVenues = cityInventory.filter((c) => c.venueCount > 0);

  return (
    <div className="min-h-screen bg-ivory-100">
      <JsonLd
        data={jsonLdGraph(
          organizationJsonLd(),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "About", path: "/about" },
          ]),
        )}
      />

      <nav aria-label="Breadcrumb" className="border-b border-border bg-white">
        <ol className="container-page flex items-center gap-1.5 py-4 text-xs text-muted-foreground">
          <li><Link href="/" className="hover:text-maroon-600">Home</Link></li>
          <li aria-hidden="true">/</li>
          <li className="text-charcoal-700" aria-current="page">About</li>
        </ol>
      </nav>

      <div className="container-page max-w-3xl py-12">
        <h1 className="font-serif text-3xl font-bold text-charcoal-900 sm:text-4xl">
          About {APP_NAME}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-charcoal-700">
          {APP_NAME} is a marketplace for wedding halls, marriage halls and event
          venues in Tamil Nadu. Venue owners list their own halls with their own
          photos, capacity and pricing; couples search, compare and get in touch.
          We are not a venue and we do not run events — we connect the two sides
          and handle the paperwork in between.
        </p>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <h2 className="mt-10 font-serif text-xl font-semibold text-charcoal-900">
          How a booking works
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-charcoal-700">
          Venues choose one of two ways to take business, and every listing says
          which one it uses.
        </p>
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-border bg-white p-5">
            <h3 className="font-serif text-base font-semibold text-charcoal-900">
              Book online
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-charcoal-600">
              The venue publishes a day rate and an availability calendar. You
              pick a date and slot and pay an advance plus a platform fee through
              Cashfree; the balance is settled directly with the venue. The
              booking is confirmed once the owner accepts it. Refund rules are in
              our{" "}
              <Link href="/refund-policy" className="font-medium text-maroon-600 hover:underline">
                refund policy
              </Link>
              .
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-5">
            <h3 className="font-serif text-base font-semibold text-charcoal-900">
              Send an enquiry
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-charcoal-600">
              The venue prefers to agree terms directly. You send a free enquiry
              and verify your mobile number with a one-time password, and the
              venue contacts you to confirm the date and the price. Hallnect
              takes no payment from you for these venues.
            </p>
          </div>
        </div>

        {/* ── Charges ──────────────────────────────────────────────────── */}
        <h2 className="mt-10 font-serif text-xl font-semibold text-charcoal-900">
          What Hallnect charges
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-charcoal-700">
          On an online booking you pay the venue&apos;s advance plus a platform
          fee, shown in full before you pay and capped at a quarter of the
          advance on a small booking. On an enquiry you pay us nothing. Listing
          a venue is free — the paid{" "}
          <Link href="/premium" className="font-medium text-maroon-600 hover:underline">
            premium plans
          </Link>{" "}
          affect placement only, never whether a venue can be listed.
        </p>

        {/* ── Where ────────────────────────────────────────────────────── */}
        <h2 className="mt-10 font-serif text-xl font-semibold text-charcoal-900">
          Where we operate
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-charcoal-700">
          Hallnect serves {SERVICE_AREA_CITIES.length} cities and towns across
          Tamil Nadu, including {SERVICE_AREA_CITIES.slice(0, 6).join(", ")} and
          others.
          {citiesWithVenues.length > 0
            ? " Cities with venues listed today:"
            : " Venues are being added city by city."}
        </p>
        {citiesWithVenues.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {citiesWithVenues.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/wedding-halls/${c.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-charcoal-700 transition-colors hover:border-maroon-300 hover:text-maroon-700"
                >
                  {c.city}
                  <span className="text-charcoal-400">{c.venueCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* ── The entity ───────────────────────────────────────────────── */}
        <h2 className="mt-10 font-serif text-xl font-semibold text-charcoal-900">
          Who operates Hallnect
        </h2>
        <dl className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white text-sm">
          <Row icon={<Building2 className="h-4 w-4" />} label="Legal entity" value={CONTACT.legalName} />
          <Row icon={<Scale className="h-4 w-4" />} label="LLPIN" value={CONTACT.llpin} />
          <Row icon={<Scale className="h-4 w-4" />} label="GSTIN" value={CONTACT.gstin} />
          <Row icon={<MapPin className="h-4 w-4" />} label="Registered office" value={CONTACT.address} />
          <Row icon={<Phone className="h-4 w-4" />} label="Phone" value={CONTACT.phone} href={CONTACT.phoneHref} />
          <Row icon={<Mail className="h-4 w-4" />} label="Email" value={CONTACT.email} href={`mailto:${CONTACT.email}`} />
          <Row icon={<Clock className="h-4 w-4" />} label="Support hours" value={SUPPORT_HOURS.label} />
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Complaints are handled by our designated grievance officer under the
          Consumer Protection (E-Commerce) Rules, 2020 — see{" "}
          <Link href="/grievance-redressal" className="font-medium text-maroon-600 hover:underline">
            grievance redressal
          </Link>{" "}
          for the officer&apos;s details and response times.
        </p>

        {/* ── Onward links ─────────────────────────────────────────────── */}
        <div className="mt-10 flex flex-wrap gap-3 border-t border-border pt-6">
          <Link href="/halls" className="text-sm font-semibold text-maroon-600 hover:underline">
            Browse venues →
          </Link>
          <Link href="/owner/register" className="text-sm font-semibold text-maroon-600 hover:underline">
            List your venue →
          </Link>
          <Link href="/contact" className="text-sm font-semibold text-maroon-600 hover:underline">
            Contact us →
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({
  icon, label, value, href,
}: {
  icon: React.ReactNode; label: string; value: string; href?: string;
}) {
  return (
    <div className="flex items-start gap-3 px-5 py-3.5">
      <span className="mt-0.5 shrink-0 text-maroon-500" aria-hidden>{icon}</span>
      <dt className="w-32 shrink-0 text-xs font-semibold uppercase tracking-wide text-charcoal-500">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 break-words text-charcoal-800">
        {href ? (
          <a href={href} className="hover:text-maroon-600 hover:underline">{value}</a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
