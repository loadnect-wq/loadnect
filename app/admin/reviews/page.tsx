import type { Metadata } from "next";
import Link from "next/link";
import { Eye, EyeOff, Star } from "lucide-react";
import { fetchAllReviews } from "@/lib/admin";
import { Badge } from "@/components/ui/Badge";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { ConfirmButton } from "../_components/ConfirmButton";
import { toggleReviewVisible, deleteReview } from "../actions";

export const metadata: Metadata = { title: "Reviews — Admin" };

function SubBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ivory-100 px-2 py-0.5 text-[10px] text-charcoal-600">
      {label}
      <span className="font-semibold text-charcoal-900">{value}</span>
      <Star className="h-2.5 w-2.5 fill-gold-500 text-gold-500" />
    </span>
  );
}

const FILTERS = [
  { key: "all",       label: "All",        value: undefined  },
  { key: "visible",   label: "Visible",    value: "visible" as const   },
  { key: "hidden",    label: "Hidden",     value: "hidden"  as const   },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

type Props = { searchParams: Promise<{ filter?: string }> };

export default async function AdminReviewsPage({ searchParams }: Props) {
  const { filter } = await searchParams;
  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const reviews = await fetchAllReviews(activeFilter.value);

  return (
    <div>
      <AdminPageHeader title="Reviews" description="Moderate customer reviews. Hide inappropriate content or delete to remove permanently." />

      <div className="px-4 py-4 sm:px-6 lg:px-8 space-y-4">

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "all" ? "?" : `?filter=${f.key}`}
              className={[
                "rounded-full border px-3 py-1 text-xs font-semibold",
                activeFilter.key === f.key
                  ? "border-maroon-700 bg-maroon-700 text-white"
                  : "border-border bg-white text-charcoal-600 hover:border-maroon-300",
              ].join(" ")}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {reviews.length === 0 ? (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-charcoal-500 shadow-card">
            No reviews match this filter.
          </p>
        ) : (
          <div className="space-y-2">
            {reviews.map((r) => (
              <div key={r.id} className="rounded-2xl bg-white p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    {/* Header */}
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-serif text-sm font-semibold text-charcoal-900">{r.hall_name}</p>
                      <div className="flex items-center gap-0.5">
                        {Array.from({ length: r.rating }).map((_, i) => (
                          <Star key={i} className="h-3.5 w-3.5 fill-gold-500 text-gold-500" />
                        ))}
                      </div>
                      {r.is_visible
                        ? <Badge variant="success" size="sm"><Eye  className="h-3 w-3" /> Visible</Badge>
                        : <Badge variant="warning" size="sm"><EyeOff className="h-3 w-3" /> Hidden</Badge>
                      }
                    </div>

                    {/* Reviewer */}
                    <p className="text-xs text-charcoal-500">
                      By <strong className="text-charcoal-700">{r.customer_name ?? "Anonymous"}</strong>
                      <span className="text-charcoal-400"> · {fmtDate(r.created_at)}</span>
                    </p>

                    {/* Title + Comment */}
                    {r.title && (
                      <p className="text-sm font-semibold text-charcoal-900">{r.title}</p>
                    )}
                    {r.comment && (
                      <p className="rounded-xl bg-ivory-100 px-3 py-2 text-xs italic text-charcoal-700">
                        &ldquo;{r.comment}&rdquo;
                      </p>
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
                  </div>

                  {/* Actions */}
                  <div className="shrink-0 flex flex-col gap-1">
                    <ConfirmButton
                      action={toggleReviewVisible.bind(null, r.id, !r.is_visible)}
                      label={r.is_visible ? "Hide" : "Show"}
                      confirmText="Click again"
                      variant={r.is_visible ? "destructive" : "success"}
                    />
                    <ConfirmButton
                      action={deleteReview.bind(null, r.id)}
                      label="Delete"
                      confirmText="Confirm delete"
                      variant="destructive"
                      hideOnSuccess doneLabel="✓ Deleted"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
