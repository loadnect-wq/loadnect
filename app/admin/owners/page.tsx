import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { fetchAllOwners, fetchPendingOwnerProfiles } from "@/lib/admin";
import { Badge } from "@/components/ui/Badge";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { ConfirmButton } from "../_components/ConfirmButton";
import { approveOwner, rejectOwner, verifyOwnerRow } from "../actions";

export const metadata: Metadata = { title: "Owners — Admin" };

const FILTERS = [
  { key: "all",         label: "All",         value: undefined as undefined | "verified" | "unverified" },
  { key: "unverified",  label: "Unverified",  value: "unverified" as const },
  { key: "verified",    label: "Verified",    value: "verified"   as const },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

type Props = { searchParams: Promise<{ filter?: string }> };

export default async function AdminOwnersPage({ searchParams }: Props) {
  const { filter } = await searchParams;
  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];

  const [owners, pendingProfiles] = await Promise.all([
    fetchAllOwners(activeFilter.value),
    fetchPendingOwnerProfiles(),
  ]);

  return (
    <div>
      <AdminPageHeader
        title="Owners"
        description="Approve owner accounts, verify business details, and manage verified owners."
      />

      <div className="px-4 py-4 sm:px-6 lg:px-8 space-y-5">

        {/* Pending profiles (no hall_owners row yet) */}
        {pendingProfiles.length > 0 && (
          <section>
            <h2 className="mb-3 font-serif text-sm font-semibold text-charcoal-900">
              Pending owner approvals
              <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                {pendingProfiles.length}
              </span>
            </h2>
            <p className="mb-3 text-xs text-charcoal-500">
              These users signed up as owners and are waiting for admin approval before they can list halls.
            </p>
            <div className="space-y-2">
              {pendingProfiles.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-3 shadow-card">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 font-bold text-sm">
                    {(p.full_name ?? p.email ?? "?")[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-charcoal-900">{p.full_name ?? "—"}</p>
                    <p className="truncate text-[11px] text-charcoal-500">{p.email}</p>
                    <p className="text-[10px] text-charcoal-400">Signed up {fmtDate(p.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <ConfirmButton
                      action={async () => approveOwner(p.id)}
                      label="Approve"
                      confirmText="Confirm approve"
                      variant="success"
                      hideOnSuccess
                      doneLabel="✓ Approved"
                    />
                    <ConfirmButton
                      action={async () => rejectOwner(p.id)}
                      label="Reject"
                      confirmText="Confirm reject"
                      variant="destructive"
                      hideOnSuccess
                      doneLabel="✓ Rejected"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Filter */}
        <div>
          <h2 className="mb-3 font-serif text-sm font-semibold text-charcoal-900">All owner businesses</h2>
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
        </div>

        {/* Owners list */}
        {owners.length === 0 ? (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-charcoal-500 shadow-card">
            No owner businesses in this category.
          </p>
        ) : (
          <div className="space-y-2">
            {owners.map((o) => (
              <div key={o.id} className="rounded-2xl bg-white p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-serif text-sm font-semibold text-charcoal-900 truncate">
                        {o.business_name}
                      </p>
                      {o.is_verified
                        ? <Badge variant="success" size="sm"><BadgeCheck className="h-3 w-3" /> Verified</Badge>
                        : <Badge variant="warning" size="sm">Unverified</Badge>
                      }
                    </div>
                    <p className="text-xs text-charcoal-500">
                      Owner: <strong className="text-charcoal-700">{o.full_name ?? "—"}</strong> · {o.email}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-charcoal-600 sm:grid-cols-4">
                      <Field label="GST" value={o.gst_number} />
                      <Field label="PAN" value={o.pan_number} />
                      <Field label="City" value={o.city} />
                      <Field label="UPI" value={o.payout_upi} />
                    </div>
                    <p className="mt-1 text-[10px] text-charcoal-400">Registered {fmtDate(o.created_at)}</p>
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-1">
                    {!o.is_verified && (
                      <ConfirmButton
                        action={async () => verifyOwnerRow(o.id)}
                        label="Verify business"
                        confirmText="Confirm verify"
                        variant="success"
                        hideOnSuccess
                        doneLabel="✓ Verified"
                      />
                    )}
                    {o.profile_role === "owner_approved" ? (
                      <span className="text-[10px] font-semibold text-green-700">Active owner</span>
                    ) : (
                      <ConfirmButton
                        action={async () => approveOwner(o.profile_id)}
                        label="Approve as owner"
                        confirmText="Confirm approve"
                        variant="success"
                        hideOnSuccess
                        doneLabel="✓ Approved"
                      />
                    )}
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

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <span className="text-charcoal-400 mr-1">{label}:</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );
}
