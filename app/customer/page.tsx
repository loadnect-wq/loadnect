import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, CalendarDays, Heart, Search, Star } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchCustomerStats } from "@/lib/customer";
import { AppHeader } from "@/components/app/AppHeader";
import { buttonVariants } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Dashboard" };

export default async function CustomerDashboard() {
  const profile = await requireRole(["customer"]);
  const stats = await fetchCustomerStats();
  const firstName = profile.full_name?.split(" ")[0];

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Dashboard" />

      <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        {/* Welcome */}
        <div className="mb-6">
          <h1 className="font-serif text-2xl font-bold text-charcoal-900">
            {firstName ? `Welcome, ${firstName}` : "My Dashboard"}
          </h1>
          <p className="mt-1 text-sm text-charcoal-500">
            Manage your bookings, saved halls, and profile.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 mb-6">
          <StatCard
            label="Upcoming"
            value={stats.upcomingCount}
            icon={<CalendarDays className="h-4 w-4" />}
            href="/customer/bookings?tab=upcoming"
          />
          <StatCard
            label="Pending"
            value={stats.pendingCount}
            icon={<CalendarCheck className="h-4 w-4" />}
            href="/customer/bookings?tab=all"
          />
          <StatCard
            label="Completed"
            value={stats.completedCount}
            icon={<Star className="h-4 w-4" />}
            href="/customer/bookings?tab=past"
          />
          <StatCard
            label="Saved"
            value={stats.savedCount}
            icon={<Heart className="h-4 w-4" />}
            href="/customer/saved-halls"
          />
        </div>

        {/* Quick actions */}
        <h2 className="mb-3 font-serif text-base font-semibold text-charcoal-800">
          Quick Actions
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ActionCard
            icon={<Search className="h-6 w-6 text-maroon-600" />}
            title="Browse Halls"
            description="Explore venues for your next event."
            href="/halls"
            cta="Find Venues"
          />
          <ActionCard
            icon={<CalendarDays className="h-6 w-6 text-maroon-600" />}
            title="My Bookings"
            description="View upcoming and past bookings."
            href="/customer/bookings"
            cta="View Bookings"
          />
          <ActionCard
            icon={<Heart className="h-6 w-6 text-maroon-600" />}
            title="Saved Halls"
            description="Halls you've saved for later."
            href="/customer/saved-halls"
            cta={stats.savedCount > 0 ? `View Saved (${stats.savedCount})` : "Browse & Save"}
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon, href,
}: {
  label: string; value: number; icon: React.ReactNode; href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl bg-white p-3.5 shadow-card active:scale-[0.99] transition-transform"
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
          {label}
        </p>
        <span className="text-charcoal-400">{icon}</span>
      </div>
      <p className="mt-2 font-serif text-2xl font-bold text-charcoal-900">{value}</p>
    </Link>
  );
}

function ActionCard({
  icon, title, description, href, cta,
}: {
  icon: React.ReactNode; title: string; description: string; href: string; cta: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-card space-y-3">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-maroon-50">
        {icon}
      </div>
      <div>
        <h3 className="font-serif text-base font-semibold text-charcoal-900">{title}</h3>
        <p className="mt-0.5 text-xs text-charcoal-500">{description}</p>
      </div>
      <Link href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
        {cta}
      </Link>
    </div>
  );
}
