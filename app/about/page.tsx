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
import { DIRECT_BOOKING_ENABLED } from "@/lib/booking-switch";
import { platformFeeDisclosure } from "@/lib/booking-payment";

// HOW BOOKING WORKS, IN TWO VERSIONS chosen by the booking switch, like the
// homepage. With online booking on (0114) a hall either takes an advance online
// or works on quotes; with it off every hall works on quotes. The off version
// said "Hallnect takes no payment from you", which is false the moment a
// family can pay an advance here.
const HOW_TO_BOOK = DIRECT_BOOKING_ENABLED
  ? {
      intro: "Some halls on Hallnect take an online advance to hold your date. The rest work on quotes, and your phone number stays with us until you choose one.",
      steps: [
        ["Book online, where a hall offers it", "Pick your date and pay the advance through Cashfree. The booking is confirmed once the hall accepts it, and you pay the balance to the hall."],
        ["Or ask for a quote", "Tell the hall your date, the occasion and how many guests. You verify your mobile number with a one-time password, but the hall does not see it."],
        ["Accept the quote you want", "The hall replies on Hallnect with its price for your date. Only if you accept does it get your number, to call you and agree the booking — and you pay that hall directly."],
      ],
      charges: `On an online booking you pay the hall's advance plus a ${platformFeeDisclosure()}, shown before you pay. Asking a hall for a quote is free. A venue pays a small commission on a booking made through Hallnect.`,
    }
  : {
      intro: "Every venue on Hallnect works on quotes, and your phone number stays with us until you choose a venue.",
      steps: [
        ["Ask for a quote", "Tell the venue your date, the occasion and how many guests. You verify your mobile number with a one-time password, but the venue does not see it."],
        ["Compare the replies", "The venue answers on Hallnect with its price for your date, what is included, the advance it asks for and how long the offer stands."],
        ["Accept the one you want", "Only then does that venue get your number, to call you and agree the booking. You pay the venue directly — Hallnect takes no payment from you."],
      ],
      charges: "Families pay Hallnect nothing. A venue pays a small commission only on a booking it confirms through Hallnect.",
    };

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
          How booking a venue works
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-charcoal-700">
          {HOW_TO_BOOK.intro}
        </p>
        <ol className="mt-4 space-y-4">
          {HOW_TO_BOOK.steps.map(([title, text], i) => (
            <li key={title} className="rounded-2xl border border-border bg-white p-5">
              <h3 className="font-serif text-base font-semibold text-charcoal-900">
                {i + 1}. {title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-charcoal-600">{text}</p>
            </li>
          ))}
        </ol>

        {/* ── Charges ──────────────────────────────────────────────────── */}
        <h2 className="mt-10 font-serif text-xl font-semibold text-charcoal-900">
          What Hallnect charges
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-charcoal-700">
          {HOW_TO_BOOK.charges} Listing a venue is free — the
          paid{" "}
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
                  <span className="text-charcoal-600">{c.venueCount}</span>
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
