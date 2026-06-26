import Link from "next/link";
import { MapPin, Star, Users } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { type MockHall, CARD_GRADIENTS, formatPrice } from "@/lib/mock-data";
import { SaveHeart } from "./SaveHeart";

export function FeaturedCarousel({ halls }: { halls: MockHall[] }) {
  return (
    <div className="no-scrollbar overflow-x-auto">
      <ul className="flex w-max gap-3 px-4 pb-1 sm:px-6">
        {halls.map((hall) => {
          const gradient = CARD_GRADIENTS[hall.gradientIndex % CARD_GRADIENTS.length];
          return (
            <li key={hall.id}>
              <Link
                href={`/halls/${hall.slug}`}
                className="block w-64 overflow-hidden rounded-2xl bg-white shadow-card transition-transform active:scale-[0.98]"
              >
                <div
                  className="relative h-36 w-full"
                  style={{ background: gradient }}
                  aria-label={hall.name}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                  <div className="absolute left-2.5 top-2.5">
                    {hall.isPremium && <Badge variant="gold" size="sm">✦ Premium</Badge>}
                  </div>
                  <div className="absolute right-2.5 top-2.5">
                    <SaveHeart hallId={hall.id} />
                  </div>
                  <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-xs font-semibold">
                    <Star className="h-3 w-3 fill-gold-500 text-gold-500" />
                    {hall.rating}
                    <span className="text-charcoal-500">({hall.reviewCount})</span>
                  </div>
                </div>
                <div className="p-3">
                  <p className="line-clamp-1 font-serif text-sm font-semibold text-charcoal-900">{hall.name}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-charcoal-500">
                    <MapPin className="h-3 w-3" />
                    {hall.city}, {hall.state}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1 text-charcoal-600">
                      <Users className="h-3 w-3" />
                      {hall.capacity.toLocaleString("en-IN")}
                    </span>
                    <span className="font-bold text-maroon-700">{formatPrice(hall.pricePerDay)}</span>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
