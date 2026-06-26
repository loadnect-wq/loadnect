import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ChevronRight, Plus, Sparkles } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerRow, fetchOwnerHalls } from "@/lib/owner";
import { formatPrice } from "@/lib/mock-data";
import { Badge } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/empty-state";
import { AppHeader } from "@/components/app/AppHeader";

export const metadata: Metadata = { title: "My Halls" };

const STATUS_CFG: Record<string, { label: string; variant: "success" | "warning" | "secondary" | "destructive" | "default" }> = {
  approved:         { label: "Live",      variant: "success"     },
  pending_approval: { label: "Pending",   variant: "warning"     },
  draft:            { label: "Draft",     variant: "secondary"   },
  rejected:         { label: "Rejected",  variant: "destructive" },
  suspended:        { label: "Suspended", variant: "destructive" },
};

export default async function OwnerHallsPage() {
  await requireRole(["owner_approved"]);
  const ownerRow = await fetchOwnerRow();
  const halls = ownerRow ? await fetchOwnerHalls(ownerRow.id) : [];

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="My Halls" />

      <div className="px-4 py-4 sm:px-6 lg:px-8">
        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-charcoal-500">{halls.length} hall{halls.length !== 1 ? "s" : ""}</p>
          <Link href="/owner/halls/new" className={buttonVariants({ variant: "gold", size: "sm" })}>
            <Plus className="h-4 w-4" /> Add Hall
          </Link>
        </div>

        {halls.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="No halls yet"
            description="Add your first venue to start receiving bookings from customers."
            action={
              <Link href="/owner/halls/new" className={buttonVariants({ variant: "gold", size: "sm" })}>
                <Plus className="h-4 w-4" /> Add Hall
              </Link>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {halls.map((hall) => {
              const cfg = STATUS_CFG[hall.status] ?? { label: hall.status, variant: "secondary" as const };
              return (
                <div key={hall.id} className="rounded-2xl bg-white shadow-card overflow-hidden">
                  <div className="flex items-start gap-3 p-3">
                    {/* Thumbnail */}
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-maroon-50 relative">
                      {hall.cover_url && (
                        <img src={hall.cover_url} alt="" className="h-full w-full object-cover" />
                      )}
                      {!hall.cover_url && (
                        <div className="flex h-full w-full items-center justify-center">
                          <Building2 className="h-6 w-6 text-maroon-300" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-serif text-sm font-semibold text-charcoal-900 line-clamp-1">{hall.name}</p>
                        <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-charcoal-500">{hall.city}{hall.state ? `, ${hall.state}` : ""}</p>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-charcoal-600">
                        <span>👥 Up to {hall.capacity_max.toLocaleString("en-IN")}</span>
                        <span>💰 {formatPrice(hall.price_per_day)}/day</span>
                        {hall.is_premium && (
                          <span className="flex items-center gap-0.5 font-bold text-gold-600">
                            <Sparkles className="h-3 w-3" /> Premium
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action row */}
                  <div className="grid grid-cols-4 border-t border-border text-[11px] font-semibold divide-x divide-border">
                    {[
                      { label: "Edit",         href: `/owner/halls/${hall.id}/edit`         },
                      { label: "Images",        href: `/owner/halls/${hall.id}/images`       },
                      { label: "Availability",  href: `/owner/halls/${hall.id}/availability` },
                      { label: "View",          href: `/halls/${hall.slug}`                  },
                    ].map((action) => (
                      <Link
                        key={action.label}
                        href={action.href}
                        className="flex items-center justify-center gap-1 py-2 text-charcoal-600 hover:bg-ivory-100 transition-colors"
                      >
                        {action.label}
                        <ChevronRight className="h-3 w-3" />
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
