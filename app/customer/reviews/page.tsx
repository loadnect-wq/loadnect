import type { Metadata } from "next";
import Link from "next/link";
import { Star } from "lucide-react";

function SubBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ivory-100 px-2 py-0.5 text-[10px] text-charcoal-600">
      {label}
      <span className="font-semibold text-charcoal-900">{value}</span>
      <Star className="h-2.5 w-2.5 fill-gold-500 text-gold-500" />
    </span>
  );
}
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { fetchMyReviews } from "@/lib/customer";

export const metadata: Metadata = { title: "My Reviews" };

export default async function MyReviewsPage() {
  const reviews = await fetchMyReviews();

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="My Reviews" />

      <div className="px-4 py-5 sm:px-6 lg:px-8">
        {reviews.length === 0 ? (
          <EmptyState
            icon={<Star className="h-8 w-8" />}
            title="No reviews yet"
            description="Complete a booking to leave your first review."
            action={
              <Link href="/customer/bookings" className={buttonVariants({ variant: "gold", size: "sm" })}>
                My Bookings
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-2xl bg-white shadow-card p-4 space-y-3">
                {/* Hall name + stars */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={r.hall_slug ? `/halls/${r.hall_slug}` : "#"}
                      className="font-serif text-sm font-semibold text-charcoal-900 hover:underline"
                    >
                      {r.hall_name}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-charcoal-500">
                      {new Date(r.created_at).toLocaleDateString("en-IN", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {Array.from({ length: 5 }, (_, i) => (
                      <Star
                        key={i}
                        className={
                          "h-4 w-4 " +
                          (i < r.rating ? "fill-gold-500 text-gold-500" : "text-charcoal-200")
                        }
                      />
                    ))}
                  </div>
                </div>

                {/* Title + Comment */}
                {r.title && (
                  <p className="text-sm font-semibold text-charcoal-900">{r.title}</p>
                )}
                {r.comment && (
                  <p className="text-sm text-charcoal-700 leading-relaxed">{r.comment}</p>
                )}

                {/* Sub-ratings */}
                {(r.cleanliness_rating || r.value_rating || r.location_rating || r.service_rating) && (
                  <div className="flex flex-wrap gap-1.5">
                    {r.cleanliness_rating && <SubBadge label="Cleanliness" value={r.cleanliness_rating} />}
                    {r.value_rating       && <SubBadge label="Value"       value={r.value_rating} />}
                    {r.location_rating    && <SubBadge label="Location"    value={r.location_rating} />}
                    {r.service_rating     && <SubBadge label="Service"     value={r.service_rating} />}
                  </div>
                )}

                {/* Visibility */}
                {!r.is_visible && (
                  <Badge variant="warning" size="sm">Under review by admin</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
