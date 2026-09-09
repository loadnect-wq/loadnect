import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import Link from "next/link";
import { Building2, ExternalLink, Sparkles } from "lucide-react";
import { fetchAllHalls } from "@/lib/admin";
import { formatPrice } from "@/lib/mock-data";
import { Badge } from "@/components/ui/Badge";
import { HALL_COMMISSION_RATES } from "@/lib/validation/schemas";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { ConfirmButton } from "../_components/ConfirmButton";
import { ReasonButton } from "../_components/ReasonButton";
import { approveHall, rejectHall, suspendHall, unsuspendHall } from "../actions";

export const metadata: Metadata = { title: "Halls — Admin" };

const FILTERS = [
  { key: "all",       label: "All",       value: undefined         },
  { key: "approved",  label: "Live",      value: "approved"        },
  { key: "pending",   label: "Pending",   value: "pending_approval" },
  { key: "rejected",  label: "Rejected",  value: "rejected"        },
  { key: "suspended", label: "Suspended", value: "suspended"       },
];

const STATUS_CFG: Record<string, { label: string; variant: "success" | "warning" | "secondary" | "destructive" | "default" }> = {
  approved:         { label: "Live",      variant: "success"     },
  pending_approval: { label: "Pending",   variant: "warning"     },
  rejected:         { label: "Rejected",  variant: "destructive" },
  suspended:        { label: "Suspended", variant: "destructive" },
  draft:            { label: "Draft",     variant: "secondary"   },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

type Props = { searchParams: Promise<{ status?: string; commission?: string }> };

/**
 * Commission filter options. "unset" is the one that earns its place: a hall
 * with no configured rate bills at the platform default, which is a commercial
 * term nobody agreed to, so admin needs to be able to list exactly those.
 */
const COMMISSION_FILTERS = [
  { key: "all",   label: "All rates" },
  { key: "unset", label: "Not configured" },
  ...HALL_COMMISSION_RATES.map((r) => ({ key: String(r), label: `${r}%` })),
] as const;

export default async function AdminHallsPage({ searchParams }: Props) {
  // ASSERTS ITS OWN ROLE. The layout also calls requireRole, but a layout and
  // its page render CONCURRENTLY in the App Router — the layout's redirect does
  // not stop this component's queries from being issued first. An anonymous
  // request therefore ran every read below as `anon`, was denied by the grants,
  // and only then got its 307. Nothing leaked, but the work was wasted and each
  // denial now logs at error level, which would bury real failures. Guarding
  // here also means this page is not relying on a file it does not control.
  await requireRole(["admin"]);
  const { status, commission } = await searchParams;
  const activeFilter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const activeCommission =
    COMMISSION_FILTERS.find((f) => f.key === commission) ?? COMMISSION_FILTERS[0];

  const allHalls = await fetchAllHalls(activeFilter.value);

  // Filtered in memory, not in the query: the rate is not readable by the
  // session client this page's query runs on (migration 0072), so it arrives
  // merged in from a service-role read afterwards. These pages are already
  // fully materialised — fetchAllHalls has no pagination — so this costs
  // nothing beyond an array pass.
  const halls =
    activeCommission.key === "all"
      ? allHalls
      : activeCommission.key === "unset"
        ? allHalls.filter((h) => h.commission_rate == null)
        : allHalls.filter((h) => h.commission_rate === Number(activeCommission.key));

  const unconfigured = allHalls.filter((h) => h.commission_rate == null).length;

  return (
    <div>
      <AdminPageHeader
        title="Halls"
        description={`${halls.length} ${activeFilter.label.toLowerCase()} hall${halls.length !== 1 ? "s" : ""}`}
      />

      <div className="px-4 py-4 sm:px-6 lg:px-8 space-y-4">

        {/* Filter chips */}
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

        {/* Commission filter. Kept on its own row and visually lighter than the
            status chips above: status is the primary axis of this page and the
            commission rate is a secondary lens on it. Both are carried in the
            query string so a filtered view is linkable. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">
            Commission
          </span>
          {COMMISSION_FILTERS.map((f) => {
            const params = new URLSearchParams();
            if (activeFilter.key !== "all") params.set("status", activeFilter.key);
            if (f.key !== "all") params.set("commission", f.key);
            const qs = params.toString();
            return (
              <Link
                key={f.key}
                href={qs ? `?${qs}` : "?"}
                className={[
                  "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tabular-nums",
                  activeCommission.key === f.key
                    ? "border-maroon-700 bg-maroon-700 text-white"
                    : f.key === "unset" && unconfigured > 0
                      ? "border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400"
                      : "border-border bg-white text-charcoal-600 hover:border-maroon-300",
                ].join(" ")}
              >
                {f.label}
                {f.key === "unset" && unconfigured > 0 && ` (${unconfigured})`}
              </Link>
            );
          })}
        </div>

        {halls.length === 0 ? (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-charcoal-500 shadow-card">
            No halls match this filter.
          </p>
        ) : (
          <div className="space-y-2">
            {halls.map((h) => {
              const cfg = STATUS_CFG[h.status] ?? { label: h.status, variant: "secondary" as const };
              return (
                <div key={h.id} className="rounded-2xl bg-white p-3 shadow-card">
                  <div className="flex items-start gap-3">
                    {/* Thumb */}
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-maroon-50">
                      {h.cover_url ? (
                        <img src={h.cover_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Building2 className="h-6 w-6 text-maroon-300" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-serif text-sm font-semibold text-charcoal-900 truncate">{h.name}</p>
                          <p className="text-[11px] text-charcoal-500">
                            {h.city}{h.state ? `, ${h.state}` : ""} · Created {fmtDate(h.created_at)}
                          </p>
                          {h.owner_business && (
                            <p className="text-[11px] text-charcoal-500">
                              <span className="text-charcoal-400">Owner:</span> {h.owner_business}
                              {h.owner_name && <span> ({h.owner_name})</span>}
                            </p>
                          )}
                        </div>
                        <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-charcoal-600">
                        <span>👥 Up to {h.capacity_max.toLocaleString("en-IN")}</span>
                        <span>💰 {formatPrice(h.price_per_day)}/day</span>
                        {/* The commercial term, not a customer-facing figure.
                            Amber rather than neutral when unset: such a hall
                            bills at the platform default, which nobody agreed
                            to, so it should read as needing attention. */}
                        {h.commission_rate != null ? (
                          <span className="font-semibold text-charcoal-700">
                            Commission {h.commission_rate}%
                          </span>
                        ) : (
                          <span className="font-semibold text-amber-700">
                            Commission not configured
                          </span>
                        )}
                        {h.rating_count > 0 && (
                          <span>⭐ {h.rating_average.toFixed(1)} ({h.rating_count})</span>
                        )}
                        {h.is_premium && (
                          <span className="flex items-center gap-0.5 font-bold text-gold-600">
                            <Sparkles className="h-3 w-3" /> Premium
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
                    <Link
                      href={h.status === "approved" ? `/halls/${h.slug}` : `#`}
                      target={h.status === "approved" ? "_blank" : undefined}
                      className="flex items-center gap-1 text-[11px] font-semibold text-maroon-600 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {h.status === "approved" ? "View public page" : "Not public"}
                    </Link>

                    <div className="relative flex flex-wrap gap-1.5">
                      {h.status === "pending_approval" && (
                        <>
                          <ConfirmButton
                            action={approveHall.bind(null, h.id)}
                            label="Approve"
                            confirmText="Confirm approve"
                            variant="success"
                            hideOnSuccess doneLabel="✓ Approved"
                          />
                          <ReasonButton
                            action={rejectHall.bind(null, h.id)}
                            label="Reject"
                            title="Reject this hall"
                            placeholder="e.g. Photos do not match the venue address provided."
                          />
                        </>
                      )}
                      {h.status === "approved" && (
                        <ReasonButton
                          action={suspendHall.bind(null, h.id)}
                          label="Suspend"
                          title="Suspend this hall"
                          placeholder="e.g. Repeated booking no-shows reported by customers."
                          variant="warning"
                        />
                      )}
                      {h.status === "suspended" && (
                        <ConfirmButton
                          action={unsuspendHall.bind(null, h.id)}
                          label="Unsuspend"
                          confirmText="Confirm unsuspend"
                          variant="success"
                        />
                      )}
                      {h.status === "rejected" && (
                        <ConfirmButton
                          action={approveHall.bind(null, h.id)}
                          label="Approve"
                          confirmText="Confirm approve"
                          variant="success"
                          hideOnSuccess doneLabel="✓ Approved"
                        />
                      )}
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
