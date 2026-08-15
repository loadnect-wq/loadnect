import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { fetchAllAds } from "@/lib/admin";
import { formatPrice } from "@/lib/mock-data";
import { Badge } from "@/components/ui/Badge";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { ConfirmButton } from "../_components/ConfirmButton";
import { updateAdStatus, deleteAdvertisement } from "../actions";
import { CreateAdForm } from "./_components/CreateAdForm";

export const metadata: Metadata = { title: "Advertisements — Admin" };

type BadgeVar = "success" | "warning" | "secondary" | "destructive" | "default";

const FILTERS = [
  { key: "all",      label: "All",      value: undefined  },
  { key: "pending",  label: "Pending",  value: "pending"  },
  { key: "active",   label: "Active",   value: "active"   },
  { key: "paused",   label: "Paused",   value: "paused"   },
  { key: "rejected", label: "Rejected", value: "rejected" },
  { key: "expired",  label: "Expired",  value: "expired"  },
];

const STATUS_CFG: Record<string, { label: string; variant: BadgeVar }> = {
  pending:  { label: "Pending",  variant: "warning"     },
  active:   { label: "Active",   variant: "success"     },
  paused:   { label: "Paused",   variant: "secondary"   },
  rejected: { label: "Rejected", variant: "destructive" },
  expired:  { label: "Expired",  variant: "secondary"   },
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

type Props = { searchParams: Promise<{ status?: string }> };

export default async function AdminAdsPage({ searchParams }: Props) {
  const { status } = await searchParams;
  const activeFilter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const ads = await fetchAllAds(activeFilter.value);

  return (
    <div>
      <AdminPageHeader title="Advertisements" description="Owner-requested ad placements. Approve to make them live." />

      <div className="px-4 py-4 sm:px-6 lg:px-8 space-y-4">

        <CreateAdForm />

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "all" ? "?" : `?status=${f.key}`}
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

        {ads.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-card">
            <Megaphone className="mx-auto h-10 w-10 text-charcoal-300 mb-3" />
            <p className="text-sm text-charcoal-500">No advertisements match this filter.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ads.map((ad) => {
              const cfg = STATUS_CFG[ad.status] ?? { label: ad.status, variant: "secondary" as BadgeVar };
              return (
                <div key={ad.id} className="rounded-2xl bg-white shadow-card overflow-hidden">
                  {/* Image */}
                  <div className="aspect-video w-full overflow-hidden bg-charcoal-100">
                    {ad.image_url ? (
                      <img src={ad.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-charcoal-300">
                        <Megaphone className="h-8 w-8" />
                      </div>
                    )}
                  </div>

                  <div className="p-3 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-serif text-sm font-semibold text-charcoal-900 line-clamp-1">{ad.title}</p>
                      <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>
                    </div>

                    <div className="space-y-0.5 text-[11px] text-charcoal-500">
                      {ad.advertiser_name && <p><span className="text-charcoal-400">Advertiser:</span> {ad.advertiser_name}</p>}
                      {ad.owner_business && <p><span className="text-charcoal-400">Owner:</span> {ad.owner_business}</p>}
                      {ad.hall_name      && <p><span className="text-charcoal-400">Hall:</span> {ad.hall_name}</p>}
                      <p><span className="text-charcoal-400">Placement:</span> {ad.placement ?? "—"}</p>
                      <p><span className="text-charcoal-400">Window:</span> {fmtDate(ad.start_date)} → {fmtDate(ad.end_date)}</p>
                      {ad.amount != null && <p><span className="text-charcoal-400">Amount:</span> {formatPrice(ad.amount)}</p>}
                      {ad.target_url && (
                        <p className="truncate">
                          <span className="text-charcoal-400">Target:</span>{" "}
                          <a href={ad.target_url} target="_blank" rel="noopener noreferrer nofollow" className="text-maroon-700 hover:underline">
                            {ad.target_url}
                          </a>
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border">
                      {ad.status === "pending" && (
                        <>
                          <ConfirmButton
                            action={updateAdStatus.bind(null, ad.id, "active")}
                            label="Approve"
                            confirmText="Confirm"
                            variant="success"
                            hideOnSuccess doneLabel="✓ Active"
                          />
                          <ConfirmButton
                            action={updateAdStatus.bind(null, ad.id, "rejected")}
                            label="Reject"
                            confirmText="Confirm"
                            variant="destructive"
                            hideOnSuccess doneLabel="✓ Rejected"
                          />
                        </>
                      )}
                      {ad.status === "active" && (
                        <ConfirmButton
                          action={updateAdStatus.bind(null, ad.id, "paused")}
                          label="Pause"
                          confirmText="Confirm pause"
                          variant="destructive"
                        />
                      )}
                      {ad.status === "paused" && (
                        <ConfirmButton
                          action={updateAdStatus.bind(null, ad.id, "active")}
                          label="Resume"
                          confirmText="Confirm resume"
                          variant="success"
                        />
                      )}
                      <ConfirmButton
                        action={deleteAdvertisement.bind(null, ad.id)}
                        label="Delete"
                        confirmText="Confirm delete"
                        variant="destructive"
                        hideOnSuccess doneLabel="✓ Deleted"
                      />
                    </div>
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
