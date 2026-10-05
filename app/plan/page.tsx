// ─────────────────────────────────────────────────────────────────────────────
// /plan — the family's event plans. Signed out, it explains the planner and
// starts one through sign-in; signed in as a customer, it lists their plans.
// A private surface: noindex, and nothing on it is cached between visitors.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { CalendarHeart, ClipboardList, IndianRupee, ListChecks, Plus, Users, Vote } from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { getSession, requireRole } from "@/lib/auth";
import { noindexMetadata } from "@/lib/seo/metadata";
import { todayInBusinessTz } from "@/lib/dates";
import { formatDiaryDay } from "@/lib/diary";
import { fetchVenueCategories } from "@/lib/venue-categories.server";
import { fetchMyPlans, type PlanListEntry } from "@/lib/plan.server";
import { MAX_PLANS, countdownLabel } from "@/lib/plan";

export const metadata: Metadata = noindexMetadata("Function planner");

const PITCH = [
  { Icon: ClipboardList, title: "Everything on one board", text: "Hall, catering, decoration, photos, music, invitations and the rest, each from to do to booked." },
  { Icon: IndianRupee, title: "One budget", text: "What you planned, what each vendor quoted and what you have paid, with the balance still due." },
  { Icon: ListChecks, title: "A checklist that knows your date", text: "What to book and when, worked out from the day of the function." },
  { Icon: Users, title: "Vendors you already have", text: "Add the caterer or photographer you found yourself, so nothing lives in a notebook." },
  { Icon: Vote, title: "Decide together", text: "Send the family a link to the plan, and let everyone vote on the halls and vendors you are choosing between." },
];

export default async function PlansPage() {
  const user = await getSession();

  if (!user) {
    return (
      <div className="min-h-screen bg-ivory-100">
        <AppHeader title="Function planner" />
        <section className="container-app max-w-2xl py-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">Free planner</p>
          <h1 className="mt-1 font-serif text-3xl font-bold leading-tight text-charcoal-900">Plan the whole function in one place</h1>
          <p className="mt-2 text-base text-charcoal-700">
            From the hall to the return gifts: what is booked, what it costs, and what to do next.
          </p>
          <ul className="mt-6 space-y-4">
            {PITCH.map(({ Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-maroon-50">
                  <Icon className="h-5 w-5 text-maroon-700" aria-hidden />
                </span>
                <span>
                  <span className="block font-semibold text-charcoal-900">{title}</span>
                  <span className="block text-sm text-charcoal-700">{text}</span>
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/login?next=/plan/new"
            className="mt-7 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-maroon-700 px-6 text-sm font-semibold text-white hover:bg-maroon-800"
          >
            Start your plan
          </Link>
          <p className="mt-2 text-xs text-charcoal-600">Free. Sign in so the plan is saved, and only you and the family you invite can see it.</p>
        </section>
      </div>
    );
  }

  await requireRole(["customer"]);
  const [result, catalogue] = await Promise.all([fetchMyPlans(), fetchVenueCategories()]);
  const occasionName = (slug: string) => catalogue.find((c) => c.slug === slug)?.name ?? "Function";
  const today = todayInBusinessTz();
  // RLS returns the plans this account started and the ones shared with it.
  const mine = result.ok ? result.plans.filter((p) => p.ownerId === user.id) : [];
  const shared = result.ok ? result.plans.filter((p) => p.ownerId !== user.id) : [];

  const card = (p: PlanListEntry, isShared: boolean) => (
    <li key={p.id}>
      <Link href={`/plan/${p.id}`} className="block rounded-2xl bg-white p-4 shadow-card ring-1 ring-border hover:ring-maroon-200">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-charcoal-900">{p.title}</p>
          {isShared && (
            <span className="shrink-0 rounded-full bg-gold-50 px-2 py-0.5 text-[11px] font-semibold text-gold-800">Shared with you</span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-charcoal-700">
          {occasionName(p.occasion)}
          {p.eventDate ? ` · ${formatDiaryDay("en", p.eventDate, { year: true })}` : ""} · {countdownLabel(p.eventDate, today)}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-ivory-200" aria-hidden>
            <div
              className="h-full rounded-full bg-maroon-600"
              style={{ width: `${p.activeCount ? Math.round((p.bookedCount / p.activeCount) * 100) : 0}%` }}
            />
          </div>
          <span className="shrink-0 text-xs font-semibold text-charcoal-700">
            {p.bookedCount} of {p.activeCount} booked
          </span>
        </div>
      </Link>
    </li>
  );

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="My plans" />
      <section className="container-app max-w-2xl py-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-serif text-2xl font-bold text-charcoal-900">My plans</h1>
          {result.ok && result.plans.length > 0 && mine.length < MAX_PLANS && (
            <Link href="/plan/new" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800">
              <Plus className="h-4 w-4" aria-hidden /> New plan
            </Link>
          )}
        </div>

        <div className="mt-4">
          {!result.ok ? (
            <EmptyState
              icon={<ClipboardList className="h-8 w-8" />}
              title="We couldn't load your plans"
              description="Something went wrong on our side. Please try again in a minute."
            />
          ) : result.plans.length === 0 ? (
            <EmptyState
              icon={<CalendarHeart className="h-8 w-8" />}
              title="Plan your first function"
              description="One board for the hall, food, decoration, photos and everything else, with your budget and a checklist."
              action={
                <Link href="/plan/new" className="inline-flex min-h-[44px] items-center rounded-xl bg-maroon-700 px-5 text-sm font-semibold text-white hover:bg-maroon-800">
                  Start a plan
                </Link>
              }
            />
          ) : (
            <>
              {mine.length > 0 && <ul className="space-y-3">{mine.map((p) => card(p, false))}</ul>}
              {shared.length > 0 && (
                <>
                  <h2 className={`${mine.length ? "mt-6" : ""} text-base font-bold text-charcoal-900`}>Shared with you</h2>
                  <ul className="mt-2 space-y-3">{shared.map((p) => card(p, true))}</ul>
                </>
              )}
              {mine.length === 0 && (
                <Link href="/plan/new" className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-maroon-700 hover:underline">
                  <Plus className="h-4 w-4" aria-hidden /> Start a plan of your own
                </Link>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
