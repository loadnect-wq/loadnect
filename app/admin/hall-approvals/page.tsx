import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ClipboardCheck, ExternalLink, Sparkles } from "lucide-react";
import { fetchAllHalls } from "@/lib/admin";
import { formatPrice } from "@/lib/mock-data";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { ConfirmButton } from "../_components/ConfirmButton";
import { ReasonButton } from "../_components/ReasonButton";
import { approveHall, rejectHall } from "../actions";

export const metadata: Metadata = { title: "Hall Approvals — Admin" };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default async function HallApprovalsPage() {
  const halls = await fetchAllHalls("pending_approval");

  return (
    <div>
      <AdminPageHeader
        title="Hall Approvals"
        description="Review pending hall listings before they go live in search."
      />

      <div className="px-4 py-5 sm:px-6 lg:px-8 space-y-4">
        {halls.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck className="h-8 w-8" />}
            title="No pending approvals"
            description="All hall listings have been reviewed."
            size="sm"
          />
        ) : (
          <>
            <p className="text-xs text-charcoal-500">
              {halls.length} hall{halls.length !== 1 ? "s" : ""} waiting for review. Approve to make them public.
            </p>

            <div className="space-y-3">
              {halls.map((h) => (
                <div key={h.id} className="rounded-2xl bg-white shadow-card overflow-hidden">
                  {/* Cover */}
                  <div className="aspect-[3/1] w-full overflow-hidden bg-maroon-50">
                    {h.cover_url ? (
                      <img src={h.cover_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-maroon-300">
                        <Building2 className="h-10 w-10" />
                      </div>
                    )}
                  </div>

                  <div className="p-4 space-y-3">
                    {/* Title */}
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-serif text-base font-bold text-charcoal-900">{h.name}</h3>
                        {h.is_premium && (
                          <span className="flex items-center gap-0.5 text-[10px] font-bold text-gold-600">
                            <Sparkles className="h-3 w-3" /> Premium
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-charcoal-500">{h.city}{h.state ? `, ${h.state}` : ""}</p>
                    </div>

                    {/* Owner + meta */}
                    <div className="grid gap-2 rounded-xl bg-ivory-50 p-3 text-xs sm:grid-cols-2">
                      <Field label="Business" value={h.owner_business} />
                      <Field label="Owner" value={h.owner_name} />
                      <Field label="Capacity" value={`Up to ${h.capacity_max.toLocaleString("en-IN")}`} />
                      <Field label="Price/day" value={formatPrice(h.price_per_day)} />
                      <Field label="Submitted" value={fmtDate(h.created_at)} />
                    </div>

                    {/* Owner-defined amenities submitted for review */}
                    {h.custom_amenities.length > 0 && (
                      <div className="rounded-xl border border-gold-200 bg-gold-50/60 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-charcoal-500">
                          Custom amenities submitted ({h.custom_amenities.length})
                        </p>
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {h.custom_amenities.map((name) => (
                            <li
                              key={name.toLowerCase()}
                              className="rounded-full border border-gold-300 bg-white px-2.5 py-1 text-[11px] font-medium text-charcoal-800"
                            >
                              {name}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                      <Link
                        href={`/halls/${h.slug}`}
                        target="_blank"
                        className="flex items-center gap-1 text-xs font-semibold text-maroon-600 hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Preview as owner
                      </Link>
                      <div className="relative flex gap-2">
                        <ReasonButton
                          action={rejectHall.bind(null, h.id)}
                          label="Reject"
                          title="Reject this hall"
                          placeholder="e.g. Photos do not match the venue address provided."
                        />
                        <ConfirmButton
                          action={approveHall.bind(null, h.id)}
                          label="Approve"
                          confirmText="Confirm approve"
                          variant="success"
                          hideOnSuccess doneLabel="✓ Approved"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-charcoal-400">{label}</span>
      <span className="font-medium text-charcoal-700">{value ?? "—"}</span>
    </div>
  );
}
