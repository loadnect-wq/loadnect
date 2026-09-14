import Image from "next/image";
import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import Link from "next/link";
import { Building2, ExternalLink, Sparkles } from "lucide-react";
import { fetchAllHalls } from "@/lib/admin";
import { formatPrice } from "@/lib/mock-data";
import { hasPrice, PRICE_ON_REQUEST } from "@/lib/booking-mode";
import { Badge } from "@/components/ui/Badge";
import { HALL_COMMISSION_RATES } from "@/lib/validation/schemas";
import { sortByCommissionRate } from "@/lib/hall-commission";
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

type Props = { searchParams: Promise<{ status?: string; commission?: string; sort?: string; mode?: string }> };

/**
 * Booking-mode filter. Deliberately its own row rather than another value in
 * the status chips: mode and status are orthogonal (a lead venue can be
 * pending, approved or suspended), and folding them into one row would make
 * "approved" and "Lead Generation" mutually exclusive when they are not.
 */
const MODE_FILTERS = [
  { key: "all",             label: "All modes" },
  { key: "DIRECT_BOOKING",  label: "Direct Booking" },
  { key: "LEAD_GENERATION", label: "Lead Generation" },
] as const;

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

/**
 * Sort options. "newest" is the default and is what this page has always done
 * (fetchAllHalls orders by created_at desc in the query); the two commission
 * orders are applied in memory, because the rate is not a column this page's
 * session client may read — see the note where the sort is applied.
 */
const SORTS = [
  { key: "newest",    label: "Newest" },
  { key: "comm_desc", label: "Commission, high to low" },
  { key: "comm_asc",  label: "Commission, low to high" },
] as const;

/**
 * One place that builds this page's URLs, so a chip in any of the three rows
 * preserves the other two. Written once because the alternative — three
 * near-identical URLSearchParams blocks — is how a filter silently starts
 * dropping the sort the moment someone edits one of them.
 */
function hrefFor(current: { status: string; commission: string; sort: string; mode: string }): string {
  const params = new URLSearchParams();
  if (current.status !== "all") params.set("status", current.status);
  if (current.commission !== "all") params.set("commission", current.commission);
  if (current.mode !== "all") params.set("mode", current.mode);
  if (current.sort !== "newest") params.set("sort", current.sort);
  const qs = params.toString();
  return qs ? `?${qs}` : "?";
}

export default async function AdminHallsPage({ searchParams }: Props) {
  // ASSERTS ITS OWN ROLE. The layout also calls requireRole, but a layout and
  // its page render CONCURRENTLY in the App Router — the layout's redirect does
  // not stop this component's queries from being issued first. An anonymous
  // request therefore ran every read below as `anon`, was denied by the grants,
  // and only then got its 307. Nothing leaked, but the work was wasted and each
  // denial now logs at error level, which would bury real failures. Guarding
  // here also means this page is not relying on a file it does not control.
  await requireRole(["admin"]);
  const { status, commission, sort, mode } = await searchParams;
  const activeFilter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const activeCommission =
    COMMISSION_FILTERS.find((f) => f.key === commission) ?? COMMISSION_FILTERS[0];
  const activeMode = MODE_FILTERS.find((m) => m.key === mode) ?? MODE_FILTERS[0];
  const activeSort = SORTS.find((s) => s.key === sort) ?? SORTS[0];

  const allHalls = await fetchAllHalls(activeFilter.value);

  // Filtered in memory, not in the query: the rate is not readable by the
  // session client this page's query runs on (migration 0072), so it arrives
  // merged in from a service-role read afterwards. These pages are already
  // fully materialised — fetchAllHalls has no pagination — so this costs
  // nothing beyond an array pass.
  const byCommission =
    activeCommission.key === "all"
      ? allHalls
      : activeCommission.key === "unset"
        ? allHalls.filter((h) => h.commission_rate == null)
        : allHalls.filter((h) => h.commission_rate === Number(activeCommission.key));

  // booking_mode IS a readable column, so this one could have gone in the
  // query. It is done here so the two filters compose the same way and so the
  // counts on every chip are computed against the same materialised set —
  // a mode filter in SQL and a commission filter in memory would make the
  // commission chips count rows the mode filter had already removed.
  const filtered =
    activeMode.key === "all"
      ? byCommission
      : byCommission.filter((h) => h.booking_mode === activeMode.key);

  // SORTED IN MEMORY, for the same reason it is filtered in memory: the query
  // above runs on the session client, which migration 0072 forbids from reading
  // commission_rate at all, so `.order("commission_rate")` would raise 42501 —
  // and lib/admin.ts swallows that into `return []`, blanking the page. The
  // value only exists after the service-role merge, which is here.
  //
  // Sorting the whole set is only honest because fetchAllHalls has no LIMIT or
  // RANGE: every matching hall is already in `allHalls`. If pagination is ever
  // added to that query, this sort silently becomes "sort the current page",
  // which is worse than no sort at all — move it into the query then, which
  // will mean moving the whole read to the service role.
  //
  // Unconfigured halls go LAST in both directions rather than sorting as 0 or
  // as Infinity. They are not a low rate or a high one; they are an absent one,
  // and burying real rates behind them would make the sort useless in exactly
  // the case it is reached for. They remain one click away via the
  // "Not configured" chip, which carries a count.
  const halls =
    activeSort.key === "newest"
      ? filtered
      : sortByCommissionRate(filtered, activeSort.key === "comm_asc" ? "asc" : "desc");

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
              href={hrefFor({
                status: f.key,
                commission: activeCommission.key,
                mode: activeMode.key,
                sort: activeSort.key,
              })}
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

        {/* Booking mode. An admin needs to know at a glance which venues take
            money through Hallnect and which only take enquiries, because the
            two settle in opposite directions — one commission is retained from
            a customer advance, the other is billed to the venue. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">
            Mode
          </span>
          {MODE_FILTERS.map((m) => {
            const count =
              m.key === "all"
                ? allHalls.length
                : allHalls.filter((h) => h.booking_mode === m.key).length;
            return (
              <Link
                key={m.key}
                href={hrefFor({
                  status: activeFilter.key,
                  commission: activeCommission.key,
                  mode: m.key,
                  sort: activeSort.key,
                })}
                className={[
                  "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tabular-nums",
                  activeMode.key === m.key
                    ? "border-maroon-700 bg-maroon-700 text-white"
                    : "border-border bg-white text-charcoal-600 hover:border-maroon-300",
                ].join(" ")}
              >
                {m.label} ({count})
              </Link>
            );
          })}
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
            return (
              <Link
                key={f.key}
                href={hrefFor({
                  status: activeFilter.key,
                  commission: f.key,
                  mode: activeMode.key,
                  sort: activeSort.key,
                })}
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

        {/* Sort. Same row treatment as the commission filter — it is the other
            secondary lens — and it composes with both chip rows above rather
            than replacing them. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">
            Sort
          </span>
          {SORTS.map((o) => (
            <Link
              key={o.key}
              href={hrefFor({
                status: activeFilter.key,
                commission: activeCommission.key,
                mode: activeMode.key,
                sort: o.key,
              })}
              aria-current={activeSort.key === o.key ? "true" : undefined}
              className={[
                "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                activeSort.key === o.key
                  ? "border-maroon-700 bg-maroon-700 text-white"
                  : "border-border bg-white text-charcoal-600 hover:border-maroon-300",
              ].join(" ")}
            >
              {o.label}
            </Link>
          ))}
          {activeSort.key !== "newest" && unconfigured > 0 && (
            <span className="text-[11px] text-charcoal-500">
              {unconfigured} unconfigured hall{unconfigured !== 1 ? "s" : ""} sorted last
            </span>
          )}
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
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-maroon-50">
                      {h.cover_url ? (
                        <Image src={h.cover_url} alt="" fill sizes="64px" className="object-cover" />
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
                        <span>💰 {hasPrice(h.price_per_day) ? `${formatPrice(h.price_per_day)}/day` : PRICE_ON_REQUEST}</span>
                        {/* The commercial term, not a customer-facing figure.
                            Amber rather than neutral when unset: such a hall
                            bills at the platform default, which nobody agreed
                            to, so it should read as needing attention. */}
                        {/* Mode badge. Amber for lead generation, because it
                            is the mode where Hallnect has to COLLECT rather
                            than deduct — which is the row an admin chasing
                            money needs to spot. */}
                        {h.booking_mode === "LEAD_GENERATION" ? (
                          <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                            Lead Generation
                          </span>
                        ) : (
                          <span className="rounded-full border border-border bg-ivory-50 px-1.5 py-0.5 text-[10px] font-semibold text-charcoal-500">
                            Direct
                          </span>
                        )}
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
