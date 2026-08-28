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
import { AdSlot } from "@/components/ads/AdSlot";
import { HeroSearch } from "@/components/sections/HeroSearch";
import { HallCard } from "@/app/halls/_components/HallCard";
import { fetchHalls, type HallListing } from "@/lib/halls";
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

const HOW_IT_WORKS = [
  { step: "01", title: "Discover", body: "Browse verified wedding halls across Tamil Nadu with real photos, capacity, pricing and amenities." },
  { step: "02", title: "Compare",  body: "Filter by city, capacity, budget, and amenities. Check availability instantly." },
  { step: "03", title: "Book",     body: "Pay a small advance to secure your date. Settle the balance with the venue directly." },
];

const FAQ_ITEMS = [
  { q: "How do I book a venue?",
    a: "Pick a hall, choose your date and slot, then pay the advance plus the Rs 200 platform fee through Cashfree. The exact advance is shown before you pay. Your booking is confirmed once the venue owner accepts it." },
  { q: "Is the advance payment refundable?",
    a: "It depends when you cancel: the full advance is refundable more than 30 days before the event, and partially up to 7 days before. The Rs 200 platform fee is non-refundable on customer cancellations." },
  { q: "Can I see the venue before booking?",
    a: "Yes. We strongly recommend visiting in person. Contact details for the venue owner are shared once a booking is confirmed." },
  { q: "How much does Hallnect charge?",
    a: "You pay the venue advance plus a flat platform fee of Rs 200 at checkout, shown clearly before you pay. There are no other charges from Hallnect." },
  { q: "I'm a venue owner — how do I list?",
    a: "Register as an owner, complete your business profile, and submit your venue for approval. Listings are reviewed within 48 hours." },
];

export const metadata: Metadata = buildMetadata({
  title: "Wedding Halls & Marriage Halls in Tamil Nadu",
  description:
    "Find and book verified wedding halls, marriage halls and event venues across Tamil Nadu. " +
    "Compare real photos, capacity, pricing and availability, then reserve your date online.",
  path: "/",
});

export default async function HomePage() {
  // Featured = real APPROVED halls from Supabase (RLS-filtered), top-rated first.
  // No fake/demo halls — empty list renders a proper empty state, so cards can
  // never link to a slug that 404s.
  // Default sort, NOT sort:"rating". fetchHalls's default orders pro →
  // premium → rest before rating, which is the "Homepage promotion" the Pro
  // plan is sold on. Sorting by rating alone quietly ignored premium tier, so
  // owners paid Rs9,999/month for placement the homepage never gave them.
  const featured: HallListing[] = (await fetchHalls({})).slice(0, 6);
  const cities = POPULAR_CITIES.slice(0, 8);
  // Real approved-venue counts, so the city links below point at pages that
  // actually have something on them (lib/seo/cities.ts).
  const advancePercent = await getAdvancePercent();
  const cityInventory = await fetchCityInventory();
  const citiesWithVenues = cityInventory.filter((c) => c.venueCount > 0);

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

        <section className="container-app pt-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-maroon-500">Welcome</p>
              {/* THE page H1. Google indexes mobile-first, so the keyword- and
                  location-bearing heading must live in the MOBILE tree — the
                  desktop hero below is display:none to Googlebot. */}
              <h1 className="mt-1 font-serif text-2xl font-bold text-charcoal-900">
                Wedding Halls &amp; Marriage Halls in Tamil Nadu
              </h1>
            </div>
          </div>
          <HomeLocation />
        </section>

        <section className="container-app mt-4">
          <HomeSearchEntry />
        </section>

        <section className="container-app mt-4">
          <AdSlot placement="homepage_banner" limit={1} />
        </section>

        <section className="container-app mt-5">
          <div className="grid grid-cols-3 gap-2">
            <QuickAction href="/halls" label="Browse" Icon={Search} />
            <QuickAction href="/halls?category=premium" label="Premium" Icon={Crown} />
          </div>
        </section>

        <section className="mt-7">
          <MobileSectionTitle title="Categories" />
          <CategoryRow categories={CATEGORIES.map((c) => ({ ...c, iconNode: CATEGORY_ICONS[c.icon] }))} />
        </section>

        <section className="mt-7">
          <MobileSectionTitle title="Featured Venues" linkLabel="See all" linkHref="/halls" />
          {featured.length === 0 ? (
            <div className="container-app"><EmptyVenues /></div>
          ) : (
            <div className="no-scrollbar overflow-x-auto">
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

        <section className="mt-7 pb-6">
          <MobileSectionTitle title="Popular Cities" linkLabel="See all" linkHref="/halls" />
          <CitiesRow cities={cities} />
        </section>
      </div>

      {/* ════════════════════════════════════════════════════════
          DESKTOP — premium adaptive layout (hidden lg:block)
          ════════════════════════════════════════════════════════ */}
      <div className="hidden lg:block">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-hero-gradient">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 20%, white 1px, transparent 1px), radial-gradient(circle at 80% 60%, white 1px, transparent 1px)",
              backgroundSize: "50px 50px",
            }}
          />

          <div className="container-page relative py-20 xl:py-24">
            <div className="mx-auto max-w-3xl text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-400/40 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-gold-300 backdrop-blur">
                <Sparkles className="h-3 w-3" /> India&apos;s Premium Wedding Venue Marketplace
              </span>
              {/* Visually the desktop hero headline, but NOT an <h1>: the
                  homepage already emits its H1 in the mobile tree above, and
                  two H1s in one document is what a crawler actually receives
                  (both trees ship in the same HTML). */}
              <p className="mt-5 font-serif text-5xl font-bold leading-tight text-ivory-100 xl:text-6xl">
                Find the venue that makes your day{" "}
                <span className="bg-gradient-to-r from-gold-300 to-gold-500 bg-clip-text text-transparent">
                  unforgettable
                </span>
              </p>
              <p className="mx-auto mt-5 max-w-xl text-base text-ivory-300/90">
                Discover, compare, and book verified wedding halls across Tamil Nadu.
                Transparent pricing, real photos, and a clear answer from the venue.
              </p>
            </div>

            {/* Search */}
            <div className="mt-10 flex justify-center">
              <HeroSearch />
            </div>

            {/* Trust strip — honest launch-stage messaging (no fabricated numbers) */}
            <div className="mt-10 grid grid-cols-2 gap-4 border-t border-white/10 pt-8 sm:grid-cols-4">
              <TrustItem text="Launching in Tamil Nadu" />
              <TrustItem text="Verified listings only" />
              <TrustItem text="Secure booking flow" />
              <TrustItem text="Owner-approved venues" />
            </div>
          </div>
        </section>

        {/* ── Categories strip ─────────────────────────────────── */}
        <section className="container-page py-12">
          <div className="grid grid-cols-4 gap-4 xl:grid-cols-8">
            {CATEGORIES.map((c) => (
              <Link
                key={c.key}
                href={c.href}
                className="group flex flex-col items-center gap-2 rounded-2xl border border-border bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-maroon-300 hover:shadow-card"
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
        <section className="container-page pb-4">
          <AdSlot placement="homepage_banner" limit={1} />
        </section>

        {/* ── Featured venues grid ─────────────────────────────── */}
        <section className="container-page py-12">
          <DesktopSectionHeader
            eyebrow="Hand-picked"
            title="Featured Venues"
            blurb="Promoted halls with verified photography and transparent pricing."
            linkLabel="Browse all venues →"
            linkHref="/halls"
          />
          {featured.length === 0 ? (
            <div className="mt-8"><EmptyVenues /></div>
          ) : (
            <div className="mt-8 grid grid-cols-2 gap-6 xl:grid-cols-3">
              {featured.map((h) => (
                <HallCard key={h.id} hall={h} advancePercent={advancePercent} />
              ))}
            </div>
          )}
        </section>

        {/* ── Popular cities ───────────────────────────────────── */}
        <section className="container-page py-12">
          <DesktopSectionHeader
            eyebrow="By location"
            title="Popular Cities"
            blurb="Explore wedding venues in India's most-loved wedding destinations."
          />
          <div className="mt-8 grid grid-cols-4 gap-4">
            {cities.map((c) => (
              <Link
                key={c.name}
                href={`/halls?city=${encodeURIComponent(c.name)}`}
                className="group relative h-44 overflow-hidden rounded-2xl shadow-card transition-transform hover:-translate-y-1 hover:shadow-card-hover"
                style={{ background: c.gradient }}
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
              {HOW_IT_WORKS.map((s) => (
                <div key={s.step} className="relative rounded-2xl border border-border bg-ivory-50 p-7 transition-shadow hover:shadow-card">
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
              <div className="col-span-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-gold-300">
                  <Crown className="h-3 w-3" /> For Venue Owners
                </span>
                <h2 className="mt-4 font-serif text-3xl font-bold text-ivory-100 xl:text-4xl">
                  List your wedding hall on Hallnect
                </h2>
                <p className="mt-3 max-w-lg text-sm text-ivory-300/90">
                  List your hall in minutes. Get verified bookings with secure payments and a dedicated owner dashboard.
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
                <OwnerPerk Icon={Shield} text="Verified payments via Cashfree" />
                <OwnerPerk Icon={Star}   text="Premium placement at the top" />
                <OwnerPerk Icon={CheckCircle2} text="Free to list — pay only on booking" />
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────── */}
        <section className="bg-white">
          <div className="container-page py-16">
            <div className="mx-auto grid max-w-5xl grid-cols-5 gap-12">
              <div className="col-span-2">
                <span className="text-xs font-semibold uppercase tracking-widest text-gold-600">Help</span>
                <h2 className="mt-2 font-serif text-3xl font-bold text-charcoal-900">Frequently asked questions</h2>
                <p className="mt-3 text-sm text-charcoal-600">
                  Still have questions?{" "}
                  <Link href="/contact" className="text-maroon-600 underline underline-offset-2 hover:text-maroon-800">
                    Contact our team
                  </Link>.
                </p>
              </div>
              <div className="col-span-3 space-y-3">
                {FAQ_ITEMS.map((f) => (
                  <details
                    key={f.q}
                    className="group rounded-xl border border-border bg-ivory-50 px-5 py-4 transition-colors hover:border-maroon-300"
                  >
                    <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-charcoal-900 marker:hidden">
                      {f.q}
                      <span className="text-maroon-600 transition-transform group-open:rotate-45">+</span>
                    </summary>
                    <p className="mt-3 text-sm leading-relaxed text-charcoal-600">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ════════════════════════════════════════════════════════
          SHARED SEO CONTENT — rendered at EVERY viewport.
          The rest of this page is split into a mobile tree (lg:hidden) and a
          desktop tree (hidden lg:block). Google indexes mobile-first, so
          anything living only in the desktop tree is display:none to the
          crawler. This block sits outside both, so the copy that explains what
          Hallnect is — and the links into the city pages — are always crawlable.
          ════════════════════════════════════════════════════════ */}
      <section className="container-app border-t border-border py-10">
        <h2 className="font-serif text-xl font-bold text-charcoal-900">
          Wedding halls and marriage halls across Tamil Nadu
        </h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-charcoal-600">
          <p>
            Hallnect is a booking platform for wedding halls, marriage halls, reception
            venues and banquet halls in Tamil Nadu. Every venue is reviewed by our team
            before it goes live, so the photos, seating capacity and pricing you compare
            are the venue&apos;s own — not a stock listing.
          </p>
          <p>
            Check which dates are free, see the advance payable before you commit, and
            reserve online. The balance is settled directly with the venue, and booking
            updates reach you on WhatsApp at every step.
          </p>
        </div>

        {citiesWithVenues.length > 0 && (
          <div className="mt-6">
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

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-charcoal-900">Popular searches</h3>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {CATEGORIES.slice(0, 6).map((c) => (
              <li key={c.key}>
                <Link href={c.href} className="text-maroon-700 underline-offset-2 hover:underline">
                  {c.label} in Tamil Nadu
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* The FAQ answers that the FAQPage JSON-LD above declares. Visible at
            every viewport, which is what makes the markup eligible. */}
        <div className="mt-8">
          <h3 className="font-serif text-lg font-bold text-charcoal-900">
            Frequently asked questions
          </h3>
          <dl className="mt-3 space-y-4">
            {FAQ_ITEMS.map((f) => (
              <div key={f.q}>
                <dt className="text-sm font-semibold text-charcoal-900">{f.q}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-charcoal-600">{f.a}</dd>
              </div>
            ))}
          </dl>
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
    <div className="container-app mb-3 flex items-center justify-between">
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
    <div className={centered ? "text-center" : "flex items-end justify-between gap-6"}>
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

function TrustItem({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 text-center text-sm font-medium text-ivory-200">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-gold-300" aria-hidden />
      {text}
    </div>
  );
}

function OwnerPerk({ Icon, text }: { Icon: React.ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
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
