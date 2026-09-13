import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import Link from "next/link";
import {
  AlertCircle, Building2, CalendarDays, CheckCircle2,
  ClipboardCheck, MessageSquare, ScrollText, Users, Wallet,
} from "lucide-react";
import { fetchAdminStats, fetchAuditLog } from "@/lib/admin";
import { formatPrice } from "@/lib/mock-data";
import { AdminPageHeader } from "../_components/AdminPageHeader";

export const metadata: Metadata = { title: "Admin Dashboard" };

export default async function AdminDashboardPage() {
  // ASSERTS ITS OWN ROLE. The layout also calls requireRole, but a layout and
  // its page render CONCURRENTLY in the App Router — the layout's redirect does
  // not stop this component's queries from being issued first. An anonymous
  // request therefore ran every read below as `anon`, was denied by the grants,
  // and only then got its 307. Nothing leaked, but the work was wasted and each
  // denial now logs at error level, which would bury real failures. Guarding
  // here also means this page is not relying on a file it does not control.
  await requireRole(["admin"]);
  // Independent reads — run them together rather than serially.
  const [stats, recentActivity] = await Promise.all([
    fetchAdminStats(),
    fetchAuditLog({ page: 1 }),
  ]);

  // A figure whose source query did not run is not zero, it is unknown. Printing
  // "Rs 0" for it is the precise mistake this audit was chasing, so each money
  // card asks whether its own source loaded and prints an em dash if it did not.
  const money = (value: number, ...sources: string[]) =>
    sources.some((src) => stats.failed.includes(src)) ? "—" : formatPrice(value);

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
    // MONEY FIRST IN THE EYE, LAST IN THE LIST — these three are the only
    // queues where waiting costs somebody real money, and none of them was
    // surfaced anywhere. While SMS alerts cannot send, this dashboard is the only
    // place they can appear at all.
    {
      count: stats.open.refundsOwed,
      label: "Refunds owed to customers",
      href:  "/admin/payments",
      color: "border-red-200 bg-red-50 text-red-900",
    },
    {
      count: stats.open.stuckPayouts,
      label: "Payouts owed to venues",
      href:  "/admin/payments",
      color: "border-red-200 bg-red-50 text-red-900",
    },
    {
      count: stats.open.failedNotifications,
      // "and can be retried", not "failed": this counts failed messages that are
      // NOT permanent_failure, so it is deliberately smaller than the Failed tile
      // on the notifications page. Two different numbers both labelled "failed"
      // is how an operator concludes one of the screens is broken.
      label: "Messages to retry",
      // ?status= was read by nothing — the page's param is `filter`, so this
      // card landed on the unfiltered list and the operator had to find the
      // failures by hand, having just been told exactly how many there were.
      href:  "/admin/notifications?filter=failed",
      color: "border-orange-200 bg-orange-50 text-orange-900",
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Platform Overview"
        description="Snapshot of users, listings, bookings, and revenue across Hallnect."
      />

      <div className="px-4 py-5 sm:px-6 lg:px-8 space-y-6">

        {/* EVERY NUMBER ON THIS PAGE IS A ZERO BY DEFAULT, so a read that failed
            renders exactly like a quiet week. Until fetchAdminStats reported
            which reads ran, this page could show "Platform fees Rs 0" and
            "Refunds owed 0" over a customer waiting on money, with nothing
            anywhere to say the query never executed. Naming the failed sections
            is the whole fix: an operator who sees this knows not to trust the
            figures below, which is the one thing a silent zero denied them. */}
        {stats.failed.length > 0 && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-red-900"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <p className="font-serif text-sm font-semibold">
                Some figures below could not be read
              </p>
              <p className="mt-1 text-xs">
                Failed: <span className="font-semibold">{stats.failed.join(", ")}</span>. Anything
                derived from {stats.failed.length === 1 ? "it" : "them"} is showing{" "}
                <span className="font-mono">0</span> because the query did not run &mdash; not
                because there is nothing to report. Do not reconcile from this page until it
                loads cleanly.
              </p>
            </div>
          </div>
        )}

        {/* Action queue */}
        <section data-reveal>
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
        <section data-reveal className="grid gap-4 lg:grid-cols-3">
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
        <section data-reveal>
          <h2 className="mb-3 font-serif text-sm font-semibold text-charcoal-900">Revenue</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <RevenueCard
              icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
              label="Gross booking value"
              value={money(stats.revenue.grossBookings, "bookings")}
            />
            <RevenueCard
              icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
              label="Gross advances"
              value={money(stats.revenue.grossAdvances, "commissions")}
            />
            <RevenueCard
              icon={<Wallet className="h-5 w-5 text-maroon-600" />}
              // Not labelled with a rate: the sum spans bookings that carry
              // their own snapshotted rate. "retained" is the important word —
              // this is commission taken out of customers' advances, which is
              // the only kind Hallnect holds without invoicing anyone.
              label="Commission retained"
              value={money(stats.revenue.commission, "commissions")}
              highlight
            />
            <RevenueCard
              icon={<Wallet className="h-5 w-5 text-maroon-600" />}
              label="Commission billed & paid"
              value={money(stats.revenue.commissionBilledPaid, "commissions")}
              highlight
            />
            <RevenueCard
              icon={<Wallet className="h-5 w-5 text-gold-600" />}
              label="Platform fees"
              value={money(stats.revenue.platformFees, "payments")}
              highlight
            />
            <RevenueCard
              icon={<Wallet className="h-5 w-5 text-maroon-600" />}
              label="Net Hallnect revenue"
              value={money(stats.revenue.netRevenue, "commissions", "payments")}
              highlight
            />
            <RevenueCard
              icon={<Wallet className="h-5 w-5 text-charcoal-600" />}
              label="Owner payouts"
              value={money(stats.revenue.ownerPayouts, "commissions")}
            />
          </div>
          {/* OUTSTANDING, not earned. A lead commission is invoiced to the venue
              with a due date and nothing yet chases it, so it has to be visible
              as a debt somewhere an operator looks — and it must not sit inside
              "Net Hallnect revenue", which is money in hand. */}
          {stats.revenue.commissionBilledOutstanding > 0 && !stats.failed.includes("commissions") && (
            <p className="mt-2 text-xs font-semibold text-amber-800">
              Commission billed to venues and still unpaid:{" "}
              {formatPrice(stats.revenue.commissionBilledOutstanding)} — a receivable, not counted in
              net revenue.
            </p>
          )}
          {/* Hidden when the payments read failed: a missing note is honest,
              "Refunds issued: Rs 0" would not be. */}
          {stats.revenue.refunds > 0 && !stats.failed.includes("payments") && (
            <p className="mt-2 text-xs text-charcoal-500">
              Refunds issued: {formatPrice(stats.revenue.refunds)} (platform fees are retained
              except on venue/platform-caused cancellations, where one was charged).
            </p>
          )}
        </section>

        {/* Recent admin activity — real entries from the append-only audit log.
            Nothing here is synthesised; an empty log renders an empty state. */}
        <section data-reveal>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-sm font-semibold text-charcoal-900">Recent admin activity</h2>
            <Link href="/admin/audit-logs" className="text-xs font-semibold text-maroon-600 hover:underline">
              View full log
            </Link>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-white">
            {recentActivity.rows.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <ScrollText className="mx-auto h-6 w-6 text-charcoal-300" />
                <p className="mt-1.5 text-xs text-charcoal-500">
                  {recentActivity.unavailable
                    ? "Audit log not provisioned yet."
                    : "No admin actions recorded yet."}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {recentActivity.rows.slice(0, 6).map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2.5 text-xs">
                    <span className="font-mono font-semibold text-charcoal-800">{row.action}</span>
                    <span className="text-charcoal-500">by {row.actor_email ?? "unknown"}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-charcoal-400">
                      {new Date(row.created_at).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Quick links */}
        <section data-reveal>
          <h2 className="mb-3 font-serif text-sm font-semibold text-charcoal-900">Manage</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <QuickLink href="/admin/hall-approvals" icon={<ClipboardCheck className="h-4 w-4" />} label="Hall Approvals" />
            <QuickLink href="/admin/bookings"      icon={<CalendarDays    className="h-4 w-4" />} label="All Bookings"  />
            <QuickLink href="/admin/commissions"   icon={<Wallet          className="h-4 w-4" />} label="Commissions"   />
            <QuickLink href="/admin/support-tickets" icon={<MessageSquare className="h-4 w-4" />} label="Support"      />
            <QuickLink href="/admin/audit-logs"    icon={<ScrollText     className="h-4 w-4" />} label="Audit Log"    />
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
