import Link from "next/link";
import {
  Building2, CheckCircle2, Crown, Heart, MapPin, PartyPopper,
  Search, Shield, Sparkles, Star, Wallet, Zap,
} from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { HomeLocation } from "./_components/HomeLocation";
import { HomeSearchEntry } from "./_components/HomeSearchEntry";
import { CategoryRow } from "./_components/CategoryRow";
import { CitiesRow } from "./_components/CitiesRow";
import { POPULAR_CITIES } from "@/lib/content";
import { getAdvancePercent } from "@/lib/platform-settings";
import { todayInBusinessTz } from "@/lib/dates";
import { platformFeeDisclosure } from "@/lib/booking-payment";
import { AdSlot } from "@/components/ads/AdSlot";
import { heroDelay, revealDelay } from "@/lib/motion";
import { HeroSearch } from "@/components/sections/HeroSearch";
import { HeroVideo } from "@/components/sections/HeroVideo";
import { HERO_VIDEO } from "@/lib/hero-video";

/** The mobile title block sits on the video, so its text has to invert with it. */
const HERO_ON_DARK = HERO_VIDEO.ENABLED;
import { HallCard } from "@/app/halls/_components/HallCard";
import { countActivePremiumHalls, fetchHalls, type HallListing } from "@/lib/halls";
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  jsonLdGraph, organizationJsonLd, websiteJsonLd, faqJsonLd,
} from "@/lib/seo/jsonld";
import { fetchCityInventory } from "@/lib/seo/cities";

const CATEGORIES = [
  { key: "wedding",   label: "Wedding Halls",   icon: "heart",      href: "/halls?category=wedding"   },
  { key: "reception", label: "Reception Halls", icon: "sparkles",   href: "/halls?category=reception" },
  { key: "party",     label: "Party Halls",     icon: "party",      href: "/halls?category=party"     },
  { key: "banquet",   label: "Banquet Halls",   icon: "building",   href: "/halls?category=banquet"   },
  { key: "budget",    label: "Budget Halls",    icon: "wallet",     href: "/halls?category=budget"    },
  { key: "premium",   label: "Premium Halls",   icon: "crown",      href: "/halls?category=premium"   },
  { key: "today",     label: "Available Today", icon: "zap",        href: "/halls?available=today"    },
] as const;

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  heart:    <Heart className="h-5 w-5" />,
  sparkles: <Sparkles className="h-5 w-5" />,
  party:    <PartyPopper className="h-5 w-5" />,
  building: <Building2 className="h-5 w-5" />,
  wallet:   <Wallet className="h-5 w-5" />,
  crown:    <Crown className="h-5 w-5" />,
  pin:      <MapPin className="h-5 w-5" />,
  zap:      <Zap className="h-5 w-5" />,
};

// Used when a city has real inventory but no hand-picked gradient in
// POPULAR_CITIES — a tile still has to look like the others.
const CITY_GRADIENT_FALLBACK = "linear-gradient(135deg,#6B1525 0%,#9B2038 100%)";

const HOW_IT_WORKS = [
  { step: "01", title: "Discover", body: "Browse wedding halls across Tamil Nadu with photos, capacity, pricing and amenities, as listed by each venue." },
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
    a: `On an online booking you pay the venue advance plus a ${platformFeeDisclosure()} at checkout, shown clearly before you pay; on a small booking the fee is capped at a quarter of the advance, and a promotional code can reduce it to zero. On an enquiry you pay Hallnect nothing at all — the venue settles its commission with us. There are no other charges from Hallnect.` },
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
  title: "Wedding Halls & Marriage Halls in Tamil Nadu | Hallnect",
  description:
    "Find and book wedding halls, marriage halls and event venues across Tamil Nadu. " +
    "Compare owner-submitted photos, capacity and pricing, then reserve online.",
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
  const [featuredAll, advancePercent, cityInventory, premiumCount] = await Promise.all([
    fetchHalls({}),
    getAdvancePercent(),
    fetchCityInventory(),
    countActivePremiumHalls(),
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

  // 2. PREMIUM ENTRY POINTS. The quick action and the category tile linked to
  //    /halls?category=premium, which returns nothing while no hall holds a
  //    tier. Hidden until there is inventory; they return on their own the
  //    moment an owner buys a plan.
  //    Fetched with the batch at the top of this function, not here — awaiting
  //    it at its point of use made it a fifth serial round trip to Sydney.
  const visibleCategories = premiumCount > 0
    ? [...CATEGORIES]
    : CATEGORIES.filter((c) => c.key !== "premium");
  const popularSearches = visibleCategories.filter((c) => c.key !== "today").slice(0, 6);

  // 3. POPULAR CITIES. This strip rendered POPULAR_CITIES — a static list of
  //    eight ambitions — so seven of the eight tiles led to an empty search.
  //    It is now driven by the same live inventory as the "Browse by city"
  //    links, and the whole section disappears when nothing is listed
  //    anywhere. POPULAR_CITIES survives only as the gradient palette.
  const cities = citiesWithVenues.slice(0, 8).map((c) => ({
    name:     c.city,
    state:    "Tamil Nadu",
    gradient: POPULAR_CITIES.find((p) => p.name === c.city)?.gradient ?? CITY_GRADIENT_FALLBACK,
    slug:     c.slug,
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
            The video sits behind the H1, the city picker and the search entry,
            and stops there. Deliberately NOT the 100dvh treatment the desktop
            hero gets: this tree is an app shell, and a full-screen hero would
            push the search entry — the most used control on the phone
            homepage — below the fold on every device.

            Nothing here is scroll-linked — the video simply sits
            behind the copy and stays put. */}
        <section
          className={
            HERO_VIDEO.ENABLED ? "relative overflow-hidden bg-charcoal-950 pb-5" : "relative"
          }
        >
          {HERO_VIDEO.ENABLED && (
            <HeroVideo sources={HERO_VIDEO.sources} />
          )}

        <div className="container-app relative pt-3">
          <div data-hero style={heroDelay(0)} className="flex items-end justify-between gap-3">
            <div>
              {/* WHITE, NOT GOLD, over the video — measured, not taste. At
                  12px/600 this is normal text and needs 4.5:1; against the
                  95th-percentile brightest pixel of this band under a 35%
                  scrim, gold-300 gives 3.13:1 and even gold-100 only 4.41:1.
                  White gives 4.91:1. The gold accent survives on the desktop
                  headline, where the type is large enough to carry it. */}
              <p
                className={`text-xs font-semibold uppercase tracking-widest ${
                  HERO_ON_DARK ? "hero-ink text-white" : "text-maroon-500"
                }`}
              >
                Welcome
              </p>
              {/* THE page H1. Google indexes mobile-first, so the keyword- and
                  location-bearing heading must live in the MOBILE tree — the
                  desktop hero below is display:none to Googlebot. */}
              <h1
                className={`mt-1 font-serif text-2xl font-bold ${
                  HERO_ON_DARK ? "hero-ink text-ivory-100" : "text-charcoal-900"
                }`}
              >
                Wedding Halls &amp; Marriage Halls in Tamil Nadu
              </h1>
            </div>
          </div>
          {/* Real service areas that actually have venues, and the picker now
              navigates. See app/_components/HomeLocation.tsx. */}
          {/* Still no `data-reveal` here, but the reason has changed and the
              old note was misleading enough to be worth correcting. It used to
              be load-bearing: BottomSheet rendered its fixed backdrop and panel
              INLINE, so any transform on this wrapper became their containing
              block and the city picker opened inside this strip instead of over
              the screen. The sheet now portals to <body> (commit 84f0e69), so a
              transform here can no longer reach it.

              It stays off because this block is above the fold on every phone
              and a scroll reveal is the wrong tool for that — the `data-hero`
              keyframe above is the right one. Not because it would break. */}
          <HomeLocation cities={citiesWithVenues} onDark={HERO_ON_DARK} />
        </div>

        {/* Above the fold on every phone: a CSS keyframe, never a scroll
            reveal. See the note on the title block above. */}
        <div data-hero style={heroDelay(1)} className="container-app relative mt-4">
          <HomeSearchEntry />
        </div>
        </section>

        <section data-reveal="fade" className="container-app mt-4">
          <AdSlot placement="homepage_banner" limit={1} />
        </section>

        {/* Column count follows the number of tiles: a grid-cols-3 holding one
            or two tiles left a visible hole once the Premium action was gated. */}
        <section data-hero style={heroDelay(2)} className="container-app mt-5">
          <div className={`grid gap-2 ${premiumCount > 0 ? "grid-cols-3" : "grid-cols-2"}`}>
            <QuickAction href="/halls" label="Browse" Icon={Search} />
            <QuickAction href="/halls?available=today" label="Free today" Icon={Zap} />
            {premiumCount > 0 && (
              <QuickAction href="/halls?category=premium" label="Premium" Icon={Crown} />
            )}
          </div>
        </section>

        <section className="mt-7">
          <MobileSectionTitle title="Categories" />
          <CategoryRow categories={visibleCategories.map((c) => ({ ...c, iconNode: CATEGORY_ICONS[c.icon] }))} />
        </section>

        <section className="mt-7">
          <MobileSectionTitle
            title={hasPromoted ? "Featured Venues" : "Venues on Hallnect"}
            linkLabel="See all"
            linkHref="/halls"
          />
          {featured.length === 0 ? (
            <div data-reveal="up" style={revealDelay(1, 120)} className="container-app"><EmptyVenues /></div>
          ) : (
            <div data-reveal="up" style={revealDelay(1, 120)} className="no-scrollbar overflow-x-auto">
              <div className="flex w-max gap-3 px-4 pb-1 sm:px-6">
                {featured.map((h) => (
                  <div key={h.id} className="w-64 shrink-0">
                    <HallCard hall={h} advancePercent={advancePercent} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {cities.length > 0 && (
          <section className="mt-7 pb-6">
            <MobileSectionTitle title="Cities with venues" linkLabel="See all" linkHref="/halls" />
            <CitiesRow cities={cities} />
          </section>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════
          DESKTOP — premium adaptive layout (hidden lg:block)
          ════════════════════════════════════════════════════════ */}
      <div className="hidden lg:block">
        {/* ── Hero ─────────────────────────────────────────────────────────
            STATIC. No parallax, no scroll-linked transforms, no entrance
            stagger — a plain full-screen block with a video behind it.

            `-mt-16 pt-16` pulls the section up under the (sticky, transparent)
            64px header so the video runs behind it, then puts the space back
            as padding so the copy is not underneath the nav links.

            NO `overflow-hidden` ON THIS SECTION. The search pill deliberately
            hangs half-way out of the bottom edge; clipping here would cut it in
            half. HeroVideo clips itself instead.                            */}
        {/* HEIGHT IS 100dvh MINUS 3rem, AND THAT IS NOT A ROUNDING ERROR.
            At exactly 100dvh the hero's bottom edge IS the fold, so a pill
            straddling that edge puts half the search bar — the primary action
            on the page — below the screen. Measured at 1746x894: pill top 858,
            bottom 931, i.e. 36px of 72px visible. Pulling the section up by
            3rem lands the whole pill on screen while it still overhangs into
            the section below by half its height, which is the look asked for.  */}
        <section className="relative -mt-16 flex min-h-[calc(100dvh-3rem)] flex-col justify-center bg-charcoal-950 pt-16">
          <HeroVideo sources={HERO_VIDEO.sources} />

          <div className="container-page relative w-full pb-32 pt-8">
            <div className="mx-auto max-w-4xl text-center">
              <span className="hero-ink inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-white backdrop-blur">
                <Sparkles className="h-3 w-3" /> Wedding Venues across Tamil Nadu
              </span>

              {/* Visually the desktop headline, but NOT an <h1>: the homepage
                  emits its H1 in the mobile tree above, and both trees ship in
                  the same HTML, so a second one is what a crawler receives. */}
              {/* Hallnect's own line, and written to do a job: it names the
                  promise the search pill directly below it delivers — a hall
                  that is actually free when you need it — rather than restating
                  "wedding venues in Tamil Nadu", which the badge above and the
                  subhead below already say twice between them.

                  gold-200 rather than the usual gold-300 accent. Measured
                  against the 95th-percentile brightest pixel of this band under
                  the 29% scrim: gold-300 gives 3.54:1 and gold-200 gives
                  4.26:1, against a 3.0 bar for 56px bold. 3.54 is only 18%
                  above the floor, and the poster is a single frame — brighter
                  frames in the clip would eat that margin. The highlight now
                  carries a whole clause rather than one word, so it earns the
                  safer tone. */}
              <p className="hero-ink mt-6 font-sans text-5xl font-bold leading-[1.1] tracking-tight text-white xl:text-6xl">
                The hall you want,
                <br className="hidden sm:block" />{" "}
                on <span className="text-gold-200">the date you need</span>
              </p>

              <p className="hero-ink mx-auto mt-6 max-w-2xl text-base text-white/90 xl:text-lg">
                Discover, compare, and book wedding halls across Tamil Nadu.
                Owner-submitted listings, transparent pricing, and a clear answer from the venue.
              </p>
            </div>

            {/* Trust strip — honest launch-stage messaging (no fabricated numbers) */}
            <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-4 border-t border-white/15 pt-8 sm:grid-cols-4">
              <TrustItem text="Launching in Tamil Nadu" />
              <TrustItem text="Owner-submitted listings" />
              <TrustItem text="Secure booking flow" />
              <TrustItem text="Owner-approved venues" />
            </div>
          </div>

          {/* The pill straddles the bottom edge: half on the video, half on the
              section below. `translate-y-1/2` rather than a negative margin so
              it takes no layout space here — the section beneath owns the
              clearance (see its pt-*). */}
          <div className="absolute inset-x-0 bottom-0 z-20 translate-y-1/2 px-6">
            <div className="flex justify-center">
              <HeroSearch cities={citiesWithVenues.map((c) => c.city)} today={today} />
            </div>
          </div>
        </section>

        {/* ── Categories strip ─────────────────────────────────── */}
        {/* pt-28, not py-12: the hero's search pill overhangs into this section
            and would otherwise sit on top of the first row of category tiles. */}
        <section className="container-page pb-12 pt-28">
          <div className="grid grid-cols-4 gap-4 xl:grid-cols-8">
            {visibleCategories.map((c, i) => (
              <Link
                key={c.key}
                href={c.href}
                data-reveal="scale"
                style={revealDelay(i, 60)}
                className="group flex flex-col items-center gap-2 rounded-2xl border border-border bg-white p-4 transition-all hover:-translate-y-1 hover:border-maroon-300 hover:shadow-card-hover"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-maroon-50 text-maroon-600 transition-colors group-hover:bg-maroon-100">
                  {CATEGORY_ICONS[c.icon]}
                </span>
                <span className="text-center text-xs font-semibold text-charcoal-800">{c.label}</span>
              </Link>
            ))}
          </div>
        </section>

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

        {/* ── Cities with venues ───────────────────────────────── */}
        {/* Was "Popular Cities" over a static list of eight Tamil Nadu cities,
            seven of which had no inventory — every tile promised venues and
            delivered an empty search. Driven by the live count now, and gone
            entirely when nothing is listed. The blurb also claimed "India's
            most-loved wedding destinations" while Hallnect serves one state. */}
        {cities.length > 0 && (
        <section className="container-page py-12">
          <DesktopSectionHeader
            eyebrow="By location"
            title="Cities with venues"
            blurb="Tamil Nadu cities where halls are listed and taking bookings today."
          />
          <div className="mt-8 grid grid-cols-4 gap-4">
            {cities.map((c, i) => (
              <Link
                key={c.name}
                href={`/wedding-halls/${c.slug}`}
                data-reveal="scale"
                className="group relative h-44 overflow-hidden rounded-2xl shadow-card transition-transform hover:-translate-y-1.5 hover:shadow-card-hover"
                style={{ background: c.gradient, ...revealDelay(i, 70) }}
              >
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/20 to-transparent" />
                <div className="absolute inset-x-4 bottom-4 text-white">
                  <p className="font-serif text-lg font-bold">{c.name}</p>
                  <p className="text-xs text-white/80">{c.state}</p>
                </div>
                <div className="absolute right-3 top-3 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                  Explore →
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
                  List your wedding hall on Hallnect
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
          Wedding halls and marriage halls across Tamil Nadu
        </h2>
        <div data-reveal="up" style={revealDelay(1, 80)} className="mt-3 space-y-3 text-sm leading-relaxed text-charcoal-600">
          {/* "Every venue is reviewed by our team before it goes live" claimed
              more than Hallnect does. An admin does approve each listing before
              it publishes — that part is real — but Terms section 5 states we
              do not independently verify every listing detail, and nobody
              visits the venue. Saying so here is also the sentence that makes
              the "check before you commit" advice on the venue page make sense.
              Do not restore the old wording without changing the Terms first. */}
          <p>
            Hallnect is a booking platform for wedding halls, marriage halls, reception
            venues and banquet halls in Tamil Nadu. Listings are written and submitted by
            the venue owners themselves and checked by our team before they go live, so
            the photos, seating capacity and pricing you compare are the venue&apos;s own —
            not a stock listing. We do not independently verify every listing detail, so
            confirm the specifics with the venue before you commit.
          </p>
          <p>
            Check which dates are free, see the advance payable before you commit, and
            reserve online. The balance is settled directly with the venue, and every booking
            update is on your Hallnect bookings page.
          </p>
        </div>

        {citiesWithVenues.length > 0 && (
          <div data-reveal="up" className="mt-6">
            <h3 className="text-sm font-semibold text-charcoal-900">Browse by city</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {citiesWithVenues.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/wedding-halls/${c.slug}`}
                    className="inline-block rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-charcoal-700 transition hover:border-maroon-300 hover:text-maroon-700"
                  >
                    Wedding halls in {c.city}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div data-reveal="up" style={revealDelay(1, 80)} className="mt-6">
          <h3 className="text-sm font-semibold text-charcoal-900">Popular searches</h3>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {popularSearches.map((c) => (
              <li key={c.key}>
                <Link href={c.href} className="text-maroon-700 underline-offset-2 hover:underline">
                  {c.label} in Tamil Nadu
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* The ONLY rendering of FAQ_ITEMS on this page, and the answers the
            FAQPage JSON-LD above declares. Visible at every viewport, which is
            what makes the markup eligible — do not move it back inside either
            the mobile or the desktop tree, and do not add a second copy. */}
        <div className="mt-8">
          <h3 data-reveal="up" className="font-serif text-lg font-bold text-charcoal-900">
            Frequently asked questions
          </h3>
          <dl className="mt-3 space-y-4">
            {FAQ_ITEMS.map((f, i) => (
              <div key={f.q} data-reveal="up" style={revealDelay(i, 90)}>
                <dt className="text-sm font-semibold text-charcoal-900">{f.q}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-charcoal-600">{f.a}</dd>
              </div>
            ))}
          </dl>
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
        <Link href={linkHref} className="text-xs font-semibold text-maroon-600 hover:underline">
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}

function QuickAction({ href, label, Icon }: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-1.5 rounded-2xl bg-white py-3 shadow-card transition-transform active:scale-95"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-maroon-50 text-maroon-600">
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-[11px] font-semibold text-charcoal-800">{label}</span>
    </Link>
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
      className="flex items-center justify-center gap-2 text-center text-sm font-medium text-ivory-200"
    >
      <CheckCircle2 className="h-4 w-4 shrink-0 text-gold-300" aria-hidden />
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
