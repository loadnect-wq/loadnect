// ─────────────────────────────────────────────────────────────────────────────
// /plan/<id> — one family's plan: the function at a glance, the budget, the
// board of categories, the checklist and who is in it. RLS makes a plan the
// caller is not in read as absent, so a guessed URL is a 404, never someone
// else's budget. Members who can only view get the same page without the
// controls; the database refuses their writes either way (0111).
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarDays, ClipboardList, MapPin, Pencil, UserPlus, Users } from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { ShareButtons } from "@/components/share/ShareButtons";
import { PlanBudget } from "@/components/plan/PlanBudget";
import { PlanBoard, type OptionSummary } from "@/components/plan/PlanBoard";
import { Checklist } from "@/components/plan/Checklist";
import { PlanFamily } from "@/components/plan/PlanFamily";
import { getSession, requireRole } from "@/lib/auth";
import { noindexMetadata } from "@/lib/seo/metadata";
import { todayInBusinessTz } from "@/lib/dates";
import { formatDiaryDay } from "@/lib/diary";
import { fetchHallsResult } from "@/lib/halls";
import { fetchVenueCategories } from "@/lib/venue-categories.server";
import { uuidSchema } from "@/lib/validation/schemas";
import { fetchPlan } from "@/lib/plan.server";
import { fetchInviteToken, fetchOptions, fetchPeople } from "@/lib/plan-family.server";
import {
  canEdit,
  countdownLabel,
  leadingOption,
  personName,
  planSummaryText,
  planTotals,
  type PlanRole,
} from "@/lib/plan";

export const metadata: Metadata = noindexMetadata("My plan");

type Props = { params: Promise<{ id: string }> };

export default async function PlanPage({ params }: Props) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  if (!(await getSession())) redirect(`/login?next=/plan/${id}`);
  const profile = await requireRole(["customer"]);

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
  const isOwner = plan.ownerId === profile.id;
  const today = todayInBusinessTz();
  const hallIds = items.map((i) => i.hallId).filter((h): h is string => Boolean(h));
  const [halls, catalogue, peopleRead, optionRead, inviteRead] = await Promise.all([
    hallIds.length ? fetchHallsResult({ ids: hallIds }) : Promise.resolve({ halls: [], failed: false }),
    fetchVenueCategories(),
    fetchPeople(plan.id),
    fetchOptions(plan.id),
    isOwner ? fetchInviteToken(plan.id) : Promise.resolve({ ok: true as const, token: null }),
  ]);

  const people = peopleRead.ok ? peopleRead.people : null;
  // A member's role comes from the member list. If that read failed, the page
  // shows them the view-only controls; the database decides what they can do
  // either way.
  const role: PlanRole = isOwner ? "owner" : (people?.find((p) => p.userId === profile.id)?.role ?? "viewer");
  const editable = canEdit(role);
  const ownerName = personName(people?.find((p) => p.role === "owner")?.name);

  // A failed hall read must not call the chosen hall delisted.
  const hallNames: Record<string, string> = halls.failed
    ? Object.fromEntries(hallIds.map((h) => [h, "Your chosen hall"]))
    : Object.fromEntries(halls.halls.map((h) => [h.id, h.name]));
  const occasion = catalogue.find((c) => c.slug === plan.occasion)?.name ?? "Function";
  const totals = planTotals(items, plan.budget);

  // How each category's family vote stands, for the board and the summary.
  const voteSummary: Partial<Record<string, OptionSummary>> = {};
  if (optionRead.ok) {
    for (const item of items) {
      const opts = optionRead.options.filter((o) => o.category === item.category);
      if (!opts.length) continue;
      const lead = leadingOption(opts, optionRead.votes.filter((v) => v.category === item.category));
      voteSummary[item.category] = { count: opts.length, leader: lead ? { name: lead.option.name, votes: lead.votes } : null };
    }
  }

  const summary = planSummaryText({
    title: plan.title,
    occasionName: occasion,
    eventDate: plan.eventDate,
    today,
    city: plan.city,
    guests: plan.guests,
    items: items.map((i) => ({
      category: i.category,
      status: i.status,
      chosen: i.hallId ? (hallNames[i.hallId] ?? null) : i.vendorName,
    })),
    totals,
    budget: plan.budget,
    tasksDone: tasks.filter((t) => t.doneAt).length,
    tasksTotal: tasks.length,
    leaders: items
      .filter((i) => i.status !== "booked" && i.status !== "not_needed" && voteSummary[i.category]?.leader)
      .map((i) => ({ category: i.category, name: voteSummary[i.category]!.leader!.name, votes: voteSummary[i.category]!.leader!.votes })),
  });

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title={isOwner ? "My plan" : "Family plan"} showBack />
      <div className="container-app max-w-2xl space-y-4 py-5">
        <section className="rounded-2xl bg-maroon-700 p-5 text-white shadow-maroon">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-gold-300">{occasion}</p>
              <h1 className="mt-0.5 font-serif text-2xl font-bold leading-snug">{plan.title}</h1>
              {!isOwner && <p className="mt-0.5 text-xs text-white/80">Shared by {ownerName}</p>}
            </div>
            {editable && (
              <Link
                href={`/plan/${plan.id}/edit`}
                aria-label="Edit the plan's details"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
              >
                <Pencil className="h-4 w-4" aria-hidden />
              </Link>
            )}
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
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gold-200">
              {totals.bookedCount} of {totals.activeCount} booked
            </p>
            {people && (
              <a href="#family" className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-semibold text-white/90 hover:text-white">
                {people.length > 1 ? (
                  <><Users className="h-3.5 w-3.5" aria-hidden /> Shared with {people.length - 1} {people.length === 2 ? "person" : "people"}</>
                ) : isOwner ? (
                  <><UserPlus className="h-3.5 w-3.5" aria-hidden /> Invite family</>
                ) : null}
              </a>
            )}
          </div>
        </section>

        <PlanBudget totals={totals} budget={plan.budget} />
        <PlanBoard planId={plan.id} items={items} hallNames={hallNames} today={today} canEdit={editable} options={voteSummary} />
        <Checklist planId={plan.id} tasks={tasks} eventDate={plan.eventDate} today={today} readOnly={!editable} />
        <PlanFamily
          planId={plan.id}
          planTitle={plan.title}
          me={profile.id}
          myRole={role}
          people={people}
          inviteToken={inviteRead.ok ? inviteRead.token : null}
        />

        <section aria-labelledby="summary-heading" className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
          <h2 id="summary-heading" className="text-base font-bold text-charcoal-900">Update the family</h2>
          <p className="mt-0.5 text-xs text-charcoal-600">
            A short summary for the family group: what is booked, what is left, the votes and the money. You see it in
            WhatsApp before it goes.
          </p>
          <div className="mt-3">
            <ShareButtons path={`/plan/${plan.id}`} text={summary} label="Send a summary" />
          </div>
        </section>
      </div>
    </div>
  );
}
