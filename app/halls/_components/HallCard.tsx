import Link from "next/link";
import Image from "next/image";
import { MapPin, Star, Users } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { type HallListing } from "@/lib/halls";
import { CARD_GRADIENTS, formatPrice } from "@/lib/mock-data";
import { advanceFromTotal } from "@/lib/booking-payment";
import { SaveHeart } from "@/app/_components/SaveHeart";

// Booking advance — the same central calculation the checkout uses
// (lib/booking-payment.ts). Shown with "≈" because the authoritative amount is
// always recomputed server-side at booking time.
// (The customer additionally pays the flat ₹200 platform fee at checkout,
// which is disclosed there — a card estimate stays the venue's price.)
//
// The percentage is passed IN rather than assumed: it is an admin setting, and
// a card advertising a different advance from the one checkout charges is the
// kind of quiet contradiction customers notice at exactly the wrong moment.
// This component is rendered inside a client component (SavedView) as well as
// server pages, so it cannot read the setting itself — the page supplies it.
function estimateAdvance(pricePerDay: number, advancePercent?: number): number {
  return advanceFromTotal(pricePerDay, advancePercent);
}

interface HallCardProps {
  hall: HallListing;
  /** Live advance % from platform_settings. Omitted falls back to the constant. */
  advancePercent?: number;
}

// Deterministic gradient fallback when no cover image is available
function gradientForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return CARD_GRADIENTS[Math.abs(hash) % CARD_GRADIENTS.length];
}

export function HallCard({ hall, advancePercent }: HallCardProps) {
  return (
    <Link
      href={`/halls/${hall.slug}`}
      className="group block overflow-hidden rounded-2xl bg-white shadow-card transition-all active:scale-[0.99] hover:shadow-card-hover"
    >
      {/* ── Image / Gradient hero ── */}
      <div className="relative h-44 w-full sm:h-48">
        {hall.cover_url ? (
          <Image
            src={hall.cover_url}
            alt={`${hall.name}, a wedding hall in ${hall.city}`}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: gradientForId(hall.id) }}
            aria-label={`${hall.name} venue`}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />

        {/* Top-left: premium tier badge — only renders for ACTIVE listings
            (premium_tier is null for free + expired/inactive). */}
        <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
          {hall.premium_tier === "pro" && (
            <Badge variant="gold" size="sm">★ Pro</Badge>
          )}
          {hall.premium_tier === "premium" && (
            <Badge variant="gold" size="sm">✦ Premium</Badge>
          )}
        </div>

        {/* Top-right: save heart */}
        <div className="absolute right-3 top-3">
          <SaveHeart hallId={hall.id} />
        </div>

        {/* Bottom-left: rating (only when hall has reviews) */}
        {hall.rating_count > 0 && (
          <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 shadow-sm">
            <Star className="h-3.5 w-3.5 fill-gold-500 text-gold-500" />
            <span className="text-xs font-bold text-charcoal-900">
              {hall.rating_average.toFixed(1)}
            </span>
            <span className="text-[10px] text-charcoal-500">({hall.rating_count})</span>
          </div>
        )}

        {/* Bottom-right: availability pill */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-green-700">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          Available
        </div>
      </div>

      {/* ── Card body ── */}
      <div className="p-3.5">
        <div className="min-w-0">
          <h3 className="line-clamp-1 font-serif text-base font-semibold text-charcoal-900 group-hover:text-maroon-700">
            {hall.name}
          </h3>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-charcoal-500">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="line-clamp-1">{hall.city}</span>
          </p>
        </div>

        <div className="mt-3 flex items-end justify-between">
          <span className="flex items-center gap-1 text-xs text-charcoal-600">
            <Users className="h-3.5 w-3.5" />
            Up to{" "}
            <strong className="font-semibold text-charcoal-900">
              {hall.capacity_max.toLocaleString("en-IN")}
            </strong>
          </span>
          <span className="text-right">
            <span className="block">
              <span className="text-base font-bold text-maroon-700">
                {formatPrice(hall.price_per_day)}
              </span>
              <span className="text-[10px] text-charcoal-500">/day</span>
            </span>
            {/* Advance shown as an estimate — the exact, authoritative amount is
                recomputed server-side at booking (platform fee % is admin-set). */}
            <span className="mt-0.5 block text-[10px] font-semibold text-gold-600">
              ≈ {formatPrice(estimateAdvance(hall.price_per_day, advancePercent))} advance
            </span>
          </span>
        </div>
      </div>
    </Link>
  );
}
