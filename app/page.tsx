import Link from "next/link";
import {
  ArrowRight, Building2, Check, CheckCircle2, Crown, Plus, Shield, Sparkles, Star,
} from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { MobileSearch } from "./_components/MobileSearch";
import { CityGrid } from "./_components/CityGrid";
import Image from "next/image";
import { CITY_COVERS, LAUNCH_CITIES, POPULAR_CITIES } from "@/lib/content";
import { getAdvancePercent } from "@/lib/platform-settings";
import { todayInBusinessTz } from "@/lib/dates";
import { platformFeeDisclosure } from "@/lib/booking-payment";
import { AdSlot } from "@/components/ads/AdSlot";
import { heroDelay, revealDelay } from "@/lib/motion";
import { HeroSearch } from "@/components/sections/HeroSearch";
import { ScrollScrubVideo } from "@/components/sections/ScrollScrubVideo";
import { HeroOccasionWord } from "@/components/sections/HeroOccasionWord";

import { HallCard } from "@/app/halls/_components/HallCard";
import { countActivePremiumHalls, fetchHalls, type HallListing } from "@/lib/halls";
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  jsonLdGraph, organizationJsonLd, websiteJsonLd, faqJsonLd,
} from "@/lib/seo/jsonld";
import { fetchCityInventory, type CityInventory } from "@/lib/seo/cities";
import { fetchVenueCategories, fetchCategoryInventory } from "@/lib/venue-categories.server";
import { OccasionDiscovery, occasionTiles } from "@/components/sections/OccasionDiscovery";
import { QuickFilters } from "@/components/sections/QuickFilters";

// The phone hero card's shade: light over the sky at the top, heavy under the
// copy at the bottom. Measured on the poster cropped to the 343x272 card at
// 375px, 95th-percentile brightest pixel under each line of white text:
//   eyebrow (on its own 55% pill)  7.82:1 vs 4.5  (+74%)
//   H1, 28px bold                  7.29:1 vs 3.0  (+143%)
//   subline, 14px                 14.23:1 vs 4.5  (+216%)
// Without the pill the eyebrow scored 2.05:1 — the sky is that bright. Keep the
// pill, or darken the top, if either changes.
const MOBILE_HERO_SHADE =
  "linear-gradient(to bottom, rgba(26,22,20,0.20) 0%, rgba(26,22,20,0.45) 30%, rgba(26,22,20,0.80) 60%, rgba(26,22,20,0.90) 100%)";

// Used when a city has real inventory but no hand-picked gradient in
// POPULAR_CITIES — a tile still has to look like the others.
const CITY_GRADIENT_FALLBACK = "linear-gradient(135deg,#6B1525 0%,#9B2038 100%)";

const HOW_IT_WORKS = [
  { step: "01", title: "Discover", body: "Browse halls across Tamil Nadu for weddings, parties, meetings and more — photos, capacity, pricing and amenities, as listed by each venue." },
  { step: "02", title: "Compare",  body: "Filter by city, capacity, budget, and amenities. Venues that publish a calendar show their open dates." },
  { step: "03", title: "Book or enquire", body: "Some venues take an online advance to hold your date. Others take a free enquiry and confirm the details with you directly." },
];

const FAQ_ITEMS = [
  { q: "How do I book a venue?",
    a: `It depends on the venue, and each listing says which it is. Where a venue books online, you pick your date and slot and pay the advance plus a ${platformFeeDisclosure()} through Cashfree — capped at a quarter of the advance on a small booking, and waivable with a promotional code — and the booking is confirmed once the owner accepts it. Where a venue takes enquiries instead, you send a free enquiry, verify your mobile number, and the venue contacts you to agree the date and price directly.` },
  { q: "Is the advance payment refundable?",
    a: "It depends when you cancel: the full advance is refundable more than 30 days before the event, and partially up to 7 days before. The platform fee and its GST, where charged, are non-refundable on customer cancellations." },
  { q: "Can I see the venue before booking?",
    a: "Yes. We strongly recommend visiting in person. On an online booking the owner's contact details are shared once the booking is confirmed; on an enquiry the venue contacts you as soon as you verify your mobile number." },
  { q: "How much does Hallnect charge?",
    a: `On an online booking you pay the venue advance plus a ${platformFeeDisclosure()} at checkout, shown clearly before you pay; on a small booking the fee is capped at a quarter of the advance, and a promotional code can reduce it to zero. On an enquiry you pay Hallnect nothing at all. There are no other charges from Hallnect.` },
  { q: "I'm a venue owner — how do I list?",
    a: "Register as an owner, complete your business profile, and submit your venue for approval. Listings are reviewed within 48 hours." },
];

// "verified" was removed here for the same reason it was removed from
// APP_DESCRIPTION: Terms section 5 says Hallnect does not independently verify
// every listing detail, so the homepage cannot advertise that it does. See the
// comment on APP_DESCRIPTION in lib/constants.ts before reinstating it.
//
// Kept under 158 characters, which is where buildMetadata's clamp() cuts. This
// was 178 and arrived in the SERP clipped mid-sentence with an ellipsis — the
// homepage snippet is the one line most people ever read about Hallnect, and it
// was ending on a word we did not choose. Count before you lengthen it.
export const metadata: Metadata = buildMetadata({
  // The brand is written in literally, NOT left to title.template: a layout's
  // template does not apply to a page in its own segment, which is why this
  // one page shipped brandless while all twelve others read "… | Hallnect".
  // "Wedding" STAYS FIRST. The expansion to every occasion is real and the
  // rest of this page reflects it, but this one string is what the pages that
  // currently rank were built on, and re-leading it with a generic word to
  // sound broader would trade live traffic for a positioning statement no
  // searcher types. The breadth is added in the second half and in the
  // description; see APP_DESCRIPTION for the same rule.
  title: "Wedding, Party & Event Halls in Tamil Nadu | Hallnect",
  // 147 characters. buildMetadata's clamp cuts at 158 and the first draft of
  // this widening ran to 166 — count before you lengthen it, as the note above
  // says. "marriage" is kept as a bare adjective rather than "marriage halls"
  // for exactly those characters; it is still the phrase people search.
  description:
    "Find and book wedding, marriage, party and meeting halls across Tamil Nadu. " +
    "Compare owner-submitted photos, capacity and pricing, then book online.",
  path: "/",
});

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

export default async function HomePage() {
  // Featured = real APPROVED halls from Supabase (RLS-filtered), top-rated first.
  // No fake/demo halls — empty list renders a proper empty state, so cards can
  // never link to a slug that 404s.
  // Default sort, NOT sort:"rating". fetchHalls's default orders pro →
  // premium → rest before rating, which is the "Homepage promotion" the Pro
  // plan is sold on. Sorting by rating alone quietly ignored premium tier, so
  // owners paid Rs9,999/month for placement the homepage never gave them.
  //
  // ONE ROUND OF QUERIES, NOT FOUR. These four reads do not depend on each
  // other, but they were awaited one after another — and the database is in
  // Sydney while this function runs in Mumbai, so each await paid a ~150-200ms
  // round trip before the next one could start. On the busiest page on the site
  // that was most of a 2.5s time-to-first-byte, spent waiting rather than
  // working. Run together they cost one round trip instead of four.
  //
  // countActivePremiumHalls is in here too: it was awaited further down the
  // function, which made it a fifth serial hop.
  const [featuredAll, advancePercent, cityInventory, premiumCount, catalogue, categoryInventory] =
    await Promise.all([
      fetchHalls({}),
      getAdvancePercent(),
      fetchCityInventory(),
      countActivePremiumHalls(),
      // LENIENT, both of them. If either read fails the occasions strip is
      // absent and every other section of the home page is untouched — the
      // same trade the city tiles already make.
      fetchVenueCategories(),
      fetchCategoryInventory(),
    ]);
  const featured: HallListing[] = featuredAll.slice(0, 6);
  const citiesWithVenues = cityInventory.filter((c) => c.venueCount > 0);
  // Computed on the SERVER and handed to the search pill. A browser in another
  // timezone would otherwise let someone pick a date that is already yesterday
  // here — the drift lib/dates.ts exists to eliminate.
  const today = todayInBusinessTz();

  // ── Truth gates ───────────────────────────────────────────────────────────
  // Three things on this page used to assert facts the database did not back.

  // 1. THE PROMOTED SECTION. `featured` is the plain approved list — the
  //    default sort puts pro → premium first, but with nothing premium in the
  //    database it is simply "every hall we have". Calling that "Promoted" and
  //    "Halls promoted by their owners" advertises the exact slot /premium
  //    sells for Rs4,999–9,999 a month, above halls that paid nothing. The
  //    Promoted framing is now used only when the section really does contain
  //    a paid listing.
  //    Tested against the PAID tiers by name, not `!= null`: PremiumTier's TS
  //    union also contains "free", and only "premium" and "pro" are bought.
  const hasPromoted = featured.some(
    (h) => h.premium_tier === "premium" || h.premium_tier === "pro",
  );

  // 2. PREMIUM ENTRY POINT. /halls?category=premium returns nothing while no
  //    hall holds a paid tier, so the Premium pill stays hidden until there is
  //    inventory and returns on its own the moment an owner buys a plan. The
  //    gate now lives in QuickFilters, which is handed premiumCount below.
  //    Fetched with the batch at the top of this function, not here — awaiting
  //    it at its point of use made it a fifth serial round trip to Sydney.

  // EVERY occasion in the catalogue, the ones with venues first. No limit: this
  // grid is where a visitor learns Hallnect is not a wedding-only site, and
  // showing two of twenty-eight defeated the point. Empty only when the
  // catalogue itself could not be read. See OccasionDiscovery for why showing
  // the empty ones to PEOPLE is safe while indexing them would not be.
  const occasions = occasionTiles(catalogue, categoryInventory);

  // 3. CITY TILES. This strip once rendered a static list of eight cities, so
  //    seven of the eight tiles led to an empty search. Every tile is now
  //    decided by the live count: every city with venues is a normal tile, and
  //    the LAUNCH_CITIES that have none follow as "Coming soon" tiles pointing
  //    at their landing page, which says the same thing.
  //
  //    A FAILED READ HIDES THE STRIP, it does not relabel it. On success the
  //    inventory always contains every declared service-area city (with zero
  //    counts where empty), so an empty array can only mean the query failed.
  //    Rendering coming-soon states from that would tell visitors Madurai has
  //    no venues — the swallowed-error-shown-as-fact defect this repo keeps
  //    documenting.
  const inventoryRead = cityInventory.length > 0;
  const comingSoon = LAUNCH_CITIES
    .map((name) => cityInventory.find((c) => c.city === name))
    .filter((c): c is CityInventory => c !== undefined && c.venueCount === 0);
  const cities = (inventoryRead ? [...citiesWithVenues, ...comingSoon] : [])
    .slice(0, 8)
    .map((c) => ({
      name:     c.city,
      state:    "Tamil Nadu",
      gradient: POPULAR_CITIES.find((p) => p.name === c.city)?.gradient ?? CITY_GRADIENT_FALLBACK,
      slug:     c.slug,
      live:     c.venueCount > 0,
      image:    CITY_COVERS[c.city],
    }));

  return (
    <div className="bg-ivory-100">
      {/* Organization + WebSite + the FAQ that is genuinely rendered below.
          FAQPage markup is only legitimate when the answers are visible on the
          page, which they are (the SEO section further down renders every
          FAQ_ITEMS entry at all viewports). */}
      <JsonLd
        data={jsonLdGraph(
          organizationJsonLd(),
          websiteJsonLd(),
          faqJsonLd(FAQ_ITEMS.map((f) => ({ q: f.q, a: f.a }))),
        )}
      />
      {/* ════════════════════════════════════════════════════════
          MOBILE — app-style stack (lg:hidden)
          ════════════════════════════════════════════════════════ */}
      <div className="lg:hidden">
        <AppHeader />

        {/* ── Mobile hero ───────────────────────────────────────────────
            A photo card, not a full-bleed band: the walk-through's opening
            frame, rounded like every other card in this app shell, with the
            search card overlapping its bottom edge so the one control that
            matters is the first thing a thumb reaches.

            Not the scrub itself: pinning two screens of scroll on a phone would
            bury the search and cost ~5 MB of mobile data for an effect.

            THE SHADE IS BOTTOM-HEAVY, BECAUSE THE TEXT IS AT THE BOTTOM. The top
            of this frame is bright dusk sky; the copy now sits low in the card,
            over the dark hall floor, so the sky can stay bright. Measured on
            the poster cropped to the card at 390px (95th-percentile brightest
            pixel under the composited shade) — see homepage-hero.test.ts. */}
        <section className="container-app pt-2">
          <div data-hero style={heroDelay(0)} className="relative overflow-hidden rounded-[28px] bg-charcoal-950">
            <div data-hero-zoom className="absolute inset-0">
              <Image
                src="/scrub/hall-walkthrough-poster.jpg"
                alt=""
                fill
                priority
                sizes="(max-width: 512px) 100vw, 512px"
                className="object-cover object-center"
              />
            </div>
            <div aria-hidden className="absolute inset-0" style={{ background: MOBILE_HERO_SHADE }} />
            <div className="relative flex min-h-[272px] flex-col justify-end px-5 pb-14 pt-10">
              <p className="inline-flex items-center gap-1.5 self-start rounded-full bg-charcoal-950/55 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-white backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> Plan your celebration
              </p>
              {/* THE page H1. Google indexes mobile-first, so the keyword- and
                  location-bearing heading must live in the MOBILE tree — the
                  desktop hero below is display:none to Googlebot. */}
              {/* "Wedding" STAYS FIRST. This is the H1 Google indexes and the
                  phrase the only pages that rank were built on; re-leading it
                  with a generic word to sound broader would trade live traffic
                  for a positioning statement nobody searches. The breadth is
                  added after it, and matches the page title exactly. */}
              <h1 className="hero-ink mt-2 text-balance font-serif text-[28px] font-bold leading-[1.15] text-white">
                Wedding, Party &amp; Event Halls in Tamil Nadu
              </h1>
              <p className="hero-ink mt-2 text-sm text-white">
                Weddings, parties, meetings and more. Owner-submitted listings, transparent pricing.
              </p>
            </div>
          </div>

          {/* Above the fold on every phone: a CSS keyframe, never a scroll
              reveal. No transform-based reveal can break the search sheet — it
              portals to <body> (see components/app/BottomSheet.tsx). */}
          <div data-hero style={heroDelay(1)} className="relative z-10 -mt-10 px-2">
            <MobileSearch
              cities={citiesWithVenues.map((c) => ({ city: c.city, venueCount: c.venueCount }))}
              today={today}
            />
          </div>
        </section>

        <section data-reveal="fade" className="container-app mt-5 empty:hidden">
          <AdSlot placement="homepage_banner" limit={1} />
        </section>

        {/* ── What are you planning? ────────────────────────────────────
            The multi-purpose catalogue: one tile per occasion that actually
            has a venue behind it. Absent entirely when none do — see
            OccasionDiscovery for why an ungated version of this is the exact
            defect the premium tile had to be fixed for twice. */}
        {/* ONE DISCOVERY SECTION. The occasions and the three filter pills
            under them used to be two separate "browse" sections back to back,
            and a visitor could not tell which to use. See QuickFilters. */}
        <section className="mt-8">
          <MobileSectionTitle
            title="What are you planning?"
            linkLabel="All venues"
            linkHref="/halls"
          />
          {occasions.length > 0 && <OccasionDiscovery tiles={occasions} variant="mobile" />}
          <QuickFilters premiumCount={premiumCount} className="container-app mt-4" />
        </section>

        <section className="mt-8">
          <MobileSectionTitle
            title={hasPromoted ? "Featured Venues" : "Venues on Hallnect"}
            linkLabel="See all"
            linkHref="/halls"
          />
          {featured.length === 0 ? (
            <div data-reveal="up" style={revealDelay(1, 120)} className="container-app"><EmptyVenues /></div>
          ) : (
            // Snaps card by card, and each card is narrower than the screen so
            // the next one peeks in — the swipe explains itself.
            <div
              data-reveal="up"
              style={revealDelay(1, 120)}
              className="no-scrollbar snap-x snap-mandatory overflow-x-auto scroll-px-4 sm:scroll-px-6"
            >
              <ul className="flex w-max gap-3 px-4 pb-2 sm:px-6">
                {featured.map((h) => (
                  <li key={h.id} className="w-[78vw] max-w-[300px] shrink-0 snap-start">
                    <HallCard hall={h} advancePercent={advancePercent} />
                  </li>
                ))}
                <li className="w-40 shrink-0 snap-start">
                  <Link
                    href="/halls"
                    className="flex h-full min-h-40 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-charcoal-300 bg-white p-4 text-center"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-maroon-600 text-white">
                      <ArrowRight className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="text-sm font-semibold text-charcoal-900">Browse all venues</span>
                  </Link>
                </li>
              </ul>
            </div>
          )}
        </section>

        {cities.length > 0 && (
          <section className="mt-8">
            <MobileSectionTitle title="Halls by city" />
            <CityGrid cities={cities} />
          </section>
        )}

        {/* ── How it works ─────────────────────────────────────────────
            The same three steps the desktop page explains, as a timeline. */}
        <section className="container-app mt-10">
          <h2 data-reveal="up" className="font-serif text-lg font-semibold text-charcoal-900">How Hallnect works</h2>
          <ol className="mt-4 space-y-4">
            {HOW_IT_WORKS.map((s, i) => (
              <li key={s.step} data-reveal="up" style={revealDelay(i, 90)} className="relative flex gap-4">
                {i < HOW_IT_WORKS.length - 1 && (
                  <span aria-hidden className="absolute left-[17px] top-10 h-[calc(100%-1.5rem)] w-px bg-maroon-100" />
                )}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-maroon-600 text-xs font-bold text-white">
                  {s.step}
                </span>
                <div className="min-w-0 pb-1">
                  <h3 className="text-sm font-semibold text-charcoal-900">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-charcoal-600">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Owner CTA ────────────────────────────────────────────────
            The desktop card's copy, word for word — none of it is new. */}
        <section className="container-app mt-10 pb-8">
          <div data-reveal="up" className="overflow-hidden rounded-3xl bg-maroon-gradient p-6 shadow-elevated">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-gold-200">
              <Crown className="h-3 w-3" aria-hidden /> For Venue Owners
            </span>
            <h2 className="mt-3 font-serif text-2xl font-bold leading-tight text-ivory-100">
              List your venue on Hallnect
            </h2>
            <p className="mt-2 text-sm text-ivory-100">
              List your hall in minutes. Get bookings backed by gateway-verified payments
              and a dedicated owner dashboard.
            </p>
            <p className="mt-3 flex items-center gap-2 text-sm font-medium text-ivory-100">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-gold-200" aria-hidden />
              Free to list — pay only on booking
            </p>
            <Link
              href="/owner/register"
              className="mt-5 flex h-12 items-center justify-center rounded-2xl bg-gold-gradient text-sm font-semibold text-charcoal-950 shadow-gold active:scale-[0.99] motion-reduce:active:scale-100"
            >
              List your venue
            </Link>
          </div>
        </section>
      </div>

      {/* ════════════════════════════════════════════════════════
          DESKTOP — premium adaptive layout (hidden lg:block)
          ════════════════════════════════════════════════════════ */}
      <div className="hidden lg:block">
        {/* ── Hero: the scroll walk-through ──────────────────────────────
            The hero IS the walk-through now: it pins for two screens while
            scrolling moves the clip from the entrance into the hall, forward on
            the way down and backward on the way up, then releases.

            The headline fades out over the first 12% of the scroll so the
            walk-through can be seen; the search pill does NOT — it stays pinned
            at the bottom of the frame for the whole walk-through, because it is
            the primary action on the page. It sits inside the frame rather than
            straddling its edge: while pinned, the frame's bottom edge IS the
            fold, so an overhang would put half the pill off-screen.

            The negative margin pulls the hero up under the transparent header,
            which stays transparent for as long as the hero is pinned (see
            data-header-clear in RevealObserver). It is 4rem + 1px, not -mt-16:
            the header is 64px PLUS a 1px bottom border, and pulling up only 64px
            left a hairline of page background across the top of the video —
            measured, the hero started at y=0.91 with the border 0.91px wide.

            No venue name anywhere on it. The footage is a generated hall, not a
            listed venue, and nothing here may suggest otherwise. */}
        <ScrollScrubVideo
          className="-mt-[calc(4rem+1px)]"
          src="/scrub/hall-walkthrough.mp4"
          poster="/scrub/hall-walkthrough-poster.jpg"
          intro={
            <div className="container-page w-full">
              <div className="mx-auto max-w-4xl text-center">
                <span className="hero-ink inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-white backdrop-blur">
                  <Sparkles className="h-3 w-3" /> Halls for every occasion · Tamil Nadu
                </span>

                {/* Visually the desktop headline, but NOT an <h1>: the homepage
                    emits its H1 in the mobile tree above, and both trees ship in
                    the same HTML, so a second one is what a crawler receives.

                    gold-200, re-measured over the walk-through's opening frames
                    under both shades: 4.15:1 against a 3.0 bar for 56px bold
                    (+38%). gold-300 is noticeably weaker on this footage. */}
                <p className="hero-ink mt-6 font-serif text-5xl font-bold leading-[1.1] text-white xl:text-6xl">
                  Every <HeroOccasionWord />
                  <br />
                  starts with the right hall.
                </p>

              </div>

              {/* Trust strip — honest launch-stage messaging (no fabricated numbers).
                  On a frosted bar of its own: without one the four lines sat
                  loose on the footage and faded into its darker lower edge.
                  The bar's 45% charcoal is ON TOP of the intro shade, so the
                  white text here is on a darker ground than the subhead above,
                  which already passes at 4.5:1 with white/90.

                  Each line is something the site does today: prices are shown
                  as the owner lists them, listings are submitted by owners and
                  approved by an admin before they publish, and an enquiry is
                  free (FAQ: "you pay Hallnect nothing at all"). No counts, and
                  no "verified" — Terms section 5 rules that out. */}
              <div className="mx-auto mt-10 grid max-w-5xl grid-cols-4 divide-x divide-white/20 rounded-full border border-white/25 bg-charcoal-950/45 px-3 py-3 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.5)] backdrop-blur-md">
                <TrustItem text="Transparent pricing" />
                <TrustItem text="Listed by venue owners" />
                <TrustItem text="Approved before going live" />
                <TrustItem text="Free to enquire" />
              </div>
            </div>
          }
          footer={
            <HeroSearch
              cities={citiesWithVenues.map((c) => ({ city: c.city, venueCount: c.venueCount }))}
              today={today}
            />
          }
        />

        {/* ── What are you planning? ───────────────────────────── */}
        {occasions.length > 0 && (
          <section className="container-page pt-12">
            <DesktopSectionHeader
              eyebrow="Every occasion"
              title="Find a hall for your occasion"
              blurb="Weddings, parties, meetings, celebrations — one place to find the right venue."
              linkLabel="Browse all venues →"
              linkHref="/halls"
            />
            <div className="mt-6">
              <OccasionDiscovery tiles={occasions} variant="desktop" />
            </div>
            {/* The shortcuts that used to be a whole second row of tiles
                below this one. See QuickFilters for why they are pills. */}
            <QuickFilters premiumCount={premiumCount} className="mt-5 justify-center" />
          </section>
        )}

        {/* ── Sponsored banner ─────────────────────────────────── */}
        <section data-reveal="fade" className="container-page pb-4">
          <AdSlot placement="homepage_banner" limit={1} />
        </section>

        {/* ── Featured venues grid ─────────────────────────────── */}
        <section className="container-page py-12">
          {/* The "Promoted" eyebrow is an advertising disclosure, not a
              decoration: it may only appear when this section actually holds a
              hall someone paid to place there. Otherwise it says what the
              section is — the approved list, ranked by rating. */}
          <DesktopSectionHeader
            eyebrow={hasPromoted ? "Promoted" : "Now on Hallnect"}
            title={hasPromoted ? "Featured Venues" : "Venues on Hallnect"}
            blurb={
              hasPromoted
                ? "Halls promoted by their owners, with transparent pricing."
                : "Approved venues listed on Hallnect, top-rated first, with transparent pricing."
            }
            linkLabel="Browse all venues →"
            linkHref="/halls"
          />
          {featured.length === 0 ? (
            <div className="mt-8"><EmptyVenues /></div>
          ) : (
            <div className="mt-8 grid grid-cols-2 gap-6 xl:grid-cols-3">
              {featured.map((h, i) => (
                <HallCard key={h.id} hall={h} advancePercent={advancePercent} revealIndex={i} />
              ))}
            </div>
          )}
        </section>

        {/* ── Cities ───────────────────────────────────────────── */}
        {/* Was "Popular Cities" over a static list of eight Tamil Nadu cities,
            seven of which had no inventory — every tile promised venues and
            delivered an empty search. Each tile is decided by the live count
            now: "Explore" where venues exist, "Coming soon" where they do not.
            The title and blurb changed with it — "Cities with venues… taking
            bookings today" would be false above a Chennai tile with none. */}
        {cities.length > 0 && (
        <section className="container-page py-12">
          <DesktopSectionHeader
            eyebrow="By location"
            title="Halls by city"
            blurb="Browse the cities where halls are listed today, and see where Hallnect is launching next."
          />
          {/* Three to a row when the count divides by three (six launch
              cities = two full rows), otherwise four — never a hole at the
              end of a row that a divisible count could have avoided. */}
          <div className={`mt-8 grid gap-4 ${cities.length % 3 === 0 ? "grid-cols-3" : "grid-cols-4"}`}>
            {cities.map((c, i) => (
              <Link
                key={c.name}
                href={`/wedding-halls/${c.slug}`}
                data-reveal="scale"
                className="group relative h-44 overflow-hidden rounded-2xl shadow-card transition-transform hover:-translate-y-1.5 hover:shadow-card-hover"
                style={{ background: c.gradient, ...revealDelay(i, 70) }}
              >
                {c.image && (
                  <Image
                    src={c.image}
                    alt=""
                    fill
                    // The desktop tree only renders from lg up, where a tile is
                    // 228-292px wide in four columns and up to ~395px in three.
                    sizes="(min-width: 1280px) 400px, 320px"
                    // 35% down rather than centred: the frame is nearly square
                    // and the tile is wide, so a centred crop cut the gopuram
                    // tops off.
                    className="object-cover object-[50%_35%] transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                )}
                {/* HEAVIER OVER A PHOTO, MEASURED ON EVERY PHOTO. The gradient
                    tiles are flat colour and read fine at /55. The photos are
                    not: Chennai is a sunlit daytime shot with a white canopy
                    and a red bus exactly where the name sits, and at /80 via
                    /30 its name scored 3.12:1 on a phone tile against a 4.5
                    bar (Tiruchirappalli 4.22). Weakest case at /90 via /50,
                    name or the white/90 state line, desktop or mobile:
                      Madurai 8.7  Chennai 5.0  Coimbatore 11.8  Trichy 7.1
                      Salem 7.9  Theni 12.2   (Mettur Dam's white water sits
                      under the name; still +76% over the bar)
                    The top of each photo — sky, tower, statue — stays bright;
                    only the ground under the label darkens. Re-measure if a
                    cover is swapped: a brighter photo fails this silently. */}
                <div
                  className={`absolute inset-0 bg-gradient-to-t to-transparent ${
                    c.image ? "from-black/90 via-black/50" : "from-black/55 via-black/20"
                  }`}
                />
                <div className="absolute inset-x-4 bottom-4 text-white">
                  <p className="font-serif text-lg font-bold">{c.name}</p>
                  <p className="text-xs text-white/90">{c.state}</p>
                </div>
                <div
                  className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur ${
                    c.image ? "bg-black/40" : "bg-white/15"
                  }`}
                >
                  {c.live ? "Explore →" : "Coming soon"}
                </div>
              </Link>
            ))}
          </div>
        </section>
        )}

        {/* ── How it works ─────────────────────────────────────── */}
        <section className="bg-white">
          <div className="container-page py-16">
            <DesktopSectionHeader
              eyebrow="Simple process"
              title="How Hallnect Works"
              blurb="From discovery to booking — three steps to your perfect venue."
              centered
            />
            <div className="mt-12 grid grid-cols-3 gap-8">
              {HOW_IT_WORKS.map((s, i) => (
                <div
                  key={s.step}
                  data-reveal="up"
                  style={revealDelay(i, 140)}
                  className="relative rounded-2xl border border-border bg-ivory-50 p-7 transition-all hover:-translate-y-1 hover:shadow-card-hover"
                >
                  <span className="absolute -top-4 left-7 rounded-full bg-maroon-gradient px-3 py-1 text-xs font-bold text-white shadow-maroon">
                    {s.step}
                  </span>
                  <h3 className="mt-3 font-serif text-xl font-semibold text-charcoal-900">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-charcoal-600">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Owner CTA ────────────────────────────────────────── */}
        <section className="container-page py-16">
          <div className="overflow-hidden rounded-3xl bg-maroon-gradient shadow-elevated">
            <div className="grid grid-cols-5 items-center gap-8 p-10 xl:p-12">
              <div data-reveal="left" className="col-span-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-gold-300">
                  <Crown className="h-3 w-3" /> For Venue Owners
                </span>
                <h2 className="mt-4 font-serif text-3xl font-bold text-ivory-100 xl:text-4xl">
                  List your venue on Hallnect
                </h2>
                {/* "verified bookings" read as though Hallnect vetted the
                    customer. What is actually verified is the payment: the
                    Cashfree webhook signature is checked before a booking moves
                    to payment_success. Say that instead. */}
                <p className="mt-3 max-w-lg text-sm text-ivory-300/90">
                  List your hall in minutes. Get bookings backed by gateway-verified payments
                  and a dedicated owner dashboard.
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Link
                    href="/owner/register"
                    className="inline-flex items-center justify-center rounded-xl bg-gold-gradient px-6 py-3 text-sm font-semibold text-charcoal-950 shadow-gold transition-transform hover:scale-[1.02]"
                  >
                    List your venue
                  </Link>
                  <Link
                    href="/premium"
                    className="inline-flex items-center justify-center rounded-xl border border-ivory-300/30 bg-white/5 px-5 py-3 text-sm font-semibold text-ivory-100 backdrop-blur hover:bg-white/10"
                  >
                    See pricing plans
                  </Link>
                </div>
              </div>
              <div className="col-span-2 space-y-3">
                <OwnerPerk revealIndex={1} Icon={Shield} text="Verified payments via Cashfree" />
                <OwnerPerk revealIndex={2} Icon={Star}   text="Premium placement at the top" />
                <OwnerPerk revealIndex={3} Icon={CheckCircle2} text="Free to list — pay only on booking" />
              </div>
            </div>
          </div>
        </section>

        {/* THE FAQ IS NOT HERE. A desktop-only accordion used to sit at this
            point AND the shared SEO block below rendered the same FAQ_ITEMS,
            so a desktop visitor scrolled past all five questions twice — and
            because both trees ship in one document, every crawler received two
            copies of the FAQPage answers no matter the viewport. The shared
            block won because it renders at every viewport with the answers
            open, which is what makes the FAQPage markup above eligible; a
            closed <details> is a weaker basis for it. The "Contact our team"
            line moved down with it. */}
      </div>

      {/* ════════════════════════════════════════════════════════
          SHARED SEO CONTENT — rendered at EVERY viewport.
          The rest of this page is split into a mobile tree (lg:hidden) and a
          desktop tree (hidden lg:block). Google indexes mobile-first, so
          anything living only in the desktop tree is display:none to the
          crawler. This block sits outside both, so the copy that explains what
          Hallnect is — and the links into the city pages — are always crawlable.
          ════════════════════════════════════════════════════════ */}
      {/* lg:max-w-3xl because this block is now the desktop FAQ as well as the
          crawlable copy, and container-app's max-w-lg left five questions in the
          mobile measure on a desktop screen. Same measure on mobile, more room
          once there is room. Override the utility, never re-type it: the class
          list lives in app/globals.css and a hand-copy silently stops tracking
          it. halls (lg:max-w-7xl), wedding-halls/[city] (lg:max-w-7xl) and
          booking/[id]/status (lg:max-w-xl) all override it the same way — every
          one of them WIDENS, since max-w-lg is 32rem and even xl is 36rem. */}
      <section className="container-app border-t border-border py-10 lg:max-w-3xl">
        <h2 data-reveal="up" className="font-serif text-xl font-bold text-charcoal-900">
          Wedding, party and event halls across Tamil Nadu
        </h2>
        <div data-reveal="up" style={revealDelay(1, 80)} className="mt-3 space-y-3 text-sm leading-relaxed text-charcoal-600">
          {/* "Every venue is reviewed by our team before it goes live" claimed
              more than Hallnect does. An admin does approve each listing before
              it publishes — that part is real — but Terms section 5 states we
              do not independently verify every listing detail, and nobody
              visits the venue. Saying so here is also the sentence that makes
              the "check before you commit" advice on the venue page make sense.
              Do not restore the old wording without changing the Terms first. */}
          {/* ONE PARAGRAPH. There were two, and the second ("check which dates
              are free, see the advance…") restated the How it works steps a
              screen higher. What stays is what nothing else on the page says:
              what Hallnect is, where the listings come from, and — kept
              deliberately, per Terms section 5 — that we do not verify every
              detail, so confirm with the venue before you commit. */}
          <p>
            Hallnect helps you find halls across Tamil Nadu for weddings, receptions, parties,
            meetings, conferences and more. Every listing is submitted by the venue itself and
            checked by our team before it goes live, so the photos, capacity and pricing are
            the venue&apos;s own. We don&apos;t independently verify every detail, so confirm
            the specifics with the venue before you commit.
          </p>
        </div>

        {/* "Browse by city" and "Popular searches" USED TO LIVE HERE and were
            removed as duplicates: the first repeated the city photo tiles, the
            second the occasion ticker, both higher on the same page. No
            crawlable link was lost — every /wedding-halls/<city> and
            /venues/<slug> URL they carried is still a real <a> in the server
            HTML above, rendered by CityGrid and OccasionDiscovery. Do not add
            them back to "help SEO"; a page listing the same links three times
            is what read as messy. */}

        {/* The ONLY rendering of FAQ_ITEMS on this page, and the answers the
            FAQPage JSON-LD above declares. Rendered at every viewport, in one
            place — do not move it back inside either the mobile or the desktop
            tree, and do not add a second copy.

            AN ACCORDION, NOT A WALL. Laid out flat these five answers were
            1,522px on a phone — nearly two full screens of solid text, 29% of
            the entire page, and the single biggest reason it read as messy.
            Each is now a native <details>, closed until tapped.

            WHY THIS STAYS VALID FOR THE FAQPage MARKUP. The answers are still
            in the server-rendered HTML — <details> hides them from view, not
            from the document — so they are crawlable and they are the same
            text the JSON-LD declares. Google treats content in an expandable
            section as on the page. (Separately: since August 2023 Google shows
            FAQ rich results only for government and health sites, so Hallnect
            is not eligible for the rich result either way; the markup is kept
            because it is accurate and costs nothing.)

            <details>, not a JS accordion: it works before hydration, needs no
            client component, is keyboard- and screen-reader-accessible by
            default, and cannot leave an answer stuck closed if JS fails. */}
        <div className="mt-8">
          <h3 data-reveal="up" className="font-serif text-lg font-bold text-charcoal-900">
            Frequently asked questions
          </h3>
          <div className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white">
            {FAQ_ITEMS.map((f, i) => (
              <details key={f.q} data-reveal="up" style={revealDelay(i, 60)} className="group">
                <summary
                  className={[
                    "flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3",
                    "text-sm font-semibold text-charcoal-900 transition-colors hover:bg-ivory-50",
                    // Safari draws its own disclosure triangle on <summary>;
                    // list-none removes the marker everywhere else.
                    "[&::-webkit-details-marker]:hidden",
                  ].join(" ")}
                >
                  <span>{f.q}</span>
                  <Plus
                    className="h-4 w-4 shrink-0 text-maroon-600 transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none"
                    aria-hidden
                  />
                </summary>
                <p className="px-4 pb-4 text-sm leading-relaxed text-charcoal-600">{f.a}</p>
              </details>
            ))}
          </div>
          <p data-reveal="fade" style={revealDelay(5, 90)} className="mt-4 text-sm text-charcoal-600">
            Still have questions?{" "}
            <Link href="/contact" className="text-maroon-600 underline underline-offset-2 hover:text-maroon-800">
              Contact our team
            </Link>.
          </p>
        </div>
      </section>
    </div>
  );
}

// ─── Mobile helpers ─────────────────────────────────────────────────────────

function MobileSectionTitle({ title, linkLabel, linkHref }: {
  title: string;
  linkLabel?: string;
  linkHref?: string;
}) {
  return (
    // Each mobile section heading leads its own row, so every section below the
    // fold gets a two-beat entrance instead of one flat block move.
    <div data-reveal="up" className="container-app mb-3 flex items-center justify-between">
      <h2 className="font-serif text-lg font-semibold text-charcoal-900">{title}</h2>
      {linkLabel && linkHref && (
        <Link href={linkHref} className="hit-44 text-xs font-semibold text-maroon-600 hover:underline">
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}

// ─── Desktop helpers ────────────────────────────────────────────────────────

function DesktopSectionHeader({
  eyebrow, title, blurb, linkLabel, linkHref, centered,
}: {
  eyebrow: string;
  title: string;
  blurb?: string;
  linkLabel?: string;
  linkHref?: string;
  centered?: boolean;
}) {
  return (
    // Every desktop section opens with its eyebrow/title/blurb rising, which is
    // what makes the page read as being presented section by section. Done
    // inside the helper rather than at three call sites so it cannot drift.
    <div
      data-reveal="up"
      className={centered ? "text-center" : "flex items-end justify-between gap-6"}
    >
      <div className={centered ? "mx-auto max-w-2xl" : "max-w-2xl"}>
        <span className="text-xs font-semibold uppercase tracking-widest text-gold-600">{eyebrow}</span>
        <h2 className="mt-2 font-serif text-3xl font-bold text-charcoal-900">{title}</h2>
        {blurb && <p className="mt-3 text-sm text-charcoal-600">{blurb}</p>}
      </div>
      {!centered && linkLabel && linkHref && (
        <Link href={linkHref} className="shrink-0 text-sm font-semibold text-maroon-700 hover:text-maroon-900">
          {linkLabel}
        </Link>
      )}
    </div>
  );
}

function TrustItem({ text, heroIndex }: { text: string; heroIndex?: number }) {
  return (
    <div
      {...(heroIndex === undefined ? {} : { "data-hero": "", style: heroDelay(heroIndex) })}
      className="flex items-center justify-center gap-2 whitespace-nowrap px-2 text-[13px] font-semibold text-white xl:text-sm"
    >
      {/* Solid, not outlined: a gold disc with a heavy check reads at a
          glance where the thin outline icon looked delicate on video.
          charcoal-950 on gold-300 is about 11:1. */}
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold-300 text-charcoal-950">
        <Check className="h-3 w-3" strokeWidth={3.5} aria-hidden />
      </span>
      {text}
    </div>
  );
}

function OwnerPerk({
  Icon, text, revealIndex,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  text: string;
  revealIndex?: number;
}) {
  return (
    <div
      {...(revealIndex === undefined
        ? {}
        : { "data-reveal": "right", style: revealDelay(revealIndex, 110) })}
      className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur"
    >
      <Icon className="h-5 w-5 text-gold-300" />
      <span className="text-sm font-medium text-ivory-100">{text}</span>
    </div>
  );
}

// Shown when there are no approved halls yet (e.g. a fresh deployment with only
// the example hall, or before any listings are approved). Replaces the old
// fake-hall fallback so the homepage never renders demo venues.
function EmptyVenues() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-white p-8 text-center">
      <Building2 className="mx-auto h-8 w-8 text-charcoal-300" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-charcoal-800">No venues listed yet</p>
      <p className="mt-1 text-xs text-charcoal-500">
        Approved venues appear here. Check back soon — or list yours.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href="/halls" className="rounded-xl bg-maroon-700 px-4 py-2 text-xs font-semibold text-white hover:bg-maroon-800">
          Browse all
        </Link>
        <Link href="/owner/register" className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-charcoal-700 hover:border-maroon-300">
          List your venue
        </Link>
      </div>

    </div>
  );
}
