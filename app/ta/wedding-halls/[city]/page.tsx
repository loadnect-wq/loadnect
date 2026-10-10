// ─────────────────────────────────────────────────────────────────────────────
// /ta/wedding-halls/[city] — the Tamil twin of /wedding-halls/[city].
//
// SAME FACTS, SAME GATE, DIFFERENT LANGUAGE. Every number on this page comes
// from the queries the English page runs, and indexability is decided by the
// same inventory gate (lib/seo/cities.ts) — so the Tamil page is indexable
// exactly when its English twin is, and the pair name each other with
// hreflang. A city with no live venue renders, says so in Tamil, and stays out
// of the index, like its English page.
//
// DATE FIRST. The first thing under the heading is "when is your function?",
// with the next muhurtham days one tap away (lib/muhurtham.ts). The search is
// a plain GET form to /halls, so it works before any JavaScript loads.
//
// EVERY ANSWER FOLLOWS THE BOOKING MODE. The English page learned the hard way
// that a city of enquiry-only venues must not promise a checkout; the Tamil
// FAQ branches on the same `allLead` fact for the same reason.
//
// LANGUAGE. The root layout's <html> is en-IN, so this page's wrapper carries
// lang="ta". Inter stays first in the font stack so hall names and numbers
// match the rest of the site; Tamil letters fall through to Noto Sans Tamil.
// Headings deliberately skip the serif face, which has no Tamil glyphs.
//
// Have a native copywriter review the Tamil before promoting this page.
// ─────────────────────────────────────────────────────────────────────────────

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notoSansTamil } from "@/app/fonts/noto-sans-tamil/font";
import { Building2, CalendarDays, Clock, Languages, MapPin, PhoneOff, Search, Star, Tag, UserCheck, Users, Wallet } from "lucide-react";
import { fetchHalls, type HallListing } from "@/lib/halls";
import { hasPrice, isLeadGeneration } from "@/lib/booking-mode";
import { getAdvancePercent } from "@/lib/platform-settings";
import { todayInBusinessTz } from "@/lib/dates";
import { nextMuhurthamDates } from "@/lib/muhurtham";
import {
  PLATFORM_FEE_GST_PERCENT,
  PLATFORM_FEE_RUPEES,
  PLATFORM_FEE_TOTAL_RUPEES,
} from "@/lib/booking-payment";
import { AppHeader } from "@/components/app/AppHeader";
import { buildMetadata } from "@/lib/seo/metadata";
import { JsonLd } from "@/components/seo/JsonLd";
import { jsonLdGraph, breadcrumbJsonLd, cityCollectionJsonLd, faqJsonLd } from "@/lib/seo/jsonld";
import { cityFromSlug, citySlug, fetchCityInventoryBySlug, SERVICE_AREA_CITIES } from "@/lib/seo/cities";
import {
  cityLanguageAlternates,
  englishCityPath,
  formatRupees,
  formatTamilDate,
  tamilDate,
  tamilCityName,
  tamilCityPath,
} from "@/lib/seo/tamil";

// Self-hosted, never next/font/google — app/fonts/noto-sans-tamil/font.ts says
// why (a Google Fonts URL format broke a production build).
const tamilFont = notoSansTamil;

const FONT_STACK = "var(--font-inter), var(--font-tamil), system-ui, sans-serif";

type Props = { params: Promise<{ city: string }> };

/** Same rule as the English page: an EMPTY list is not "all enquiry-only". */
function allLead(halls: { booking_mode: string }[]): boolean {
  return halls.length > 0 && halls.every((h) => isLeadGeneration(h.booking_mode));
}

const hallNoun = (n: number) => (n === 1 ? "மண்டபம்" : "மண்டபங்கள்");

/**
 * The meta description and visible intro, from the city's real inventory.
 * "<city> நகரில்" rather than a case suffix on the name: Tamil locative
 * endings vary by city (மதுரையில், சேலத்தில், ஈரோட்டில்), and "நகரில்" reads
 * correctly after every one of them.
 */
function describeCity(taCity: string, venueCount: number, priceFrom: number | null, allLeadGeneration: boolean): string {
  if (venueCount === 0) {
    return (
      `Hallnect ${taCity} மண்டபங்களைச் சேர்த்து வருகிறது. அதுவரை தமிழ்நாடு முழுவதும் உள்ள ` +
      `மண்டபங்களைப் பாருங்கள், அல்லது உங்கள் மண்டபத்தை இலவசமாகப் பட்டியலிடுங்கள்.`
    );
  }
  const price = priceFrom ? `, நாள் ஒன்றுக்கு ${formatRupees(priceFrom)} முதல்` : "";
  return (
    `${taCity} நகரில் ${venueCount} திருமண ${hallNoun(venueCount)}${price}. ` +
    `புகைப்படங்கள், கொள்ளளவு, வசதிகளை ஒப்பிட்டு, ` +
    (allLeadGeneration
      ? `உங்கள் தேதிக்கு இலவசமாக விசாரியுங்கள்; மண்டபம் தேதியை உறுதி செய்யும்.`
      : `உங்கள் தேதியை ஆன்லைனில் முன்பதிவு செய்யுங்கள்.`)
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: slug } = await params;
  const city = cityFromSlug(slug);
  const taCity = city ? tamilCityName(city) : null;
  if (!city || !taCity) return { title: "City not found", robots: { index: false, follow: false } };

  const inventory = await fetchCityInventoryBySlug(slug);
  const halls = inventory?.venueCount ? await fetchHalls({ city, sort: "rating" }) : [];
  const pricedFrom = halls.map((h) => h.price_per_day).filter(hasPrice);
  const priceFrom = pricedFrom.length ? Math.min(...pricedFrom) : null;

  return buildMetadata({
    title: `${taCity} திருமண மண்டபங்கள் | விலை, வசதிகள்`,
    description: describeCity(taCity, inventory?.venueCount ?? 0, priceFrom, allLead(halls)),
    path: tamilCityPath(citySlug(city)),
    // The English page's gate, unchanged: no inventory, no index.
    indexable: Boolean(inventory?.indexable),
    languages: cityLanguageAlternates(citySlug(city)),
    locale: "ta_IN",
  });
}

/** Cached for the same reason as the English page; see its note. */
export const revalidate = 300;

/** One page per service-area city that has a Tamil name. */
export function generateStaticParams() {
  return SERVICE_AREA_CITIES.filter((c) => tamilCityName(c)).map((city) => ({ city: citySlug(city) }));
}

export default async function TamilCityPage({ params }: Props) {
  const { city: slug } = await params;
  const city = cityFromSlug(slug);
  const taCity = city ? tamilCityName(city) : null;
  if (!city || !taCity) notFound();

  const [advancePercent, halls, inventory] = await Promise.all([
    getAdvancePercent(),
    fetchHalls({ city, sort: "rating" }),
    // Only for the "updated" date; lenient, as on the English twin.
    fetchCityInventoryBySlug(slug).catch(() => null),
  ]);
  const listingsUpdated = tamilDate(inventory?.lastUpdated);
  const pricedFrom = halls.map((h) => h.price_per_day).filter(hasPrice);
  const priceFrom = pricedFrom.length ? Math.min(...pricedFrom) : null;
  const largest = halls.length ? Math.max(...halls.map((h) => h.capacity_max)) : null;
  const everyVenueIsEnquiryOnly = allLead(halls);
  const description = describeCity(taCity, halls.length, priceFrom, everyVenueIsEnquiryOnly);

  const today = todayInBusinessTz();
  const muhurthamDays = nextMuhurthamDates(today, 6);
  const path = tamilCityPath(citySlug(city));
  const searchHref = (date: string) => `/halls?${new URLSearchParams({ city, date }).toString()}`;

  // Answered from THIS city's real numbers and booking mode, rendered visibly
  // below — which is what makes the FAQPage markup legitimate. Mirrors the
  // English page's four questions and their branches one for one.
  const fee =
    `${formatRupees(PLATFORM_FEE_RUPEES)} தளக் கட்டணமும் ${PLATFORM_FEE_GST_PERCENT}% GST-யும் ` +
    `(மொத்தம் ${formatRupees(PLATFORM_FEE_TOTAL_RUPEES)})`;
  const faqs = [
    {
      q: `${taCity} நகரில் திருமண மண்டபம் எவ்வளவு செலவாகும்?`,
      a: priceFrom
        ? `Hallnect-இல் பட்டியலிடப்பட்ட ${taCity} மண்டபங்கள் நாள் ஒன்றுக்கு ${formatRupees(priceFrom)} முதல் கிடைக்கின்றன. ` +
          `சரியான விலை தேதி, நேரப் பிரிவு மற்றும் மண்டபத்தின் கட்டண விகிதத்தைப் பொறுத்தது; ஒவ்வொரு பட்டியலிலும் அது காட்டப்படும்.`
        : everyVenueIsEnquiryOnly
          ? `விலை மண்டபம், தேதி, நேரப் பிரிவைப் பொறுத்து மாறும். இலவசமாக விலைப்புள்ளி கேட்டால், உங்கள் தேதிக்கான விலையை மண்டபம் தெரிவிக்கும்.`
          : `விலை மண்டபம், தேதி, நேரப் பிரிவைப் பொறுத்து மாறும். ஒவ்வொரு பட்டியலிலும் நாள் வாடகையும் முன்பதிவுக்குச் செலுத்த வேண்டிய முன்பணமும் காட்டப்படும்.`,
    },
    {
      q: `என் தேதியில் ${taCity} மண்டபம் காலியா என்று எப்படி அறிவது?`,
      a: everyVenueIsEnquiryOnly
        ? `இந்த மண்டபங்களின் முழு நாட்காட்டி Hallnect-இடம் இல்லை. உங்கள் தேதி மற்றும் விருந்தினர் எண்ணிக்கையுடன் இலவசமாக விலைப்புள்ளி கேளுங்கள். ` +
          `மண்டபம் அந்தத் தேதிக்கான விலையை Hallnect-இலேயே தெரிவிக்கும்; நீங்கள் ஏற்றுக்கொண்டால், தேதியை உறுதி செய்ய உங்களை அழைக்கும்.`
        : `மேலே உங்கள் விழா தேதியைத் தேர்ந்தெடுங்கள்; அந்த நாளில் Hallnect-இல் முன்பதிவு இல்லாத மண்டபங்கள் மட்டும் காட்டப்படும். ` +
          `ஒவ்வொரு மண்டபப் பக்கத்திலும் அடுத்த 30 நாட்களின் நிலை காலை, மாலை, முழு நாள் வாரியாகக் காட்டப்படும். ` +
          `நீங்கள் முன்பதிவு செய்யும்போது தேதி மீண்டும் சரிபார்க்கப்படுவதால், ஒரே தேதியை இருவர் முன்பதிவு செய்ய முடியாது.`,
    },
    {
      q: `${taCity} மண்டபத்தை ஆன்லைனில் முன்பதிவு செய்ய முடியுமா?`,
      a: everyVenueIsEnquiryOnly
        ? `தற்போது பட்டியலிடப்பட்ட ${taCity} மண்டபங்கள் ஆன்லைன் கட்டணத்துக்குப் பதிலாக விலைப்புள்ளி மூலம் செயல்படுகின்றன. ` +
          `விலைப்புள்ளி கேட்டு, ஒருமுறைக் கடவுச்சொல் (OTP) மூலம் கைபேசி எண்ணை உறுதி செய்யுங்கள். மண்டபம் விலை, அதில் அடங்குபவை, கேட்கும் முன்பணம் ஆகியவற்றை Hallnect-இலேயே தெரிவிக்கும்; ` +
          `நீங்கள் ஏற்றுக்கொண்டால் மட்டுமே உங்கள் கைபேசி எண் அந்த மண்டபத்துக்குக் கிடைக்கும். இந்த மண்டபங்களுக்கு Hallnect உங்களிடம் எந்தக் கட்டணமும் வசூலிப்பதில்லை.`
        : `ஆம். தேதியையும் நேரப் பிரிவையும் தேர்ந்தெடுத்து, ${advancePercent}% முன்பணத்துடன் ${fee} Cashfree மூலம் செலுத்துங்கள். ` +
          `சிறிய முன்பதிவுகளில் இந்தக் கட்டணம் முன்பணத்தின் கால் பங்குக்கு மேல் இருக்காது. ` +
          `மண்டப உரிமையாளர் ஏற்றுக்கொண்டதும் முன்பதிவு உறுதியாகும்; மீதித் தொகையை நேரடியாக மண்டபத்துக்குச் செலுத்துவீர்கள்.`,
    },
    ...(largest
      ? [{
          q: `Hallnect-இல் உள்ள மிகப் பெரிய ${taCity} மண்டபத்தில் எத்தனை பேர் அமரலாம்?`,
          a: `தற்போது பட்டியலிடப்பட்ட மிகப் பெரிய ${taCity} மண்டபத்தில் ${largest.toLocaleString("en-IN")} விருந்தினர் வரை அமரலாம். ` +
            `ஒவ்வொரு பட்டியலிலும் அதிகபட்சக் கொள்ளளவு குறிப்பிடப்பட்டுள்ளதால், விருந்தினர் எண்ணிக்கையை வைத்துத் தேர்வு செய்யலாம்.`,
        }]
      : []),
  ];

  return (
    <div
      lang="ta"
      className={`${tamilFont.variable} min-h-screen bg-ivory-100`}
      style={{ fontFamily: FONT_STACK }}
    >
      <JsonLd
        data={jsonLdGraph(
          cityCollectionJsonLd({
            city,
            path,
            description,
            name: `${taCity} திருமண மண்டபங்கள்`,
            inLanguage: "ta-IN",
            venues: halls.map((h) => ({ name: h.name, slug: h.slug })),
            dateModified: inventory?.lastUpdated,
          }),
          breadcrumbJsonLd([
            { name: "முகப்பு", path: "/" },
            { name: "தமிழ்நாடு", path: "/halls" },
            { name: taCity, path },
          ]),
          faqJsonLd(faqs),
        )}
      />

      <AppHeader title={taCity} />

      <div className="container-app flex flex-wrap items-center justify-between gap-2 pt-3 lg:max-w-7xl">
        <nav aria-label="வழிச்சுவடு">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-charcoal-600">
            <li><Link href="/" className="hover:text-maroon-700">முகப்பு</Link></li>
            <li aria-hidden="true">/</li>
            <li><Link href="/halls" className="hover:text-maroon-700">தமிழ்நாடு</Link></li>
            <li aria-hidden="true">/</li>
            <li className="font-medium text-charcoal-800" aria-current="page">{taCity}</li>
          </ol>
        </nav>
        <Link
          href={englishCityPath(citySlug(city))}
          hrefLang="en-IN"
          lang="en"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-maroon-700 hover:underline"
        >
          <Languages className="h-3.5 w-3.5" aria-hidden />
          Read in English
        </Link>
      </div>

      <header className="container-app pt-2 lg:max-w-7xl">
        <h1 className="text-2xl font-bold leading-snug text-charcoal-900 lg:text-3xl">
          {taCity} திருமண மண்டபங்கள்
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-charcoal-700">{description}</p>

        {halls.length > 0 && (
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-charcoal-700">
            <div className="flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-maroon-500" aria-hidden />
              <dt className="sr-only">பட்டியலிடப்பட்டவை</dt>
              <dd>{halls.length} {hallNoun(halls.length)}</dd>
            </div>
            {priceFrom != null && (
              <div className="flex items-center gap-1.5">
                <Wallet className="h-4 w-4 text-maroon-500" aria-hidden />
                <dt className="sr-only">தொடக்க விலை</dt>
                <dd>நாள் ஒன்றுக்கு {formatRupees(priceFrom)} முதல்</dd>
              </div>
            )}
            {largest != null && (
              <div className="flex items-center gap-1.5">
                <Users className="h-4 w-4 text-maroon-500" aria-hidden />
                <dt className="sr-only">அதிகபட்சக் கொள்ளளவு</dt>
                <dd>{largest.toLocaleString("en-IN")} விருந்தினர் வரை</dd>
              </div>
            )}
            {listingsUpdated && inventory?.lastUpdated && (
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-maroon-500" aria-hidden />
                <dt className="sr-only">கடைசியாகப் புதுப்பிக்கப்பட்டது</dt>
                <dd>கடைசியாகப் புதுப்பிக்கப்பட்டது: <time dateTime={inventory.lastUpdated}>{listingsUpdated}</time></dd>
              </div>
            )}
          </dl>
        )}
      </header>

      {/* ── Date first ──────────────────────────────────────────────────── */}
      {halls.length > 0 && (
        <section aria-labelledby="ta-date-h" className="container-app pt-6 lg:max-w-7xl">
          <div className="rounded-3xl bg-white p-5 shadow-card ring-1 ring-black/5 lg:p-6">
            <h2 id="ta-date-h" className="flex items-center gap-2 text-lg font-bold text-charcoal-900">
              <CalendarDays className="h-5 w-5 text-maroon-600" aria-hidden />
              உங்கள் விழா தேதி எப்போது?
            </h2>
            <p className="mt-1 text-sm text-charcoal-700">
              தேதியைத் தேர்ந்தெடுத்தால், அந்த நாளில் Hallnect-இல் முன்பதிவு இல்லாத மண்டபங்கள் மட்டும் காட்டப்படும்.
              ஒவ்வொரு மண்டபமும் உங்கள் தேதியை உறுதி செய்யும்.
            </p>

            {/* A plain GET form: it reaches the same filtered /halls URL the
                homepage search builds, and works before JavaScript loads. */}
            <form action="/halls" method="get" className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <input type="hidden" name="city" value={city} />
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold text-charcoal-900 sm:max-w-xs">
                விழா நாள்
                <input
                  type="date"
                  name="date"
                  min={today}
                  required
                  className="h-12 rounded-xl border border-charcoal-200 bg-white px-3 text-base font-normal text-charcoal-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-600"
                />
              </label>
              <button
                type="submit"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-maroon-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-maroon-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-600 focus-visible:ring-offset-2"
              >
                <Search className="h-4 w-4" aria-hidden />
                மண்டபங்களைத் தேடு
              </button>
            </form>

            {muhurthamDays.length > 0 && (
              <div className="mt-5 border-t border-charcoal-100 pt-4">
                <h3 className="text-sm font-semibold text-charcoal-900">அடுத்த முகூர்த்த நாட்கள்</h3>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {muhurthamDays.map((d) => (
                    <li key={d}>
                      <Link
                        href={searchHref(d)}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-gold-50 px-4 text-sm font-semibold text-gold-800 ring-1 ring-gold-300/70 transition-colors hover:bg-gold-100"
                      >
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold-500" />
                        {formatTamilDate(d)}
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-charcoal-600">
                  தமிழ் நாட்காட்டியின்படி முகூர்த்த நாட்கள். உங்கள் தேதியைக் குடும்ப ஜோதிடரிடம் உறுதி செய்யுங்கள்.
                </p>
                <Link href="/ta/muhurtham-dates" className="mt-2 inline-flex min-h-[40px] items-center text-sm font-semibold text-maroon-700 hover:underline">
                  எல்லா முகூர்த்த நாட்களும் →
                </Link>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Venues ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="ta-halls-h" className="container-app py-6 lg:max-w-7xl">
        {halls.length > 0 ? (
          <>
            <h2 id="ta-halls-h" className="text-lg font-bold text-charcoal-900">பட்டியலிடப்பட்ட மண்டபங்கள்</h2>
            <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {halls.map((hall, i) => (
                <li key={hall.id}>
                  <TamilHallCard hall={hall} taCity={taCity} eager={i === 0} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="rounded-2xl border border-border bg-white p-6 text-center">
            <MapPin className="mx-auto h-8 w-8 text-charcoal-300" aria-hidden />
            <h2 id="ta-halls-h" className="mt-3 text-base font-bold text-charcoal-900">
              {taCity} மண்டபங்கள் இன்னும் பட்டியலிடப்படவில்லை
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-charcoal-700">
              Hallnect {taCity} மண்டபங்களைச் சேர்த்து வருகிறது. அதுவரை தமிழ்நாடு முழுவதும் உள்ள மண்டபங்களைப் பாருங்கள்.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href="/halls" className="rounded-xl bg-maroon-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-maroon-800">
                எல்லா மண்டபங்களையும் பாருங்கள்
              </Link>
              <Link href="/owner/register" className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-charcoal-800 hover:border-maroon-300">
                உங்கள் மண்டபத்தைப் பட்டியலிடுங்கள்
              </Link>
            </div>
          </div>
        )}
      </section>

      {/* ── Why Hallnect ────────────────────────────────────────────────────
          Three promises, each one already true of the product: prices are on
          the listing where the owner publishes one, a customer's number goes
          only to the hall they choose, and the owner confirms the date and is
          paid the balance directly. NOT "no commission": Hallnect takes one
          from the owner's share, so a customer-facing "no middleman fee" line
          would be false. */}
      <section aria-labelledby="ta-why-h" className="container-app border-t border-border py-8 lg:max-w-7xl">
        <h2 id="ta-why-h" className="text-lg font-bold text-charcoal-900">ஏன் Hallnect?</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            {
              Icon: Tag,
              title: "உண்மையான விலை",
              body: "விலை வெளியிடும் மண்டபங்களின் நாள் வாடகை பட்டியலிலேயே தெரியும். அழைத்துக் கேட்க வேண்டியதில்லை.",
            },
            {
              Icon: PhoneOff,
              title: "தொல்லை அழைப்புகள் இல்லை",
              body: "உங்கள் கைபேசி எண் நீங்கள் தேர்ந்தெடுக்கும் மண்டபத்துக்கு மட்டுமே செல்லும். வேறு யாருக்கும் விற்கப்படாது.",
            },
            {
              Icon: UserCheck,
              title: "நேரடியாக உரிமையாளரிடம்",
              body: "மண்டப உரிமையாளரே உங்கள் தேதியை உறுதி செய்கிறார். மீதித் தொகையை நேரடியாக மண்டபத்துக்கே செலுத்துவீர்கள்.",
            },
          ].map(({ Icon, title, body }) => (
            <li key={title} className="rounded-2xl bg-white p-5 ring-1 ring-black/5">
              <Icon className="h-5 w-5 text-maroon-600" aria-hidden />
              <h3 className="mt-2 text-base font-bold text-charcoal-900">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-charcoal-700">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── FAQ — the visible answers behind the FAQPage markup ──────────── */}
      <section aria-labelledby="ta-faq-h" className="container-app border-t border-border py-8 lg:max-w-7xl">
        <h2 id="ta-faq-h" className="text-lg font-bold text-charcoal-900">
          {taCity} மண்டப முன்பதிவு: அடிக்கடி கேட்கப்படும் கேள்விகள்
        </h2>
        <dl className="mt-3 max-w-3xl space-y-5">
          {faqs.map((f) => (
            <div key={f.q}>
              <dt className="text-base font-semibold text-charcoal-900">{f.q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-charcoal-700">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/**
 * The listing card, in Tamil. Not the shared HallCard, whose every label is
 * English — but the same facts: cover, name, capacity, price through hasPrice
 * (a "contact for pricing" venue must never read as ₹0), booking mode, rating.
 */
function TamilHallCard({ hall, taCity, eager }: { hall: HallListing; taCity: string; eager: boolean }) {
  const lead = isLeadGeneration(hall.booking_mode);
  return (
    <Link
      href={`/halls/${hall.slug}`}
      className="group block overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-black/5 transition-shadow hover:shadow-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-600"
    >
      <div className="relative aspect-[4/3] bg-ivory-200">
        {hall.cover_url ? (
          <Image
            src={hall.cover_url}
            alt={`${hall.name}, ${taCity} திருமண மண்டபம்`}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover"
            {...(eager ? { loading: "eager" as const, fetchPriority: "high" as const } : {})}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-charcoal-300">
            <Building2 className="h-10 w-10" aria-hidden />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5 p-4">
        <h3 className="text-base font-bold text-charcoal-900 group-hover:text-maroon-700">{hall.name}</h3>
        <p className="flex items-center gap-1.5 text-sm text-charcoal-700">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-maroon-500" aria-hidden />
          <span className="truncate">{hall.address ? `${hall.address}` : taCity}</span>
        </p>
        <p className="flex items-center gap-1.5 text-sm text-charcoal-700">
          <Users className="h-3.5 w-3.5 shrink-0 text-maroon-500" aria-hidden />
          {hall.capacity_max.toLocaleString("en-IN")} விருந்தினர் வரை
        </p>
        {hall.rating_count > 0 && (
          <p className="flex items-center gap-1.5 text-sm text-charcoal-700">
            <Star className="h-3.5 w-3.5 shrink-0 fill-gold-400 text-gold-500" aria-hidden />
            {hall.rating_average.toFixed(1)} · {hall.rating_count} மதிப்புரைகள்
          </p>
        )}
        <div className="mt-2 flex items-end justify-between gap-3 border-t border-charcoal-100 pt-3">
          <div>
            <p className="text-base font-bold text-charcoal-900">
              {hasPrice(hall.price_per_day) ? `${formatRupees(hall.price_per_day)} / நாள்` : "விலைக்கு விசாரிக்கவும்"}
            </p>
            <p className="text-xs text-charcoal-600">
              {lead ? "இலவசமாக விசாரிக்கலாம்" : "ஆன்லைனில் முன்பதிவு செய்யலாம்"}
            </p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-maroon-700">விவரங்கள் →</span>
        </div>
      </div>
    </Link>
  );
}
