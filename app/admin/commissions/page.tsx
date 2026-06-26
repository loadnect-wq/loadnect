import type { Metadata } from "next";
import Link from "next/link";
import { TrendingUp, Wallet } from "lucide-react";
import { fetchAllCommissions, fetchOwnerOptions } from "@/lib/admin";
import { formatPrice } from "@/lib/mock-data";
import { Badge } from "@/components/ui/Badge";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { CommissionFilterBar } from "./_components/CommissionFilterBar";

export const metadata: Metadata = { title: "Commissions — Admin" };

type BadgeVar = "success" | "warning" | "secondary" | "destructive" | "default";

const FILTERS = [
  { key: "all",        label: "All",        value: undefined  },
  { key: "pending",    label: "Pending",    value: "pending"  },
  { key: "collected",  label: "Collected",  value: "collected" },
  { key: "paid_out",   label: "Paid Out",   value: "paid_out"  },
  { key: "refunded",   label: "Refunded",   value: "refunded"  },
];

const STATUS_CFG: Record<string, { label: string; variant: BadgeVar }> = {
  pending:   { label: "Pending",   variant: "warning"   },
  collected: { label: "Collected", variant: "success"   },
  paid_out:  { label: "Paid Out",  variant: "secondary" },
  refunded:  { label: "Refunded",  variant: "destructive" },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

type Props = { searchParams: Promise<{
  status?: string;
  owner?:  string;
  from?:   string;
  to?:     string;
}> };

export default async function AdminCommissionsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const activeFilter = FILTERS.find((f) => f.key === sp.status) ?? FILTERS[0];

  const [commissions, ownerOptions] = await Promise.all([
    fetchAllCommissions({
      status:  activeFilter.value,
      ownerId: sp.owner || undefined,
      from:    sp.from  || undefined,
      to:      sp.to    || undefined,
    }),
    fetchOwnerOptions(),
  ]);

  const totalCommission = commissions.reduce((s, c) => s + c.commission_amount,   0);
  const totalPayouts    = commissions.reduce((s, c) => s + c.owner_payout_amount, 0);
  const totalBookings   = commissions.reduce((s, c) => s + c.booking_amount,      0);

  // ── Group by owner for "View commission by owner" ─────────────────────────
  type OwnerAgg = { owner_business: string; bookings: number; commission: number; payout: number };
  const byOwner = new Map<string, OwnerAgg>();
  for (const c of commissions) {
    const key   = c.hall_owner_id ?? "_unknown";
    const label = c.owner_business ?? "Unknown owner";
    const cur = byOwner.get(key) ?? { owner_business: label, bookings: 0, commission: 0, payout: 0 };
    cur.bookings   += 1;
    cur.commission += c.commission_amount;
    cur.payout     += c.owner_payout_amount;
    byOwner.set(key, cur);
  }
  const ownerRollup = [...byOwner.entries()]
    .sort(([, a], [, b]) => b.commission - a.commission)
    .slice(0, 10);

  return (
    <div>
      <AdminPageHeader title="Commissions" description="Platform fee taken from each booking. Records are written by the server after payment success." />

      <div className="px-4 py-4 sm:px-6 lg:px-8 space-y-4">

        {/* Summary cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard
            icon={<TrendingUp className="h-4 w-4 text-charcoal-600" />}
            label="Gross bookings"
            value={formatPrice(totalBookings)}
          />
          <SummaryCard
            icon={<Wallet className="h-4 w-4 text-maroon-600" />}
            label="Total commission"
            value={formatPrice(totalCommission)}
            highlight
          />
          <SummaryCard
            icon={<Wallet className="h-4 w-4 text-charcoal-600" />}
            label="Owner payouts"
            value={formatPrice(totalPayouts)}
          />
        </div>

        {/* Filter bar — date range + owner dropdown (client) */}
        <CommissionFilterBar
          owners={ownerOptions}
          initial={{
            status: sp.status ?? "all",
            owner:  sp.owner  ?? "",
            from:   sp.from   ?? "",
            to:     sp.to     ?? "",
          }}
        />

        {/* Status chips — keep other filters when switching status */}
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const qs = new URLSearchParams();
            if (f.key !== "all") qs.set("status", f.key);
            if (sp.owner) qs.set("owner", sp.owner);
            if (sp.from)  qs.set("from",  sp.from);
            if (sp.to)    qs.set("to",    sp.to);
            const q = qs.toString();
            return (
              <Link
                key={f.key}
                href={q ? `?${q}` : "?"}
                className={[
                  "rounded-full border px-3 py-1 text-xs font-semibold",
                  activeFilter.key === f.key
                    ? "border-maroon-700 bg-maroon-700 text-white"
                    : "border-border bg-white text-charcoal-600 hover:border-maroon-300",
                ].join(" ")}
              >
                {f.label}
              </Link>
            );
          })}
        </div>

        {/* By-owner rollup (top 10 by commission in the current filter) */}
        {ownerRollup.length > 0 && (
          <div className="rounded-2xl bg-white shadow-card overflow-hidden">
            <div className="border-b border-border bg-ivory-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-charcoal-500">
              Commission by owner
            </div>
            <table className="min-w-full text-sm">
              <thead className="border-b border-border bg-ivory-50/50">
                <tr>
                  <Th>Owner</Th>
                  <Th>Bookings</Th>
                  <Th>Commission</Th>
                  <Th>Payout</Th>
                </tr>
              </thead>
              <tbody>
                {ownerRollup.map(([id, agg]) => (
                  <tr key={id} className="border-b border-border last:border-b-0 hover:bg-ivory-50/50">
                    <Td>{agg.owner_business}</Td>
                    <Td className="text-charcoal-500">{agg.bookings}</Td>
                    <Td className="font-semibold text-maroon-700">{formatPrice(agg.commission)}</Td>
                    <Td>{formatPrice(agg.payout)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {commissions.length === 0 ? (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-charcoal-500 shadow-card">
            No commissions match this filter.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white shadow-card">
            <table className="min-w-full text-sm">
              <thead className="bg-ivory-50 border-b border-border">
                <tr>
                  <Th>Booking</Th>
                  <Th>Hall / Owner</Th>
                  <Th>Booking ₹</Th>
                  <Th>Rate</Th>
                  <Th>Commission</Th>
                  <Th>Payout</Th>
                  <Th>Status</Th>
                  <Th>Date</Th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((c) => {
                  const cfg = STATUS_CFG[c.status] ?? { label: c.status, variant: "secondary" as BadgeVar };
                  return (
                    <tr key={c.id} className="border-b border-border last:border-b-0 hover:bg-ivory-50/50">
                      <Td>
                        <p className="font-mono text-[11px] text-charcoal-700">#{c.booking_id.slice(0,8).toUpperCase()}</p>
                      </Td>
                      <Td>
                        <p className="font-medium truncate max-w-[180px]">{c.hall_name}</p>
                        <p className="text-[11px] text-charcoal-500 truncate max-w-[180px]">{c.owner_business ?? "—"}</p>
                      </Td>
                      <Td>{formatPrice(c.booking_amount)}</Td>
                      <Td className="text-charcoal-500">{c.commission_rate}%</Td>
                      <Td className="font-semibold text-maroon-700">{formatPrice(c.commission_amount)}</Td>
                      <Td>{formatPrice(c.owner_payout_amount)}</Td>
                      <Td><Badge variant={cfg.variant} size="sm">{cfg.label}</Badge></Td>
                      <Td className="text-xs text-charcoal-500">{fmtDate(c.created_at)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon, label, value, highlight = false,
}: {
  icon: React.ReactNode; label: string; value: string; highlight?: boolean;
}) {
  return (
    <div className={[
      "rounded-2xl bg-white p-4 shadow-card",
      highlight ? "ring-2 ring-maroon-300" : "",
    ].join(" ")}>
      <div className="flex items-center gap-2 mb-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ivory-200">{icon}</span>
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">{label}</p>
      <p className="mt-0.5 text-xl font-bold text-charcoal-900">{value}</p>
    </div>
  );
}
function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-charcoal-500">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}
