import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText, ShieldCheck } from "lucide-react";
import { fetchAuditLog, type AdminAuditRow } from "@/lib/admin";
import { AdminPageHeader } from "../_components/AdminPageHeader";

export const metadata: Metadata = { title: "Audit Log — Admin" };

const ENTITY_FILTERS = [
  { key: "all",                label: "All",         value: undefined },
  { key: "hall",               label: "Halls",       value: "hall" },
  { key: "user",               label: "Users",       value: "user" },
  { key: "advertisement",      label: "Ads",         value: "advertisement" },
  { key: "premium_listing",    label: "Premium",     value: "premium_listing" },
  { key: "review",             label: "Reviews",     value: "review" },
  { key: "commission_payment", label: "Commissions", value: "commission_payment" },
];

/** Colour by intent so a suspension never reads like an approval at a glance. */
function toneFor(action: string): string {
  if (/(approve|activate|reactivate|verify|show|unsuspend)/.test(action)) {
    return "bg-green-50 text-green-700 border-green-200";
  }
  if (/(reject|suspend|delete|cancel|hide|paused)/.test(action)) {
    return "bg-red-50 text-red-700 border-red-200";
  }
  return "bg-charcoal-50 text-charcoal-700 border-charcoal-200";
}

function fmtWhen(iso: string) {
  // Business timezone — an admin in Madurai must see IST, not the server's UTC.
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function Transition({ row }: { row: AdminAuditRow }) {
  if (!row.previous_status && !row.new_status) return null;
  return (
    <span className="text-[11px] text-charcoal-500">
      {row.previous_status ?? "—"} <span aria-hidden>→</span>{" "}
      <span className="font-semibold text-charcoal-800">{row.new_status ?? "—"}</span>
    </span>
  );
}

type Props = { searchParams: Promise<{ entity?: string; q?: string; page?: string }> };

export default async function AdminAuditLogPage({ searchParams }: Props) {
  const { entity, q, page } = await searchParams;
  const activeFilter = ENTITY_FILTERS.find((f) => f.key === entity) ?? ENTITY_FILTERS[0];
  const search = (q ?? "").trim();
  const pageNum = Number.parseInt(page ?? "1", 10) || 1;

  const log = await fetchAuditLog({
    entityType: activeFilter.value,
    search:     search || undefined,
    page:       pageNum,
  });

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = {
      entity: activeFilter.key === "all" ? undefined : activeFilter.key,
      q:      search || undefined,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const str = p.toString();
    return str ? `/admin/audit-logs?${str}` : "/admin/audit-logs";
  };

  return (
    <div>
      <AdminPageHeader
        title="Audit Log"
        description="Every privileged admin action, in order. Append-only — entries can never be edited or deleted."
      />

      <div className="p-4 sm:p-6 lg:p-8">
        {/* Filters */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {ENTITY_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={qs({ entity: f.key === "all" ? undefined : f.key, page: undefined })}
              className={
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
                (f.key === activeFilter.key
                  ? "bg-maroon-600 text-white"
                  : "border border-border bg-white text-charcoal-600 hover:bg-ivory-50")
              }
            >
              {f.label}
            </Link>
          ))}
        </div>

        <form action="/admin/audit-logs" className="mb-4 flex gap-2">
          {activeFilter.key !== "all" && (
            <input type="hidden" name="entity" value={activeFilter.key} />
          )}
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search admin email, action or reason…"
            className="min-h-[44px] flex-1 rounded-xl border border-border bg-white px-3.5 text-sm text-charcoal-900 outline-none focus:border-maroon-500 focus:ring-1 focus:ring-maroon-500 lg:max-w-sm"
          />
          <button
            type="submit"
            className="min-h-[44px] rounded-xl bg-charcoal-900 px-4 text-sm font-semibold text-white hover:bg-charcoal-800"
          >
            Search
          </button>
        </form>

        {log.unavailable ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-amber-500" />
            <p className="mt-2 text-sm font-semibold text-amber-900">Audit log not provisioned</p>
            <p className="mt-1 text-xs text-amber-700">
              Run migration <code className="font-mono">0025_admin_audit_log.sql</code> to start
              recording admin actions.
            </p>
          </div>
        ) : log.rows.length === 0 ? (
          <div className="rounded-2xl border border-border bg-white p-10 text-center">
            <ScrollText className="mx-auto h-8 w-8 text-charcoal-300" />
            <p className="mt-2 text-sm font-semibold text-charcoal-900">No entries yet</p>
            <p className="mt-1 text-xs text-charcoal-500">
              {search || activeFilter.key !== "all"
                ? "No admin actions match these filters."
                : "Approvals, suspensions and other admin actions will be recorded here."}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile: stacked cards. Admin tables clip badly on small screens. */}
            <div className="space-y-2 lg:hidden">
              {log.rows.map((row) => (
                <div key={row.id} className="rounded-xl border border-border bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${toneFor(row.action)}`}
                    >
                      {row.action}
                    </span>
                    <span className="shrink-0 text-[10px] text-charcoal-400">
                      {fmtWhen(row.created_at)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-charcoal-700">
                    <span className="font-semibold">{row.actor_email ?? "Unknown admin"}</span>
                    {" · "}
                    <span className="text-charcoal-500">{row.entity_type}</span>
                  </p>
                  <div className="mt-1">
                    <Transition row={row} />
                  </div>
                  {row.reason && (
                    <p className="mt-1.5 rounded-lg bg-ivory-50 p-2 text-[11px] text-charcoal-600">
                      {row.reason}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden overflow-hidden rounded-2xl border border-border bg-white lg:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-ivory-50 text-[11px] uppercase tracking-wide text-charcoal-500">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">When</th>
                    <th className="px-4 py-2.5 font-semibold">Admin</th>
                    <th className="px-4 py-2.5 font-semibold">Action</th>
                    <th className="px-4 py-2.5 font-semibold">Entity</th>
                    <th className="px-4 py-2.5 font-semibold">Change</th>
                    <th className="px-4 py-2.5 font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {log.rows.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-charcoal-500">
                        {fmtWhen(row.created_at)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-charcoal-800">
                        {row.actor_email ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${toneFor(row.action)}`}
                        >
                          {row.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-charcoal-600">
                        {row.entity_type}
                        {row.entity_id && (
                          <span className="block font-mono text-[10px] text-charcoal-400">
                            {row.entity_id.slice(0, 8)}…
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Transition row={row} />
                      </td>
                      <td className="max-w-xs px-4 py-2.5 text-xs text-charcoal-600">
                        {row.reason ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {log.pages > 1 && (
              <div className="mt-4 flex items-center justify-between text-xs text-charcoal-600">
                <span>
                  Page {log.page} of {log.pages} · {log.total.toLocaleString("en-IN")} entries
                </span>
                <div className="flex gap-2">
                  {log.page > 1 && (
                    <Link
                      href={qs({ page: String(log.page - 1) })}
                      className="rounded-lg border border-border bg-white px-3 py-2 font-semibold hover:bg-ivory-50"
                    >
                      Previous
                    </Link>
                  )}
                  {log.page < log.pages && (
                    <Link
                      href={qs({ page: String(log.page + 1) })}
                      className="rounded-lg border border-border bg-white px-3 py-2 font-semibold hover:bg-ivory-50"
                    >
                      Next
                    </Link>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
