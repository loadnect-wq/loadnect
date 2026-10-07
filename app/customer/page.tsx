import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, CalendarDays, ClipboardList, Heart, Inbox, MessageSquareQuote, Search, Star } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchCustomerStats } from "@/lib/customer";
import { countLeadsForCustomer } from "@/lib/leads";
import { DIRECT_BOOKING_ENABLED } from "@/lib/booking-switch";
import { SavedCountTile } from "./_components/SavedCountTile";
import { AppHeader } from "@/components/app/AppHeader";
import { CountUp } from "@/components/motion/CountUp";
import { revealDelay } from "@/lib/motion";
import { buttonVariants } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Dashboard" };

export default async function CustomerDashboard() {
  const profile = await requireRole(["customer"]);
  // WHAT A FAMILY IS WAITING ON. With direct booking switched off nobody can
  // have an online booking, so "Upcoming / Pending / Completed" were three
  // permanent zeros while a quote waiting on the family appeared nowhere on
  // this page. The tiles follow the switch: enquiries now, bookings when it
  // comes back.
  const [stats, leads] = await Promise.all([
    DIRECT_BOOKING_ENABLED ? fetchCustomerStats() : null,
    DIRECT_BOOKING_ENABLED ? null : countLeadsForCustomer(profile.id),
  ]);
  const firstName = profile.full_name?.split(" ")[0];

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Dashboard" />

      <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        {/* Welcome. A keyframe, not a scroll reveal: it is the top of the page,
            so it must not wait for the observer to hydrate before it paints. */}
        <div data-reveal-now="" className="mb-6">
          <h1 className="font-serif text-2xl font-bold text-charcoal-900">
            {firstName ? `Welcome, ${firstName}` : "My Dashboard"}
          </h1>
          <p className="mt-1 text-sm text-charcoal-500">
            {DIRECT_BOOKING_ENABLED
              ? "Manage your bookings, saved halls, and profile."
              : "Your quotes, saved halls and plans in one place."}
          </p>
        </div>

        {/* Stats */}
        {stats ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 mb-6">
            <StatCard revealIndex={0} label="Upcoming" value={stats.upcomingCount} icon={<CalendarDays className="h-4 w-4" />} href="/customer/bookings?tab=upcoming" />
            <StatCard revealIndex={1} label="Pending" value={stats.pendingCount} icon={<CalendarCheck className="h-4 w-4" />} href="/customer/bookings?tab=all" />
            <StatCard revealIndex={2} label="Completed" value={stats.completedCount} icon={<Star className="h-4 w-4" />} href="/customer/bookings?tab=past" />
            <SavedCountTile revealIndex={3} />
          </div>
        ) : (
          <>
            {/* A quote waiting on the family is the one thing on this page with
                a deadline, so it is a banner, not just a number in a tile. */}
            {leads && leads.toAnswer > 0 && (
              <Link
                href="/customer/enquiries"
                className="mb-4 flex items-start gap-3 rounded-2xl border-2 border-gold-300 bg-gold-50 p-4 shadow-card"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-600">
                  <MessageSquareQuote className="h-5 w-5 text-white" aria-hidden />
                </span>
                <span>
                  <span className="block font-serif text-base font-bold text-gold-900">
                    {leads.toAnswer === 1 ? "A hall has sent you a quote" : `${leads.toAnswer} halls have sent you quotes`}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-gold-900/80">
                    Accept the one you want and that hall gets your number to agree the booking. Quotes run out, so answer soon.
                  </span>
                </span>
              </Link>
            )}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 mb-6">
              <StatCard revealIndex={0} label="Quotes to answer" value={leads?.toAnswer ?? null} icon={<MessageSquareQuote className="h-4 w-4" />} href="/customer/enquiries" />
              <StatCard revealIndex={1} label="Waiting for a quote" value={leads?.waiting ?? null} icon={<Inbox className="h-4 w-4" />} href="/customer/enquiries" />
              <StatCard revealIndex={2} label="Accepted" value={leads?.agreed ?? null} icon={<CalendarCheck className="h-4 w-4" />} href="/customer/enquiries" />
              <SavedCountTile revealIndex={3} />
            </div>
          </>
        )}

        {/* Quick actions */}
        <h2 data-reveal="up" className="mb-3 font-serif text-base font-semibold text-charcoal-800">
          Quick Actions
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* The event planner (0110): the whole function on one board. */}
          <ActionCard
            revealIndex={0}
            icon={<ClipboardList className="h-6 w-6 text-maroon-600" />}
            title="Plan your function"
            description="Hall, food, decoration, photos and the budget, on one board."
            href="/plan"
            cta="Open my plans"
          />
          <ActionCard
            revealIndex={1}
            icon={<Search className="h-6 w-6 text-maroon-600" />}
            title="Browse Halls"
            description="Explore venues for your next event."
            href="/halls"
            cta="Find Venues"
          />
          {DIRECT_BOOKING_ENABLED ? (
            <ActionCard
              revealIndex={2}
              icon={<CalendarDays className="h-6 w-6 text-maroon-600" />}
              title="My Bookings"
              description="View upcoming and past bookings."
              href="/customer/bookings"
              cta="View Bookings"
            />
          ) : (
            <ActionCard
              revealIndex={2}
              icon={<Inbox className="h-6 w-6 text-maroon-600" />}
              title="My Enquiries"
              description="Your requests to halls, and the quotes they send back."
              href="/customer/enquiries"
              cta="View enquiries"
            />
          )}
          {/* /saved, not /customer/saved-halls: the heart saves to this
              browser's list, and that table was never written to. */}
          <ActionCard
            revealIndex={3}
            icon={<Heart className="h-6 w-6 text-maroon-600" />}
            title="Saved Halls"
            description="Your shortlist: compare halls and send them to the family."
            href="/saved"
            cta="Open my shortlist"
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon, href, revealIndex,
}: {
  label: string; value: number | null; icon: React.ReactNode; href: string; revealIndex?: number;
}) {
  return (
    <Link
      href={href}
      // A keyframe rather than a scroll reveal — this row is above the fold on
      // every screen size, so its paint cannot be gated on hydration.
      {...(revealIndex === undefined
        ? {}
        : { "data-reveal-now": "", style: revealDelay(revealIndex, 70) })}
      className="block rounded-2xl bg-white p-3.5 shadow-card transition-transform active:scale-[0.99]"
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
          {label}
        </p>
        <span className="text-charcoal-500">{icon}</span>
      </div>
      <p className="mt-2 font-serif text-2xl font-bold text-charcoal-900">
        {value === null ? "—" : <CountUp value={value} />}
      </p>
    </Link>
  );
}

function ActionCard({
  icon, title, description, href, cta, revealIndex,
}: {
  icon: React.ReactNode; title: string; description: string; href: string; cta: string;
  revealIndex?: number;
}) {
  return (
    <div
      {...(revealIndex === undefined
        ? {}
        : { "data-reveal": "card", style: revealDelay(revealIndex, 110) })}
      className="space-y-3 rounded-2xl bg-white p-5 shadow-card"
    >
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
