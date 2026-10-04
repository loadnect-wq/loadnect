// ─────────────────────────────────────────────────────────────────────────────
// /plan/<id> — one family's plan: the function at a glance, the budget, the
// board of categories and the checklist. RLS makes another family's plan id
// read as absent, so a guessed URL is a 404, never someone else's budget.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarDays, ClipboardList, MapPin, Pencil, Users } from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { PlanBudget } from "@/components/plan/PlanBudget";
import { PlanBoard } from "@/components/plan/PlanBoard";
import { Checklist } from "@/components/plan/Checklist";
import { getSession, requireRole } from "@/lib/auth";
import { noindexMetadata } from "@/lib/seo/metadata";
import { todayInBusinessTz } from "@/lib/dates";
import { formatDiaryDay } from "@/lib/diary";
import { fetchHallsResult } from "@/lib/halls";
import { fetchVenueCategories } from "@/lib/venue-categories.server";
import { uuidSchema } from "@/lib/validation/schemas";
import { fetchPlan } from "@/lib/plan.server";
import { countdownLabel, planTotals } from "@/lib/plan";

export const metadata: Metadata = noindexMetadata("My plan");

type Props = { params: Promise<{ id: string }> };

export default async function PlanPage({ params }: Props) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  if (!(await getSession())) redirect(`/login?next=/plan/${id}`);
  await requireRole(["customer"]);

  const loaded = await fetchPlan(id);
  if (!loaded.ok && loaded.reason === "not_found") notFound();
  if (!loaded.ok) {
    return (
      <div className="min-h-screen bg-ivory-100">
        <AppHeader title="My plan" showBack />
        <div className="container-app max-w-2xl py-6">
          <EmptyState
            icon={<ClipboardList className="h-8 w-8" />}
            title="We couldn't load this plan"
            description="Something went wrong on our side. Your plan is safe; please try again in a minute."
          />
        </div>
      </div>
    );
  }

  const { plan, items, tasks } = loaded;
  const today = todayInBusinessTz();
  const hallIds = items.map((i) => i.hallId).filter((h): h is string => Boolean(h));
  const [halls, catalogue] = await Promise.all([
    hallIds.length ? fetchHallsResult({ ids: hallIds }) : Promise.resolve({ halls: [], failed: false }),
    fetchVenueCategories(),
  ]);
  // A failed hall read must not call the chosen hall delisted.
  const hallNames: Record<string, string> = halls.failed
    ? Object.fromEntries(hallIds.map((h) => [h, "Your chosen hall"]))
    : Object.fromEntries(halls.halls.map((h) => [h.id, h.name]));
  const occasion = catalogue.find((c) => c.slug === plan.occasion)?.name ?? "Function";
  const totals = planTotals(items, plan.budget);

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="My plan" showBack />
      <div className="container-app max-w-2xl space-y-4 py-5">
        <section className="rounded-2xl bg-maroon-700 p-5 text-white shadow-maroon">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-gold-300">{occasion}</p>
              <h1 className="mt-0.5 font-serif text-2xl font-bold leading-snug">{plan.title}</h1>
            </div>
            <Link
              href={`/plan/${plan.id}/edit`}
              aria-label="Edit the plan's details"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <ul className="mt-3 space-y-1 text-sm text-white/90">
            <li className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
              {plan.eventDate ? `${formatDiaryDay("en", plan.eventDate, { year: true })} · ${countdownLabel(plan.eventDate, today)}` : "Date not fixed yet"}
            </li>
            {plan.city && (
              <li className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0" aria-hidden />{plan.city}</li>
            )}
            {plan.guests && (
              <li className="flex items-center gap-2"><Users className="h-4 w-4 shrink-0" aria-hidden />{plan.guests.toLocaleString("en-IN")} guests</li>
            )}
          </ul>
          <p className="mt-3 text-sm font-semibold text-gold-200">
            {totals.bookedCount} of {totals.activeCount} booked
          </p>
        </section>

        <PlanBudget totals={totals} budget={plan.budget} />
        <PlanBoard planId={plan.id} items={items} hallNames={hallNames} today={today} />
        <Checklist planId={plan.id} tasks={tasks} eventDate={plan.eventDate} today={today} />
      </div>
    </div>
  );
}
