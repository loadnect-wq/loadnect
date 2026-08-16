import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertCircle, Building2, CalendarDays, CheckCircle2,
  ClipboardCheck, MessageSquare, Users, Wallet,
} from "lucide-react";
import { fetchAdminStats } from "@/lib/admin";
import { formatPrice } from "@/lib/mock-data";
import { AdminPageHeader } from "../_components/AdminPageHeader";

export const metadata: Metadata = { title: "Admin Dashboard" };

export default async function AdminDashboardPage() {
  const stats = await fetchAdminStats();

  const queue: { count: number; label: string; href: string; color: string }[] = [
    {
      count: stats.open.pendingHalls,
      label: "Halls awaiting approval",
      href:  "/admin/hall-approvals",
      color: "border-amber-200 bg-amber-50 text-amber-900",
    },
    {
      count: stats.open.openTickets,
      label: "Open support tickets",
      href:  "/admin/support-tickets",
      color: "border-rose-200 bg-rose-50 text-rose-900",
    },
    {
      count: stats.open.pendingAds,
      label: "Ads awaiting review",
      href:  "/admin/advertisements",
      color: "border-purple-200 bg-purple-50 text-purple-900",
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Platform Overview"
        description="Snapshot of users, listings, bookings, and revenue across Hallnect."
      />

      <div className="px-4 py-5 sm:px-6 lg:px-8 space-y-6">

        {/* Action queue */}
        <section>
          <h2 className="mb-3 font-serif text-sm font-semibold text-charcoal-900">Needs attention</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {queue.map((q) => (
              <Link
                key={q.label}
                href={q.href}
                className={[
                  "block rounded-2xl border-2 px-4 py-3 transition-transform hover:-translate-y-0.5",
                  q.color,
                  q.count === 0 ? "opacity-60" : "",
                ].join(" ")}
              >
                <div className="flex items-start justify-between">
                  <p className="text-3xl font-bold leading-none">{q.count}</p>
                  {q.count > 0 && <AlertCircle className="h-4 w-4 mt-0.5" />}
                </div>
                <p className="mt-2 text-xs font-medium">{q.label}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* Stats grid */}
        <section className="grid gap-4 lg:grid-cols-3">
          {/* Users */}
          <StatGroup title="Users" icon={<Users className="h-4 w-4 text-maroon-600" />} href="/admin/users">
            <StatRow label="Customers"      value={stats.users.customers} />
            <StatRow label="Owners"         value={stats.users.ownersApproved} />
            <StatRow label="Admins"         value={stats.users.admins} />
            <StatRow label="Total"          value={stats.users.total} divider />
          </StatGroup>

          {/* Halls */}
          <StatGroup title="Halls" icon={<Building2 className="h-4 w-4 text-maroon-600" />} href="/admin/halls">
            <StatRow label="Live"      value={stats.halls.approved}  />
            <StatRow label="Pending"   value={stats.halls.pending}   highlight={stats.halls.pending > 0} />
            <StatRow label="Rejected"  value={stats.halls.rejected}  />
            <StatRow label="Suspended" value={stats.halls.suspended} />
            <StatRow label="Total"     value={stats.halls.total}     divider />
          </StatGroup>

          {/* Bookings */}
          <StatGroup title="Bookings" icon={<CalendarDays className="h-4 w-4 text-maroon-600" />} href="/admin/bookings">
            <StatRow label="Requested" value={stats.bookings.requested} highlight={stats.bookings.requested > 0} />
            <StatRow label="Confirmed" value={stats.bookings.confirmed} />
            <StatRow label="Completed" value={stats.bookings.completed} />
            <StatRow label="Cancelled" value={stats.bookings.cancelled} />
            <StatRow label="Total"     value={stats.bookings.total}     divider />
          </StatGroup>
        </section>

        {/* Revenue */}
        <section>
          <h2 className="mb-3 font-serif text-sm font-semibold text-charcoal-900">Revenue</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <RevenueCard
              icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
              label="Gross booking value"
              value={formatPrice(stats.revenue.grossBookings)}
            />
            <RevenueCard
              icon={<Wallet className="h-5 w-5 text-maroon-600" />}
              label="Platform commission"
              value={formatPrice(stats.revenue.commission)}
              highlight
            />
            <RevenueCard
              icon={<Wallet className="h-5 w-5 text-charcoal-600" />}
              label="Owner payouts"
              value={formatPrice(stats.revenue.ownerPayouts)}
            />
          </div>
        </section>

        {/* Quick links */}
        <section>
          <h2 className="mb-3 font-serif text-sm font-semibold text-charcoal-900">Manage</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <QuickLink href="/admin/hall-approvals" icon={<ClipboardCheck className="h-4 w-4" />} label="Hall Approvals" />
            <QuickLink href="/admin/bookings"      icon={<CalendarDays    className="h-4 w-4" />} label="All Bookings"  />
            <QuickLink href="/admin/commissions"   icon={<Wallet          className="h-4 w-4" />} label="Commissions"   />
            <QuickLink href="/admin/support-tickets" icon={<MessageSquare className="h-4 w-4" />} label="Support"      />
          </div>
        </section>
      </div>
    </div>
  );
}

function StatGroup({
  title, icon, href, children,
}: {
  title:    string;
  icon:     React.ReactNode;
  href:     string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white shadow-card overflow-hidden">
      <Link href={href} className="flex items-center gap-2 border-b border-border bg-ivory-50 px-4 py-3 hover:bg-ivory-100">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-maroon-50">{icon}</span>
        <h3 className="flex-1 font-serif text-sm font-semibold text-charcoal-900">{title}</h3>
        <span className="text-[10px] font-bold uppercase tracking-wide text-maroon-600">View →</span>
      </Link>
      <div className="px-4 py-3 space-y-1">{children}</div>
    </div>
  );
}

function StatRow({
  label, value, highlight = false, divider = false,
}: {
  label:      string;
  value:      number;
  highlight?: boolean;
  divider?:   boolean;
}) {
  return (
    <div className={[
      "flex items-center justify-between py-1 text-sm",
      divider ? "mt-1 border-t border-border pt-2 font-semibold" : "",
    ].join(" ")}>
      <span className="text-charcoal-600">{label}</span>
      <span className={[
        "font-bold tabular-nums",
        highlight ? "text-amber-600" : "text-charcoal-900",
      ].join(" ")}>
        {value}
      </span>
    </div>
  );
}

function RevenueCard({
  icon, label, value, highlight = false,
}: {
  icon:       React.ReactNode;
  label:      string;
  value:      string;
  highlight?: boolean;
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

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2.5 text-xs font-semibold text-charcoal-700 transition-colors hover:border-maroon-300 hover:bg-maroon-50"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-maroon-50 text-maroon-600">{icon}</span>
      {label}
    </Link>
  );
}
