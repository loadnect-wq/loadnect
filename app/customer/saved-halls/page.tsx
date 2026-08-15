import type { Metadata } from "next";
import Link from "next/link";
import { Heart } from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import { fetchMySavedHalls } from "@/lib/customer";
import { formatPrice } from "@/lib/mock-data";
import { CARD_GRADIENTS } from "@/lib/mock-data";

export const metadata: Metadata = { title: "Saved Halls" };

function gradientForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return CARD_GRADIENTS[Math.abs(hash) % CARD_GRADIENTS.length];
}

export default async function SavedHallsPage() {
  const saved = await fetchMySavedHalls();
  const halls = saved.filter((s) => s.hall !== null);

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Saved Halls" />

      <div className="px-4 py-5 sm:px-6 lg:px-8">
        {halls.length === 0 ? (
          <EmptyState
            icon={<Heart className="h-8 w-8" />}
            title="No saved halls yet"
            description="Tap the heart on any hall listing to save it here."
            action={
              <Link href="/halls" className={buttonVariants({ variant: "gold", size: "sm" })}>
                Browse Halls
              </Link>
            }
          />
        ) : (
          <>
            <p className="mb-4 text-sm text-charcoal-500">{halls.length} hall{halls.length !== 1 ? "s" : ""} saved</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {halls.map(({ hall_id, saved_at, hall }) => {
                if (!hall) return null;
                return (
                  <Link
                    key={hall_id}
                    href={`/halls/${hall.slug}`}
                    className="flex overflow-hidden rounded-2xl bg-white shadow-card active:scale-[0.99] transition-transform"
                  >
                    {/* Thumbnail */}
                    <div className="relative h-24 w-24 shrink-0">
                      {hall.cover_url ? (
                        <img
                          src={hall.cover_url}
                          alt={hall.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div
                          className="h-full w-full"
                          style={{ background: gradientForId(hall.id) }}
                        />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex min-w-0 flex-1 flex-col justify-between p-3">
                      <div>
                        <div className="flex items-start justify-between gap-1">
                          <p className="line-clamp-1 font-serif text-sm font-semibold text-charcoal-900">
                            {hall.name}
                          </p>
                          {hall.is_premium && (
                            <Badge variant="gold" size="sm" className="shrink-0">✦</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-charcoal-500">{hall.city}</p>
                      </div>
                      <div className="flex items-end justify-between gap-1">
                        <div>
                          <p className="text-xs font-bold text-maroon-700">
                            {formatPrice(hall.price_per_day)}/day
                          </p>
                          <p className="text-[10px] text-charcoal-400">
                            Up to {hall.capacity_max.toLocaleString("en-IN")} guests
                          </p>
                        </div>
                        <p className="text-[10px] text-charcoal-400">
                          Saved {new Date(saved_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
