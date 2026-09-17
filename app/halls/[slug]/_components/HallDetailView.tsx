"use client";

import { TIER_LABEL } from "@/lib/plan-names";
import { useEffect } from "react";
import { HARD_BLOCK_STATUSES, PARTIAL_BLOCK_STATUSES } from "@/lib/availability-status";
import { useLiveAvailability } from "@/lib/useLiveAvailability";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, Accessibility, Calendar, Car,
  ChefHat, ExternalLink, MapPin, MonitorPlay, Music,
  Share2, Snowflake, Sparkles, Star, TreePine, Users,
  Waves, Zap, Info,
} from "lucide-react";
import { type HallDetail, type HallListing, type AvailabilityRow } from "@/lib/halls";
// From lib/venue-types, NOT lib/halls: this is a Client Component, and
// lib/halls opens a database client.
import { venueTypesSentence } from "@/lib/venue-types";
import { CARD_GRADIENTS, formatPrice } from "@/lib/mock-data";
import {
  formatHallPrice, hasPrice, isLeadGeneration,
  primaryCtaHref, primaryCtaLabel, PRICE_ON_REQUEST,
} from "@/lib/booking-mode";
import {
  todayInBusinessTz, addDaysToIsoDate, isoDateToLabelDate,
  formatDateInBusinessTz, formatIsoDateLabel,
} from "@/lib/dates";
import {
  advanceFromTotal, DEFAULT_ADVANCE_PERCENT,
  cappedPlatformFeeRupees, platformFeeGstRupees, PLATFORM_FEE_GST_PERCENT,
} from "@/lib/booking-payment";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SaveHeart } from "@/app/_components/SaveHeart";
import { recordRecentlyViewed } from "@/app/_components/RecentlyViewed";
import { ImageGallery } from "./ImageGallery";

// ── Amenity icon map (keyed by DB slug) ──────────────────────────────────────

const AMENITY_ICONS: Record<string, React.ReactNode> = {
  "air-conditioning":  <Snowflake     className="h-5 w-5" />,
  "valet-parking":     <Car           className="h-5 w-5" />,
  "free-parking":      <Car           className="h-5 w-5" />,
  "in-house-catering": <ChefHat       className="h-5 w-5" />,
  "dj-music":          <Music         className="h-5 w-5" />,
  "outdoor-garden":    <TreePine      className="h-5 w-5" />,
  "bridal-suite":      <Sparkles      className="h-5 w-5" />,
  "swimming-pool":     <Waves         className="h-5 w-5" />,
  "generator-backup":  <Zap           className="h-5 w-5" />,
  "in-house-decor":    <Sparkles      className="h-5 w-5" />,
  "av-stage-setup":    <MonitorPlay   className="h-5 w-5" />,
  "wheelchair-access": <Accessibility className="h-5 w-5" />,
};

// ── Hallnect's standard rules ────────────────────────────────────────────────
// These are PLATFORM rules, identical for every venue — there is no per-hall
// rules column. They were headed "Hallnect Standard Venue Rules", which read as though
// each owner had written them, so a customer could believe they had checked a
// specific venue's terms when they had not. The heading now says whose they are.

const VENUE_RULES = [
  "Venue must be vacated by the end of the booked slot",
  "Outside food and beverages require prior written approval",
  "Wall and ceiling decorations must be approved in advance",
  "Music / DJ must conclude by 10:00 PM (local noise ordinance)",
  "Parking guidelines must be followed at all times",
  "No smoking inside the hall or adjacent corridors",
  "Any damage to property will be charged to the booking party",
  "Pets are not permitted inside the venue",
];

// ── Availability calendar helpers ─────────────────────────────────────────────

type DayStatus = "available" | "partial" | "unavailable";

// COLOUR IS NOT A SIGNAL ON ITS OWN. The tiles below differ only by background
// (maroon / amber / red), which is invisible to roughly one man in twelve and
// to every screen reader. These words go into each tile's accessible name, the
// way the owner-side InventoryCalendar names its day cells. They are the same
// words as the legend under the strip — keep the two in step.
const DAY_STATUS_TEXT: Record<DayStatus, string> = {
  available:   "Available",
  partial:     "Partially booked",
  unavailable: "Fully booked",
};

// Imported, not redeclared. These two Sets were a stale copy: `offline_booked`
// (migration 0056) was missing from FULL_BLOCK, so a date a venue had blocked
// for a phone booking rendered GREEN on the public page — measured, with live
// offline_booked rows sitting in the table.
//
// lib/availability-status.ts deliberately imports nothing, so a client
// component can share the vocabulary with the server instead of restating it.

function getDayStatus(dateStr: string, rows: AvailabilityRow[]): DayStatus {
  const matching = rows.filter((r) => r.date === dateStr);
  if (matching.length === 0) return "available";
  const statuses = matching.map((r) => r.status);
  if (statuses.some((s) => HARD_BLOCK_STATUSES.has(s)))    return "unavailable";
  if (statuses.some((s) => PARTIAL_BLOCK_STATUSES.has(s))) return "partial";
  return "available";
}

// ── Review timestamps ─────────────────────────────────────────────────────────

/**
 * The month a review was written, as a hydration-safe label.
 *
 * THE BUG: this was `new Date(r.created_at).toLocaleDateString("en-IN", …)`
 * with no timeZone, inside a "use client" component that Next also renders on
 * the server. The server resolves the month against UTC and the visitor's
 * browser against IST, so a review written in the last 5h30m of a month came
 * out as two different months and React reported a hydration mismatch.
 *
 * The instant is now pinned to the business timezone — the date the review was
 * actually written, in the market it was written in — and then formatted from
 * its ISO parts, so both renders produce the same characters.
 *
 * Returns "" rather than throwing on a timestamp that will not parse:
 * Intl.DateTimeFormat.format(Invalid Date) raises a RangeError, where the old
 * toLocaleDateString merely printed "Invalid Date". A bad row must not take the
 * whole venue page down.
 */
function reviewMonthLabel(createdAt: string): string {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return "";
  return formatIsoDateLabel(formatDateInBusinessTz(at), { month: "short", year: "numeric" });
}

// ── Gradient fallback for similar halls ───────────────────────────────────────

function gradientForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return CARD_GRADIENTS[Math.abs(hash) % CARD_GRADIENTS.length];
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  /** Live advance % from platform_settings; falls back to the constant. */
  advancePercent?: number;
  hall:        HallDetail;
  similar:     HallListing[];
  isPreview:   boolean;
  sidebarAd?:  React.ReactNode;
  /**
   * Slug of this venue's city landing page.
   *
   * Passed in rather than derived here: citySlug lives in lib/seo/cities.ts,
   * which is "server-only", and this is a Client Component. The page already
   * computes the same value for the BreadcrumbList, so passing it guarantees
   * the visible breadcrumb and the structured data name the same URL — which
   * is the whole point of rendering one.
   */
  citySlug:    string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HallDetailView({ hall, similar, isPreview, sidebarAd, advancePercent, citySlug }: Props) {
  const router = useRouter();

  useEffect(() => { recordRecentlyViewed(hall.id); }, [hall.id]);

  // This page SHOWS a 30-day availability strip, so it has to watch it. Only the
  // booking flow subscribed before, which meant the first screen a customer
  // actually looks at was the one most likely to be stale — someone comparing
  // venues for ten minutes was reading a snapshot from when they arrived.
  //
  // Cheap: the hook never applies the payload, it just re-reads. `availability`
  // carries no personal data, and the subscription is filtered to this hall.
  useLiveAvailability(hall.id);

  // The live advance percentage, not a hardcoded 0.25. Checkout charges the
  // configurable rate, so a page that always said "25%" would quote a figure
  // the customer is not actually asked for the moment an admin changes it.
  const advancePct    = advancePercent ?? DEFAULT_ADVANCE_PERCENT;

  // LEAD GENERATION TAKES NO ADVANCE, so there is nothing here to quote. This
  // page must not offer a payment the listing cannot accept — and beyond the
  // copy, advanceFromTotal THROWS on a null price (RangeError, "invalid
  // total"), which in a client component is a blank venue page rather than a
  // wrong number. Guard once, here, and let every price block below read these
  // booleans instead of re-deriving the condition six ways.
  const isLead        = isLeadGeneration(hall.booking_mode);
  const priced        = hasPrice(hall.price_per_day);
  // null when the owner declared no event types, in which case nothing renders.
  const typesSentence = venueTypesSentence(hall.venue_types, hall);
  const ctaHref       = primaryCtaHref(hall.booking_mode, hall.slug);
  const ctaLabel      = primaryCtaLabel(hall.booking_mode);
  const showAdvance   = priced && !isLead;
  const advanceAmount = showAdvance
    ? advanceFromTotal(hall.price_per_day as number, advancePct)
    : 0;
  const balancePct    = Math.round((100 - advancePct) * 100) / 100;

  // The fee THIS venue's customer will actually be charged, not the headline
  // figure. cappedPlatformFeeRupees bounds the flat fee at 25% of the advance,
  // so on a cheap slot the real charge is far lower — this page used to quote a
  // flat "₹200 platform fee" that was wrong in both directions at once: it
  // omitted the 18% GST that takes it to ₹236 on a normal booking, and ignored
  // the cap that takes it below ₹200 on a small one.
  const cappedFee = cappedPlatformFeeRupees(advanceAmount);
  const feeShown  = cappedFee + platformFeeGstRupees(cappedFee);
  const mapsHref = hall.latitude && hall.longitude
    ? `https://maps.google.com/?q=${hall.latitude},${hall.longitude}`
    : `https://maps.google.com/?q=${encodeURIComponent(`${hall.address ?? hall.name}, ${hall.city}`)}`;

  // Build 30-day calendar in the BUSINESS timezone (UTC math shifted every
  // date back a day for IST visitors, desyncing it from the booking flow).
  const stripStart = todayInBusinessTz();
  const calDays = Array.from({ length: 30 }, (_, i) => {
    const iso = addDaysToIsoDate(stripStart, i);
    const d = isoDateToLabelDate(iso);
    const status = getDayStatus(iso, hall.availability);
    return {
      iso,
      day:  d.getUTCDate(),
      wkd:  d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }).slice(0, 1),
      status,
      // The tile itself shows only a one-letter weekday and a number, so the
      // full date and the status have to be carried by the accessible name.
      //
      // Both forms are built because a LEAD venue names the date WITHOUT a
      // status — see the Availability section below for why it makes no
      // availability claim at all.
      dateLabel: formatIsoDateLabel(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
      label: `${formatIsoDateLabel(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} — ${DAY_STATUS_TEXT[status]}`,
    };
  });

  return (
    <div className="min-h-screen bg-ivory-100">

      {/* ── Preview / non-approved banner ─────────────────────── */}
      {isPreview && (
        <div className="flex items-center justify-center gap-2 bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>Preview mode</strong> — this hall is{" "}
            <span className="font-semibold capitalize">{hall.status.replace(/_/g, " ")}</span>.
            Only you and admins can see this page.
          </span>
        </div>
      )}

      {/* ── Hero image gallery ──────────────────────────────────
          lg:mx-auto lg:max-w-6xl lg:px-6 is a deliberate COPY of the content
          container below, so the gallery's left edge is the main column's left
          edge and its right edge is the booking card's right edge. Keeping the
          two strings identical is the point; if one changes, change both. */}
      <div className="relative lg:mx-auto lg:max-w-6xl lg:px-6">
        <ImageGallery images={hall.images} hallName={hall.name} hallCity={hall.city} hallId={hall.id} />

        {/* Overlay action bar. lg:px-10 = the wrapper's px-6 (24px) plus the
            16px inset p-4 already gives, so the buttons stay 16px inside the
            photo instead of hanging off its rounded corner. */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 lg:px-10">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 shadow-card"
          >
            <ArrowLeft className="h-4 w-4 text-charcoal-800" />
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Share"
              onClick={() => {
                if (navigator.share) {
                  navigator.share({ title: hall.name, url: window.location.href }).catch(() => {});
                } else {
                  navigator.clipboard.writeText(window.location.href).catch(() => {});
                }
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 shadow-card"
            >
              <Share2 className="h-4 w-4 text-charcoal-800" />
            </button>
            <SaveHeart hallId={hall.id} large />
          </div>
        </div>
      </div>

      {/* ── Content layout ────────────────────────────────────── */}
      <div className="lg:mx-auto lg:max-w-6xl lg:px-6">
        <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-8 lg:items-start">

          {/* ── Main content (left column) ──
              A PLAIN DIV, NOT AN ANIMATED WRAPPER, AND THAT IS THE FIX.

              This used to be a framer-motion element with an initial state of
              zero opacity and a 12px offset. That library server-renders its
              initial state, so the HTML for this page went out carrying
              `style="opacity:0;transform:translateY(12px)"` on the element that
              wraps EVERYTHING in the left column: the venue name, the price,
              the description, amenities, availability, reviews, rules, similar
              venues. If the bundle failed to load or hydration threw, all of it
              stayed invisible with nothing left to undo it — on the page this
              marketplace exists to show. Measured in the live HTML before this
              change; it was the one page in the app still shipping any hidden
              content.

              Three things improve by DELETING the animation rather than
              replacing it with the scroll-reveal layer:

              1. The column paints immediately, which is better for LCP than any
                 entrance animation on the largest text block above the fold.
              2. The motion is not lost. The ten `data-reveal` sections INSIDE
                 this wrapper already animate as the reader scrolls, which is
                 the effect that 0.25s fade was approximating — and those
                 degrade safely, because their hidden state exists only while
                 JavaScript says it may (see the contract at the bottom of
                 app/globals.css).
              3. The animation put a transform on an ancestor of the whole
                 column for its duration, and a transform is a containing block
                 for any fixed descendant. Transient, but pointless.

              This was the file's only animation-library usage, so the import
              goes with it. */}
          <div className="relative -mt-4 rounded-t-3xl bg-ivory-100 px-4 pb-36 pt-5 lg:mt-6 lg:rounded-none lg:bg-transparent lg:px-0 lg:pb-16">
            {/* Visible breadcrumb — mirrors the BreadcrumbList in
                app/halls/[slug]/page.tsx exactly, rung for rung.

                The markup already claimed this trail in structured data while
                the page rendered none of it, and the "Tamil Nadu / {city}"
                rungs were the ONLY route by which a reader or a crawler could
                get from a venue to its city landing page — there was no link
                to it anywhere on this page. Structured data that describes
                navigation the page does not offer is both a ranking risk and,
                more simply, a promise to the reader that was not kept. */}
            <nav aria-label="Breadcrumb" className="mb-2">
              <ol className="flex flex-wrap items-center gap-1 text-[11px] text-charcoal-500">
                <li><Link href="/" className="hover:text-maroon-700">Home</Link></li>
                <li aria-hidden="true">/</li>
                <li><Link href="/halls" className="hover:text-maroon-700">Tamil Nadu</Link></li>
                <li aria-hidden="true">/</li>
                <li>
                  <Link href={`/wedding-halls/${citySlug}`} className="hover:text-maroon-700">
                    {hall.city}
                  </Link>
                </li>
                <li aria-hidden="true">/</li>
                <li className="min-w-0 truncate font-medium text-charcoal-700" aria-current="page">
                  {hall.name}
                </li>
              </ol>
            </nav>

            {/* Title block */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {/* The gold tier badge is a feature owners buy; the plain
                    "Promoted" tag beside it is the disclosure that makes it
                    honest — a paid placement, not a quality rating. Same pairing
                    as HallCard; see the longer note there. */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {hall.premium_tier === "pro"     && <Badge variant="gold" size="sm">★ {TIER_LABEL.pro}</Badge>}
                  {hall.premium_tier === "premium" && <Badge variant="gold" size="sm">✦ {TIER_LABEL.premium}</Badge>}
                  {(hall.premium_tier === "premium" || hall.premium_tier === "pro") && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-charcoal-600 shadow-sm">
                      Promoted
                    </span>
                  )}
                  {isPreview       && (
                    <Badge variant="default" size="sm" className="bg-amber-100 text-amber-800 border-amber-300">
                      {hall.status.replace(/_/g, " ")}
                    </Badge>
                  )}
                </div>
                <h1 className="mt-2 font-serif text-2xl font-bold leading-tight text-charcoal-900">
                  {hall.name}
                </h1>
                <p className="mt-1 flex items-center gap-1 text-sm text-charcoal-500">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-maroon-500" />
                  {hall.city}{hall.state ? `, ${hall.state}` : ""}
                </p>
              </div>
              {hall.rating_count > 0 && (
                <div className="shrink-0 rounded-2xl bg-white px-3 py-2 text-center shadow-card">
                  <div className="flex items-center justify-center gap-1">
                    <Star className="h-4 w-4 fill-gold-500 text-gold-500" />
                    <span className="text-sm font-bold text-charcoal-900">
                      {hall.rating_average.toFixed(1)}
                    </span>
                  </div>
                  <p className="text-[10px] text-charcoal-500">{hall.rating_count} reviews</p>
                </div>
              )}
            </div>

            {/* Stat cards */}
            <div className="mt-5 grid grid-cols-3 gap-2.5">
              <StatCard
                Icon={Users}
                label="Capacity"
                value={hall.capacity_max.toLocaleString("en-IN")}
                sub={hall.capacity_min ? `min ${hall.capacity_min}` : "guests max"}
              />
              <StatCard
                Icon={Calendar}
                label="Per Day"
                value={formatHallPrice(hall.price_per_day)}
                sub={priced ? "full day" : "ask the venue"}
              />
              {showAdvance ? (
                <StatCard
                  Icon={Sparkles}
                  label="Advance"
                  value={formatPrice(advanceAmount)}
                  sub={`${advancePct}% upfront`}
                />
              ) : (
                <StatCard
                  Icon={Sparkles}
                  label="Booking"
                  value={isLead ? "Enquiry" : "Direct"}
                  sub={isLead ? "venue replies" : "pay online"}
                />
              )}
            </div>

            {/* About / Description */}
            {/* Every `mt-6` section in this left column carries `data-reveal`.
                They are plain content — description, amenities, availability,
                reviews, location, rules, similar venues — with nothing
                positioned inside them, so a transform on the wrapper is safe.
                What is NOT revealed, deliberately: the gallery wrapper above
                (it is the parent of the fixed lightbox), the sticky desktop
                booking aside, and the fixed mobile Book Now / Send Enquiry bar.
                See the note at the bottom of app/globals.css. */}
            <section data-reveal="up" className="mt-6">
              <h2 className="font-serif text-base font-semibold text-charcoal-900">About</h2>
              {/* whitespace-pre-line, because the owner's paragraphs are now
                  kept at save time (sanitizeMultiline) and HTML would otherwise
                  collapse every line break they typed.

                  NO INVENTED FALLBACK. This previously read "<name> is a premier
                  event venue in <city> with world-class amenities for every
                  celebration" for any venue with no description — an unsourced
                  claim about a real third-party business, published under their
                  name, and exactly the "templated description contradicting the
                  structured fields" the brief rules out. What replaces it is
                  built only from stored facts: the event types the owner
                  declared and the capacity they entered. */}
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-charcoal-600">
                {hall.description ??
                  [typesSentence, `It seats up to ${hall.capacity_max.toLocaleString("en-IN")} guests.`]
                    .filter(Boolean)
                    .join(" ")}
              </p>
              {/* venue_types is required of every owner, stored, indexed and
                  used as a search filter — and until now it was rendered on no
                  page a crawler could read. One sentence, in the owner's own
                  declared terms, inside the existing About section rather than
                  a new one. Absent entirely when nothing was declared. */}
              {typesSentence && (
                <p className="mt-2 text-sm leading-relaxed text-charcoal-600">{typesSentence}</p>
              )}
            </section>

            {/* Amenities */}
            {hall.amenities.length > 0 && (
              <section data-reveal="scale" className="mt-6">
                <h2 className="font-serif text-base font-semibold text-charcoal-900">Amenities</h2>
                <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {hall.amenities.map((a) => (
                    <div
                      key={a.slug}
                      className="flex flex-col items-center gap-1.5 rounded-2xl bg-white p-2.5 shadow-card"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-maroon-50 text-maroon-600">
                        {AMENITY_ICONS[a.slug] ?? <Sparkles className="h-5 w-5" />}
                      </span>
                      <span className="text-center text-[10px] font-medium leading-tight text-charcoal-700">
                        {a.name}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Owner-defined amenities — plain text, never raw HTML */}
                {hall.custom_amenities.length > 0 && (
                  <>
                    <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                      Special Amenities
                    </h3>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {hall.custom_amenities.map((name) => (
                        <li
                          key={name.toLowerCase()}
                          className="inline-flex items-center gap-1.5 rounded-full border border-gold-300 bg-gold-50 px-3 py-1.5 text-xs font-medium text-charcoal-800"
                        >
                          <Sparkles className="h-3 w-3 shrink-0 text-gold-600" aria-hidden />
                          {name}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}

            {/* Location */}
            <section data-reveal="up" className="mt-6">
              <h2 className="font-serif text-base font-semibold text-charcoal-900">Location</h2>
              <div className="mt-3 rounded-2xl bg-white p-4 shadow-card">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-maroon-50 text-maroon-600">
                    <MapPin className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-charcoal-900">{hall.name}</p>
                    {hall.address && (
                      <p className="mt-0.5 text-xs leading-relaxed text-charcoal-500">
                        {hall.address}{hall.pincode ? ` — ${hall.pincode}` : ""}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-charcoal-500">
                      {hall.city}{hall.state ? `, ${hall.state}` : ""}
                    </p>
                  </div>
                </div>

                {/* NO MAP TILE. An unconditional 128px grey box with a faded
                    pin used to sit here, shown whether or not the venue had
                    coordinates, and it read as a map that had failed to load.
                    A real map cannot be drawn either way today: the CSP is
                    `frame-src 'self' <cashfree>` with an img-src that does not
                    include Google, so both an embedded map and a static-map
                    image are blocked. Adding either is a deliberate CSP change
                    AND a Privacy section 5 amendment in the same commit — see
                    docs/update-plan.md section 3.3. Until that is decided, the
                    address plus the link below is the whole honest offering. */}

                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-maroon-600 hover:underline"
                >
                  View on Google Maps
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </section>

            {/* ── Listed by (the seller) ─────────────────────────────
                Rule 5(3)(a) of the Consumer Protection (E-Commerce) Rules 2020
                requires a marketplace to display the seller's business name and
                geographic address on the listing. This page previously showed
                only the venue's own street address, so a customer paying an
                advance could not tell which business they were contracting
                with, or where to send a notice.

                ONLY THESE THREE FIELDS. hall_owners also holds gst_number,
                pan_number and the payout bank columns; none of them may ever
                appear here. lib/halls.ts fetches exactly business_name, address
                and city — read the comment on fetchHallSeller before adding to
                it. `seller` is null when this hall has no seller record; when the
                LOOKUP failed, sellerUnavailable is set and we say so below
                rather than dropping a statutory disclosure off a page that
                otherwise looks complete. */}
            {hall.sellerUnavailable && (
              <section data-reveal="up" className="mt-6">
                <h2 className="font-serif text-base font-semibold text-charcoal-900">Listed by</h2>
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm text-amber-900">
                    Seller details could not be loaded just now. Please refresh before booking —
                    you are entitled to see who you would be contracting with.
                  </p>
                </div>
              </section>
            )}
            {hall.seller && (
              <section data-reveal="up" className="mt-6">
                <h2 className="font-serif text-base font-semibold text-charcoal-900">Listed by</h2>
                <div className="mt-3 rounded-2xl bg-white p-4 shadow-card">
                  <p className="text-sm font-semibold text-charcoal-900">
                    {hall.seller.business_name}
                  </p>
                  {(hall.seller.address || hall.seller.city) && (
                    <p className="mt-1 text-xs leading-relaxed text-charcoal-500">
                      {[hall.seller.address, hall.seller.city].filter(Boolean).join(", ")}
                    </p>
                  )}
                  <p className="mt-2 text-[11px] leading-relaxed text-charcoal-500">
                    Hallnect lists this venue on the seller&apos;s behalf. Listing details are
                    supplied by the seller and are not independently verified — confirm them
                    with the venue before you commit. The seller&apos;s contact details are
                    shared once a booking is confirmed.
                  </p>
                </div>
              </section>
            )}

            {/* Pricing breakdown */}
            <section data-reveal="up" className="mt-6">
              <h2 className="font-serif text-base font-semibold text-charcoal-900">Pricing</h2>
              <div className="mt-3 overflow-hidden rounded-2xl bg-white shadow-card">
                {priced ? (
                  <PriceRow label="Full Day" price={hall.price_per_day as number} />
                ) : (
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-charcoal-700">Full Day</span>
                    <span className="text-sm font-semibold text-maroon-700">{PRICE_ON_REQUEST}</span>
                  </div>
                )}
                {hall.price_morning != null && (
                  <PriceRow label="Morning Slot" price={hall.price_morning} />
                )}
                {hall.price_evening != null && (
                  <PriceRow label="Evening Slot" price={hall.price_evening} />
                )}
                {showAdvance && (
                  <div className="border-t border-border px-4 py-3 bg-maroon-50">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-maroon-800">Advance ({advancePct}%)</p>
                        <p className="text-[11px] text-charcoal-500">Pay now to confirm booking</p>
                      </div>
                      <p className="text-base font-bold text-maroon-700">{formatPrice(advanceAmount)}</p>
                    </div>
                  </div>
                )}
                <div className="px-4 py-2.5 flex items-start gap-2 border-t border-border">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-charcoal-400" />
                  {isLead ? (
                    // EVERY NUMBER IN THE DIRECT-BOOKING NOTE IS WRONG HERE.
                    // Hallnect collects no advance, charges this customer no
                    // platform fee and no GST on one, and holds no date — so the
                    // sentence has to be replaced rather than reworded.
                    <p className="text-[11px] text-charcoal-500">
                      This venue takes enquiries rather than online bookings. Send one and the
                      venue contacts you directly to agree the price and the date. Hallnect
                      does not collect any payment for this listing, and no date is held until
                      the venue confirms it with you.
                    </p>
                  ) : (
                    <p className="text-[11px] text-charcoal-500">
                      Remaining {balancePct}% is paid directly to the venue on the event day.
                      Unless a promotional code applies, {formatPrice(feeShown)} is added at
                      checkout — a {formatPrice(cappedFee)} platform fee plus {PLATFORM_FEE_GST_PERCENT}% GST.
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* Availability calendar.

                A LEAD VENUE MAKES NO AVAILABILITY CLAIM. getDayStatus returns
                "available" when no row matches the date, which is right for a
                direct-booking hall — no booking means the day is free — and
                wrong for lead generation, where nobody maintains the table and
                there is no workflow that would. The grid was therefore asserting
                that all 30 upcoming days were free at a real third-party
                business, unverified, and a screen reader read out each one:
                "Saturday, 12 September 2026 — Available". A customer could pick a
                date off it, enquire, and be told the hall was booked.

                So under lead mode the same 30 days are shown neutrally, with no
                status, no legend and no colour — a date window, not a promise.
                The honest sentence at the bottom of the card was already there;
                it is now the whole of what this section says. */}
            <section data-reveal="scale" className="mt-6">
              <h2 className="font-serif text-base font-semibold text-charcoal-900">
                {isLead ? "Your date" : "Availability"}
              </h2>
              <div className="mt-3 rounded-2xl bg-white p-3 shadow-card">
                {/* A list, so each day is an element that can carry a name of
                    its own — aria-label on a bare <div> is ignored. role="list"
                    is here because Tailwind's list-style:none makes Safari drop
                    the list semantics, and with them the cells' names. The two
                    visible spans are hidden from assistive tech: the label below
                    already says the date, and better. */}
                {/* THIRTY IDENTICAL GREY CELLS ANSWER NOTHING. The grid was
                    already stripped of its status colours and its legend under
                    lead mode, because getDayStatus calls an unmatched date
                    "available" — right for direct booking, wrong for a venue
                    whose availability table nobody maintains. What was left was
                    honest but uninformative, so a lead venue now gets the
                    sentence and the action instead. fetchHallBySlug no longer
                    reads `availability` for one at all. */}
                {!isLead && (
                <ul role="list" className="grid grid-cols-7 gap-1 sm:gap-1.5">
                  {calDays.map(({ iso, day, wkd, status, label, dateLabel }) => (
                    <li
                      key={iso}
                      title={isLead ? dateLabel : label}
                      className={[
                        "flex flex-col items-center rounded-xl py-1.5 text-center",
                        isLead
                          ? "bg-ivory-100 text-charcoal-600"
                          : status === "unavailable"
                          ? "bg-red-50 text-red-400 line-through"
                          : status === "partial"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-maroon-50 text-maroon-700",
                      ].join(" ")}
                    >
                      {/* An sr-only CHILD, not aria-label on the <li>. ARIA 1.2
                          does allow naming a listitem, but support for it is the
                          weakest link in the chain — where it is not honoured the
                          cell would announce nothing at all, which is worse than
                          the bare "M 6" this replaced. A text node is read by
                          everything. BookingFlow.tsx uses the same construction
                          for the same reason. sr-only is absolutely positioned,
                          so the flex layout is untouched. */}
                      {/* Under lead mode the accessible name is the DATE
                          ONLY — `label` appends the status, which is exactly the
                          claim being withdrawn. */}
                      <span className="sr-only">{isLead ? dateLabel : label}</span>
                      <span aria-hidden className="text-[9px] font-semibold uppercase sm:text-[10px]">{wkd}</span>
                      <span aria-hidden className="text-xs font-bold sm:text-sm">{day}</span>
                    </li>
                  ))}
                </ul>
                )}

                {/* Legend — only where the colours mean something. */}
                {!isLead && (
                  <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-charcoal-500">
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-sm bg-maroon-50 border border-maroon-200" />
                      Available
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-sm bg-amber-50 border border-amber-200" />
                      Partially booked
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-sm bg-red-50 border border-red-200" />
                      Fully booked
                    </span>
                  </div>
                )}

                {isLead ? (
                  <>
                    <p className="text-sm leading-relaxed text-charcoal-700">
                      Ask the venue about your date. Hallnect does not hold this venue&apos;s
                      calendar, so we cannot show which days are free — the venue confirms your
                      date with you directly.
                    </p>
                    <Link
                      href={ctaHref}
                      className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-maroon-700 px-5 text-sm font-semibold text-white transition-colors hover:bg-maroon-800"
                    >
                      {ctaLabel}
                    </Link>
                  </>
                ) : (
                  <p className="mt-3 text-[11px] text-charcoal-500">
                    Tap <strong>Book Now</strong> to choose your exact date and slot.
                  </p>
                )}
              </div>
            </section>

            {/* Reviews */}
            <section data-reveal="up" className="mt-6">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-base font-semibold text-charcoal-900">Reviews</h2>
                {hall.rating_count > 0 && (
                  <span className="text-xs text-charcoal-500">{hall.rating_count} total</span>
                )}
              </div>

              {/* Rating breakdown */}
              {hall.reviews.length > 0 && (() => {
                const withSub = hall.reviews.filter((r) =>
                  r.cleanliness_rating || r.value_rating || r.location_rating || r.service_rating
                );
                if (withSub.length === 0) return null;
                const avg = (key: "cleanliness_rating" | "value_rating" | "location_rating" | "service_rating") => {
                  const vals = withSub.map((r) => r[key]).filter((v): v is number => v != null);
                  return vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null;
                };
                const cats = [
                  { label: "Cleanliness",    v: avg("cleanliness_rating") },
                  { label: "Value",          v: avg("value_rating") },
                  { label: "Location",       v: avg("location_rating") },
                  { label: "Service",        v: avg("service_rating") },
                ].filter((c) => c.v != null) as { label: string; v: number }[];
                if (cats.length === 0) return null;
                return (
                  <div className="mt-3 rounded-2xl bg-white p-4 shadow-card">
                    <div className="flex items-center gap-3 mb-3">
                      <p className="font-serif text-3xl font-bold text-maroon-700">{hall.rating_average.toFixed(1)}</p>
                      <div>
                        <div className="flex items-center gap-0.5">
                          {Array.from({ length: 5 }, (_, i) => (
                            <Star key={i} className={"h-4 w-4 " + (i < Math.round(hall.rating_average) ? "fill-gold-500 text-gold-500" : "text-charcoal-200")} />
                          ))}
                        </div>
                        <p className="text-[11px] text-charcoal-500 mt-0.5">{hall.rating_count} reviews</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {cats.map((c) => (
                        <div key={c.label} className="flex items-center gap-2 text-xs">
                          <span className="w-24 text-charcoal-600">{c.label}</span>
                          <div className="flex-1 h-1.5 rounded-full bg-charcoal-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gold-500"
                              style={{ width: `${(c.v / 5) * 100}%` }}
                            />
                          </div>
                          <span className="w-6 text-right font-semibold text-charcoal-700">{c.v.toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {hall.reviews.length > 0 ? (
                <div className="mt-3 space-y-2.5">
                  {hall.reviews.map((r, i) => (
                    <div key={i} className="rounded-2xl bg-white p-3 shadow-card">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-maroon-100 font-semibold text-sm text-maroon-700">
                          ✦
                        </div>
                        <p className="flex-1 text-xs font-semibold text-charcoal-700">Verified Guest</p>
                        <div className="flex items-center gap-0.5">
                          {Array.from({ length: r.rating }).map((_, k) => (
                            <Star key={k} className="h-3 w-3 fill-gold-500 text-gold-500" />
                          ))}
                        </div>
                      </div>
                      {r.title && (
                        <p className="mt-2 text-sm font-semibold text-charcoal-900">{r.title}</p>
                      )}
                      {r.comment && (
                        <p className="mt-1 text-xs leading-relaxed text-charcoal-600">{r.comment}</p>
                      )}

                      {/* Sub-ratings inline */}
                      {(r.cleanliness_rating || r.value_rating || r.location_rating || r.service_rating) && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {r.cleanliness_rating && <SubBadge label="Cleanliness" value={r.cleanliness_rating} />}
                          {r.value_rating       && <SubBadge label="Value"       value={r.value_rating} />}
                          {r.location_rating    && <SubBadge label="Location"    value={r.location_rating} />}
                          {r.service_rating     && <SubBadge label="Service"     value={r.service_rating} />}
                        </div>
                      )}

                      {/* See reviewMonthLabel: this line was the one date on
                          the page that did not pin a timezone, and it was a
                          hydration mismatch. */}
                      {reviewMonthLabel(r.created_at) && (
                        <p className="mt-1.5 text-[10px] text-charcoal-400">
                          {reviewMonthLabel(r.created_at)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-2xl bg-white p-4 shadow-card text-center">
                  <p className="text-sm text-charcoal-500">No reviews yet — be the first to book!</p>
                </div>
              )}
            </section>

            {/* Venue rules */}
            <section data-reveal="up" className="mt-6">
              <h2 className="font-serif text-base font-semibold text-charcoal-900">Hallnect Standard Venue Rules</h2>
              <ul className="mt-3 space-y-2 rounded-2xl bg-white p-4 shadow-card">
                {VENUE_RULES.map((rule) => (
                  <li key={rule} className="flex items-start gap-2 text-xs text-charcoal-600">
                    <span className="mt-0.5 shrink-0 text-maroon-400">•</span>
                    {rule}
                  </li>
                ))}
              </ul>
            </section>

            {/* Similar venues */}
            {similar.length > 0 && (
              <section data-reveal="up" className="mt-6">
                <h2 className="font-serif text-base font-semibold text-charcoal-900">Similar Venues</h2>
                <div className="no-scrollbar mt-3 -mx-4 overflow-x-auto">
                  <ul className="flex w-max gap-2.5 px-4">
                    {similar.map((s) => (
                      <li key={s.id}>
                        <Link
                          href={`/halls/${s.slug}`}
                          className="block w-44 overflow-hidden rounded-2xl bg-white shadow-card active:scale-[0.98] hover:shadow-card-hover"
                        >
                          <div className="relative h-24 w-full overflow-hidden">
                            {s.cover_url ? (
                              <Image
                                src={s.cover_url}
                                alt={s.name}
                                fill
                                // The card is a fixed w-44 (176px) at every
                                // breakpoint, so a constant sizes is exact.
                                // Needed now that the image is optimised: with
                                // `fill` and no sizes, Next falls back to 100vw
                                // and picks a far larger source than the slot.
                                sizes="176px"
                                className="object-cover"
                                /* See ImageGallery: this strip was the third
                                   `unoptimized` — raw full-size Supabase JPEGs,
                                   inert at one listing and expensive at ten. */
                              />
                            ) : (
                              <div
                                className="absolute inset-0"
                                style={{ background: gradientForId(s.id) }}
                              />
                            )}
                          </div>
                          <div className="p-2.5">
                            <p className="line-clamp-1 text-xs font-semibold text-charcoal-900">{s.name}</p>
                            <p className="text-[10px] text-charcoal-500">{s.city}</p>
                            <p className="mt-1 text-xs font-bold text-maroon-700">
                              {formatHallPrice(s.price_per_day)}
                            </p>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}
          </div>

          {/* ── Desktop sticky booking card (right column) ── */}
          <aside className="hidden lg:block">
            <div className="sticky top-20 mt-6 rounded-2xl bg-white p-5 shadow-elevated">
              <p className="text-xs text-charcoal-500">{priced ? "Starting from" : "Pricing"}</p>
              <p className="mt-0.5 font-serif text-2xl font-bold text-maroon-700">
                {formatHallPrice(hall.price_per_day)}
                {priced && <span className="text-sm font-normal text-charcoal-500"> /day</span>}
              </p>

              <div className="mt-4 space-y-2 rounded-xl bg-ivory-100 p-3 text-sm">
                {priced && <PriceLineDesktop label="Full day" price={hall.price_per_day as number} />}
                {hall.price_morning != null && (
                  <PriceLineDesktop label="Morning"   price={hall.price_morning}  />
                )}
                {hall.price_evening != null && (
                  <PriceLineDesktop label="Evening"   price={hall.price_evening}  />
                )}
                {showAdvance ? (
                  <div className="border-t border-border pt-2">
                    <PriceLineDesktop
                      label={`Advance (${advancePct}%)`}
                      price={advanceAmount}
                      bold
                    />
                  </div>
                ) : (
                  <p className="text-[11px] leading-relaxed text-charcoal-500">
                    The venue quotes and collects directly. Hallnect takes no payment for this
                    listing.
                  </p>
                )}
              </div>

              {hall.rating_count > 0 && (
                <div className="mt-3 flex items-center gap-1.5 text-sm">
                  <Star className="h-4 w-4 fill-gold-500 text-gold-500" />
                  <span className="font-semibold text-charcoal-900">
                    {hall.rating_average.toFixed(1)}
                  </span>
                  <span className="text-charcoal-500">({hall.rating_count} reviews)</span>
                </div>
              )}

              <Link href={ctaHref} className="mt-4 block">
                <Button variant="gold" size="lg" className="w-full">
                  {isLead ? "Send Enquiry" : "Book This Hall"}
                </Button>
              </Link>

              <div className="mt-3 flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-charcoal-400" />
                <p className="text-[11px] text-charcoal-500">
                  {isLead
                    ? "You will not be charged. We verify your number, then pass the enquiry to the venue."
                    : "You won\u2019t be charged yet — choose your date and slot next."}
                </p>
              </div>
            </div>

            {sidebarAd && (
              <div className="mt-4">
                {sidebarAd}
              </div>
            )}
          </aside>

        </div>
      </div>

      {/* ── Mobile sticky Book Now ─────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 px-4 lg:hidden">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-[11px] text-charcoal-500">{priced ? "From" : "Pricing"}</p>
            <p
              className={
                priced
                  ? "font-serif text-lg font-bold text-maroon-700"
                  : "font-serif text-sm font-bold text-maroon-700"
              }
            >
              {formatHallPrice(hall.price_per_day)}
            </p>
          </div>
          <Link href={ctaHref} className="flex-1">
            <Button variant="gold" size="lg" className="w-full">{ctaLabel}</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  Icon, label, value, sub,
}: {
  Icon:  React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub:   string;
}) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-card">
      <Icon className="h-4 w-4 text-maroon-500" />
      <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-charcoal-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-bold text-charcoal-900">{value}</p>
      <p className="text-[10px] text-charcoal-500">{sub}</p>
    </div>
  );
}

function PriceRow({ label, price }: { label: string; price: number }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3 last:border-b-0">
      <p className="text-sm text-charcoal-700">{label}</p>
      <p className="text-sm font-semibold text-charcoal-900">{formatPrice(price)}</p>
    </div>
  );
}

function PriceLineDesktop({
  label, price, bold = false,
}: {
  label: string;
  price: number;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? "font-semibold text-charcoal-900" : "text-charcoal-600"}>{label}</span>
      <span className={bold ? "font-bold text-maroon-700" : "text-charcoal-900"}>
        {formatPrice(price)}
      </span>
    </div>
  );
}

function SubBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ivory-100 px-2 py-0.5 text-[10px] text-charcoal-600">
      {label}
      <span className="font-semibold text-charcoal-900">{value}</span>
      <Star className="h-2.5 w-2.5 fill-gold-500 text-gold-500" />
    </span>
  );
}
