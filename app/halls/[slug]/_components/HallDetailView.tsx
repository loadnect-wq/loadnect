"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, Accessibility, Calendar, Car,
  ChefHat, ExternalLink, MapPin, MonitorPlay, Music,
  Share2, Snowflake, Sparkles, Star, TreePine, Users,
  Waves, Zap, Info,
} from "lucide-react";
import { motion } from "framer-motion";
import { type HallDetail, type HallListing, type AvailabilityRow } from "@/lib/halls";
import { CARD_GRADIENTS, formatPrice } from "@/lib/mock-data";
import { todayInBusinessTz, addDaysToIsoDate, isoDateToLabelDate } from "@/lib/dates";
import { advanceFromTotal, DEFAULT_ADVANCE_PERCENT } from "@/lib/booking-payment";
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

// ── Standard rules (no DB column — shown as static policy) ───────────────────

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

const FULL_BLOCK = new Set(["booked", "blocked", "full_day_booked", "maintenance"]);
const PARTIAL    = new Set(["morning_booked", "evening_booked", "partially_booked"]);

function getDayStatus(dateStr: string, rows: AvailabilityRow[]): DayStatus {
  const matching = rows.filter((r) => r.date === dateStr);
  if (matching.length === 0) return "available";
  const statuses = matching.map((r) => r.status);
  if (statuses.some((s) => FULL_BLOCK.has(s))) return "unavailable";
  if (statuses.some((s) => PARTIAL.has(s)))    return "partial";
  return "available";
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
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HallDetailView({ hall, similar, isPreview, sidebarAd, advancePercent }: Props) {
  const router = useRouter();

  useEffect(() => { recordRecentlyViewed(hall.id); }, [hall.id]);

  // The live advance percentage, not a hardcoded 0.25. Checkout charges the
  // configurable rate, so a page that always said "25%" would quote a figure
  // the customer is not actually asked for the moment an admin changes it.
  const advancePct    = advancePercent ?? DEFAULT_ADVANCE_PERCENT;
  const advanceAmount = advanceFromTotal(hall.price_per_day, advancePct);
  const balancePct    = Math.round((100 - advancePct) * 100) / 100;
  const mapsHref = hall.latitude && hall.longitude
    ? `https://maps.google.com/?q=${hall.latitude},${hall.longitude}`
    : `https://maps.google.com/?q=${encodeURIComponent(`${hall.address ?? hall.name}, ${hall.city}`)}`;

  // Build 30-day calendar in the BUSINESS timezone (UTC math shifted every
  // date back a day for IST visitors, desyncing it from the booking flow).
  const stripStart = todayInBusinessTz();
  const calDays = Array.from({ length: 30 }, (_, i) => {
    const iso = addDaysToIsoDate(stripStart, i);
    const d = isoDateToLabelDate(iso);
    return {
      iso,
      day:  d.getUTCDate(),
      wkd:  d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }).slice(0, 1),
      status: getDayStatus(iso, hall.availability),
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

      {/* ── Hero image gallery ────────────────────────────────── */}
      <div className="relative">
        <ImageGallery images={hall.images} hallName={hall.name} hallCity={hall.city} hallId={hall.id} />

        {/* Overlay action bar */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
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

          {/* ── Main content (left column) ── */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="relative -mt-4 rounded-t-3xl bg-ivory-100 px-4 pb-36 pt-5 lg:mt-6 lg:rounded-none lg:bg-transparent lg:px-0 lg:pb-16"
          >
            {/* Title block */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {hall.premium_tier === "pro"     && <Badge variant="gold" size="sm">★ Pro</Badge>}
                  {hall.premium_tier === "premium" && <Badge variant="gold" size="sm">✦ Premium</Badge>}
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
                value={formatPrice(hall.price_per_day)}
                sub="full day"
              />
              <StatCard
                Icon={Sparkles}
                label="Advance"
                value={formatPrice(advanceAmount)}
                sub={`${advancePct}% upfront`}
              />
            </div>

            {/* About / Description */}
            <section className="mt-6">
              <h2 className="font-serif text-base font-semibold text-charcoal-900">About</h2>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-600">
                {hall.description ??
                  `${hall.name} is a premier event venue in ${hall.city}${hall.state ? `, ${hall.state}` : ""} with world-class amenities for every celebration.`}
              </p>
            </section>

            {/* Amenities */}
            {hall.amenities.length > 0 && (
              <section className="mt-6">
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
            <section className="mt-6">
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

                {/* Map placeholder tile */}
                <div className="mt-3 flex h-32 items-center justify-center rounded-xl bg-ivory-200 text-charcoal-400">
                  <MapPin className="h-6 w-6 opacity-40" />
                </div>

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

            {/* Pricing breakdown */}
            <section className="mt-6">
              <h2 className="font-serif text-base font-semibold text-charcoal-900">Pricing</h2>
              <div className="mt-3 overflow-hidden rounded-2xl bg-white shadow-card">
                <PriceRow label="Full Day"    price={hall.price_per_day}  />
                {hall.price_morning != null && (
                  <PriceRow label="Morning Slot" price={hall.price_morning} />
                )}
                {hall.price_evening != null && (
                  <PriceRow label="Evening Slot" price={hall.price_evening} />
                )}
                <div className="border-t border-border px-4 py-3 bg-maroon-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-maroon-800">Advance ({advancePct}%)</p>
                      <p className="text-[11px] text-charcoal-500">Pay now to confirm booking</p>
                    </div>
                    <p className="text-base font-bold text-maroon-700">{formatPrice(advanceAmount)}</p>
                  </div>
                </div>
                <div className="px-4 py-2.5 flex items-start gap-2 border-t border-border">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-charcoal-400" />
                  <p className="text-[11px] text-charcoal-500">
                    Remaining {balancePct}% is paid directly to the venue on the event day. A flat ₹200
                    platform fee is added at checkout.
                  </p>
                </div>
              </div>
            </section>

            {/* Availability calendar */}
            <section className="mt-6">
              <h2 className="font-serif text-base font-semibold text-charcoal-900">Availability</h2>
              <div className="mt-3 rounded-2xl bg-white p-3 shadow-card">
                <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                  {calDays.map(({ iso, day, wkd, status }) => (
                    <div
                      key={iso}
                      title={iso}
                      className={[
                        "flex flex-col items-center rounded-xl py-1.5 text-center",
                        status === "unavailable"
                          ? "bg-red-50 text-red-400 line-through"
                          : status === "partial"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-maroon-50 text-maroon-700",
                      ].join(" ")}
                    >
                      <span className="text-[9px] font-semibold uppercase sm:text-[10px]">{wkd}</span>
                      <span className="text-xs font-bold sm:text-sm">{day}</span>
                    </div>
                  ))}
                </div>

                {/* Legend */}
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

                <p className="mt-3 text-[11px] text-charcoal-500">
                  Tap <strong>Book Now</strong> to choose your exact date and slot.
                </p>
              </div>
            </section>

            {/* Reviews */}
            <section className="mt-6">
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

                      <p className="mt-1.5 text-[10px] text-charcoal-400">
                        {new Date(r.created_at).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                      </p>
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
            <section className="mt-6">
              <h2 className="font-serif text-base font-semibold text-charcoal-900">Venue Rules & Policies</h2>
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
              <section className="mt-6">
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
                                className="object-cover"
                                unoptimized
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
                              {formatPrice(s.price_per_day)}
                            </p>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}
          </motion.div>

          {/* ── Desktop sticky booking card (right column) ── */}
          <aside className="hidden lg:block">
            <div className="sticky top-20 mt-6 rounded-2xl bg-white p-5 shadow-elevated">
              <p className="text-xs text-charcoal-500">Starting from</p>
              <p className="mt-0.5 font-serif text-2xl font-bold text-maroon-700">
                {formatPrice(hall.price_per_day)}
                <span className="text-sm font-normal text-charcoal-500"> /day</span>
              </p>

              <div className="mt-4 space-y-2 rounded-xl bg-ivory-100 p-3 text-sm">
                <PriceLineDesktop label="Full day"    price={hall.price_per_day}  />
                {hall.price_morning != null && (
                  <PriceLineDesktop label="Morning"   price={hall.price_morning}  />
                )}
                {hall.price_evening != null && (
                  <PriceLineDesktop label="Evening"   price={hall.price_evening}  />
                )}
                <div className="border-t border-border pt-2">
                  <PriceLineDesktop
                    label={`Advance (${advancePct}%)`}
                    price={advanceAmount}
                    bold
                  />
                </div>
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

              <Link href={`/book/${hall.slug}`} className="mt-4 block">
                <Button variant="gold" size="lg" className="w-full">
                  Book This Hall
                </Button>
              </Link>

              <div className="mt-3 flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-charcoal-400" />
                <p className="text-[11px] text-charcoal-500">
                  You won&apos;t be charged yet — choose your date and slot next.
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
            <p className="text-[11px] text-charcoal-500">From</p>
            <p className="font-serif text-lg font-bold text-maroon-700">
              {formatPrice(hall.price_per_day)}
            </p>
          </div>
          <Link href={`/book/${hall.slug}`} className="flex-1">
            <Button variant="gold" size="lg" className="w-full">Book Now</Button>
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
