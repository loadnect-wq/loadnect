import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertCircle, Building2, CalendarDays, CheckCircle2,
  IndianRupee, Plus, Sparkles, Clock, Wallet,
} from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerRow, fetchOwnerHalls, fetchOwnerStats, fetchOwnerCommissions } from "@/lib/owner";
import { formatPrice } from "@/lib/mock-data";
import { advanceFromTotal } from "@/lib/booking-payment";
import { fetchPremiumPlans, PLAN_FEATURES } from "@/lib/premium-plans";
import { Badge } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import { AppHeader } from "@/components/app/AppHeader";

export const metadata: Metadata = { title: "Owner Dashboard" };

const HALL_STATUS_CFG: Record<string, { label: string; variant: "success" | "warning" | "secondary" | "destructive" | "default" }> = {
  approved:         { label: "Live",     variant: "success"     },
  pending_approval: { label: "Pending",  variant: "warning"     },
  draft:            { label: "Draft",    variant: "secondary"   },
  rejected:         { label: "Rejected", variant: "destructive" },
  suspended:        { label: "Suspended",variant: "destructive" },
};

export default async function OwnerDashboardPage() {
  const profile = await requireRole(["owner_approved"]);
  const ownerRow = await fetchOwnerRow();

  if (!ownerRow) {
    return (
      <div className="min-h-screen bg-ivory-100">
        <AppHeader title="Owner Dashboard" />
        <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-2xl">
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-6 space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-amber-600" />
              <div>
                <p className="font-semibold text-amber-900">Complete your business profile</p>
                <p className="mt-1 text-sm text-amber-800">
                  Before listing halls, you need to add your business details.
                </p>
              </div>
            </div>
            <Link href="/owner/profile" className={buttonVariants({ variant: "gold", size: "sm" })}>
              Complete Profile
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const halls   = await fetchOwnerHalls(ownerRow.id);
  const hallIds = halls.map((h) => h.id);
  const [stats, commissions, plans] = await Promise.all([
    fetchOwnerStats(ownerRow.id, hallIds),
    fetchOwnerCommissions(hallIds),
    fetchPremiumPlans(),
  ]);
  const paidPlans = plans.filter((p) => p.monthly_price > 0 && p.is_purchasable);

  // Settlement snapshot — all figures derived from server-fetched commission
  // rows (never client-supplied).
  //
  // There is no 'outstanding' bucket any more: commission is retained from the
  // customer's advance at settlement, so an owner never owes Hallnect anything
  // and this panel is purely informational.
  //
  // Per the settlement model (lib/booking-payment.ts): gross advance paid by
  // customers, Hallnect's commission out of it, and the owner's NET ADVANCE
  // (gross − commission). advance_amount is 0 only on very old rows — fall
  // back to a 25% estimate from the booking amount for those.
  const grossAdvance = commissions.reduce(
    (s, c) => s + (c.advance_amount > 0 ? c.advance_amount : advanceFromTotal(c.booking_amount)), 0);
  // A waived commission was never taken, so it must not reduce the owner's net
  // advance — counting it understated what they actually received.
  const totalCommission = commissions
    .filter((c) => c.status !== "waived")
    .reduce((s, c) => s + c.commission_amount, 0);
  const netAdvance = Math.max(0, Math.round((grossAdvance - totalCommission) * 100) / 100);

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Dashboard" />

      <div className="px-4 py-5 sm:px-6 lg:px-8 space-y-6">

        {/* Welcome */}
        <div>
          <h1 className="font-serif text-2xl font-bold text-charcoal-900">
            Welcome{profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}
          </h1>
          <p className="text-sm text-charcoal-500">{ownerRow.business_name}</p>
          {!ownerRow.is_verified && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              Your business details are awaiting verification. You can add and manage halls in the meantime — each hall is approved separately.
            </div>
          )}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard
            icon={<Building2 className="h-5 w-5 text-maroon-600" />}
            label="Total Halls"
            value={stats.totalHalls}
          />
          <StatCard
            icon={<CheckCircle2 className="h-5 w-5 text-green-600" />}
            label="Live Halls"
            value={stats.approvedHalls}
          />
          <StatCard
            icon={<CalendarDays className="h-5 w-5 text-amber-600" />}
            label="Pending Requests"
            value={stats.pendingBookings}
            highlight={stats.pendingBookings > 0}
          />
          <StatCard
            icon={<IndianRupee className="h-5 w-5 text-emerald-600" />}
            label="Total Revenue"
            value={formatPrice(stats.totalRevenue)}
            wide
          />
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2">
          <Link href="/owner/halls/new" className={buttonVariants({ variant: "gold", size: "sm" })}>
            <Plus className="h-4 w-4" /> Add Hall
          </Link>
          <Link href="/owner/bookings" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <CalendarDays className="h-4 w-4" /> View Bookings
          </Link>
          <Link href="/owner/revenue" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <IndianRupee className="h-4 w-4" /> Revenue
          </Link>
          <Link href="/owner/commissions" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Wallet className="h-4 w-4" /> Payouts
          </Link>
        </div>

        {/* ── Settlement & commission snapshot ──────────────────────────────
            Mobile-first: single column, stacks cleanly; side-by-side from sm.  */}
        <section className="rounded-2xl border border-border bg-white p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-serif text-base font-semibold text-charcoal-900">
              Settlement &amp; commission
            </h2>
            <Badge variant="success" size="sm">Nothing to pay</Badge>
          </div>

          <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <SettlementRow label="Gross advance" value={formatPrice(grossAdvance)} />
            <SettlementRow label="Hallnect commission" value={formatPrice(totalCommission)} tone="commission" />
            <SettlementRow label="Net advance to you" value={formatPrice(netAdvance)} tone="payout" />
          </dl>
          <p className="mt-2 text-[11px] text-charcoal-500">
            The commission is retained from the advance — you are never billed for it, and the
            customer&apos;s ₹200 platform fee is never deducted from you. The venue balance is
            collected by you directly.
          </p>

        </section>

        {/* ── Subscription upgrade ──────────────────────────────────────── */}
        <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-maroon-900 to-maroon-950 p-4 text-ivory-100 shadow-elevated">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gold-300">
            <Sparkles className="h-3.5 w-3.5" /> Grow your bookings
          </p>
          <h2 className="mt-1.5 font-serif text-lg font-bold">Upgrade your listing</h2>
          {/* The SAME catalogue the plans page sells from (premium_plans +
              PLAN_FEATURES). This used to render a second hardcoded list that
              named the Rs4,999 plan "Pro" and advertised a nonexistent
              "Elite" tier, so an owner saw one set of names here and another
              when they went to buy. */}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {paidPlans.map((plan) => (
              <PlanTile
                key={plan.slug}
                name={plan.name}
                price={`${formatPrice(plan.monthly_price)}/${plan.duration_days}d`}
                perks={PLAN_FEATURES[plan.slug].slice(-2).map((f) => f.label)}
              />
            ))}
          </div>
          <Link
            href="/owner/premium"
            className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-gold-gradient px-4 text-sm font-bold text-charcoal-950 transition active:scale-[0.97] motion-reduce:active:scale-100"
          >
            Compare plans
          </Link>
        </section>

        {/* Halls summary */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-serif text-base font-semibold text-charcoal-900">My Halls</h2>
            <Link href="/owner/halls" className="text-xs font-semibold text-maroon-600 hover:underline">
              View all
            </Link>
          </div>

          {halls.length === 0 ? (
            <div className="rounded-2xl bg-white p-6 shadow-card text-center">
              <Building2 className="mx-auto h-10 w-10 text-charcoal-300 mb-3" />
              <p className="font-serif text-sm font-semibold text-charcoal-700">No halls yet</p>
              <p className="mt-1 text-xs text-charcoal-500">Add your first venue to start receiving bookings.</p>
              <div className="mt-4">
                <Link href="/owner/halls/new" className={buttonVariants({ variant: "gold", size: "sm" })}>
                  <Plus className="h-4 w-4" /> Add Hall
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {halls.slice(0, 5).map((hall) => {
                const cfg = HALL_STATUS_CFG[hall.status] ?? { label: hall.status, variant: "secondary" as const };
                return (
                  <div key={hall.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card">
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-maroon-50">
                      {hall.cover_url && (
                        <img src={hall.cover_url} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-sm font-semibold text-charcoal-900">{hall.name}</p>
                      <p className="text-xs text-charcoal-500">{hall.city}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>
                      {hall.is_premium && (
                        <span className="flex items-center gap-0.5 text-[10px] font-bold text-gold-600">
                          <Sparkles className="h-3 w-3" /> Premium
                        </span>
                      )}
                    </div>
                    <Link
                      href={`/owner/halls/${hall.id}/edit`}
                      className="ml-1 shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-charcoal-600 hover:bg-ivory-100"
                    >
                      Edit
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SettlementRow({
  label, value, tone,
}: { label: string; value: string; tone?: "commission" | "payout" }) {
  return (
    <div className="rounded-xl bg-ivory-50 px-3 py-2.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-charcoal-500">{label}</dt>
      <dd className={[
        "mt-0.5 text-sm font-bold",
        tone === "commission" ? "text-maroon-700"
          : tone === "payout" ? "text-green-700"
          : "text-charcoal-900",
      ].join(" ")}>
        {value}
      </dd>
    </div>
  );
}

function PlanTile({ name, price, perks }: { name: string; price: string; perks: string[] }) {
  return (
    <div className="rounded-xl border border-maroon-800 bg-maroon-900/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-serif text-sm font-bold text-gold-300">{name}</p>
        <p className="text-xs font-semibold text-ivory-200">{price}</p>
      </div>
      <ul className="mt-1.5 space-y-1">
        {perks.map((p) => (
          <li key={p} className="flex items-start gap-1.5 text-[11px] text-ivory-300">
            <CheckCircle2 className="mt-px h-3 w-3 shrink-0 text-gold-400" aria-hidden />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatCard({
  icon, label, value, highlight = false, wide = false,
}: {
  icon:       React.ReactNode;
  label:      string;
  value:      string | number;
  highlight?: boolean;
  wide?:      boolean;
}) {
  return (
    <div className={[
      "rounded-2xl bg-white p-4 shadow-card",
      highlight ? "ring-2 ring-amber-300" : "",
      wide ? "col-span-2 sm:col-span-1" : "",
    ].join(" ")}>
      <div className="flex items-center gap-2 mb-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-maroon-50">
          {icon}
        </span>
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">{label}</p>
      <p className="mt-0.5 text-xl font-bold text-charcoal-900">{value}</p>
    </div>
  );
}
