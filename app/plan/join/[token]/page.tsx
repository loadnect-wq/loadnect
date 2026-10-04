// ─────────────────────────────────────────────────────────────────────────────
// /plan/join/<token> — where a plan's invite link lands (0111).
//
// Signed out, it says only that there is an invite: nothing about the plan is
// readable without an account, so a forwarded link shows a stranger nothing.
// Signed in, it shows whose plan it is and asks before joining, because
// joining shows the visitor's name to everyone in it. The token never goes to
// analytics (lib/analytics/redact-url.ts).
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarDays, Link2Off, Users } from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { JoinPlan } from "@/components/plan/JoinPlan";
import { getSession, requireRole } from "@/lib/auth";
import { noindexMetadata } from "@/lib/seo/metadata";
import { formatDiaryDay } from "@/lib/diary";
import { fetchVenueCategories } from "@/lib/venue-categories.server";
import { previewInvite } from "@/lib/plan-family.server";
import { INVITE_TOKEN_PATTERN, personName } from "@/lib/plan";

export const metadata: Metadata = noindexMetadata("Join a family plan");

type Props = { params: Promise<{ token: string }> };

const PRIVACY_NOTE = "The people in the plan will see your name. Your phone number and email stay private.";

export default async function JoinPlanPage({ params }: Props) {
  const { token } = await params;
  if (!INVITE_TOKEN_PATTERN.test(token)) notFound();

  if (!(await getSession())) {
    return (
      <div className="min-h-screen bg-ivory-100">
        <AppHeader title="Family plan" />
        <section className="container-app max-w-xl py-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">Family plan</p>
          <h1 className="mt-1 font-serif text-3xl font-bold leading-tight text-charcoal-900">You&apos;re invited to a family plan</h1>
          <p className="mt-2 text-base text-charcoal-700">
            Someone in your family is planning a function on Hallnect and wants you to see the plan and vote on the
            options. Sign in to open it.
          </p>
          <Link
            href={`/login?next=/plan/join/${token}`}
            className="mt-6 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-maroon-700 px-6 text-sm font-semibold text-white hover:bg-maroon-800"
          >
            Sign in to join
          </Link>
          <p className="mt-2 text-xs text-charcoal-600">Free. {PRIVACY_NOTE}</p>
        </section>
      </div>
    );
  }

  await requireRole(["customer"]);
  const [preview, catalogue] = await Promise.all([previewInvite(token), fetchVenueCategories()]);

  if (!preview.ok || !preview.invite) {
    return (
      <div className="min-h-screen bg-ivory-100">
        <AppHeader title="Family plan" />
        <div className="container-app max-w-xl py-6">
          {!preview.ok ? (
            <EmptyState title="We couldn't open this invite" description="Something went wrong on our side. Please try again in a minute." />
          ) : (
            <EmptyState
              icon={<Link2Off className="h-8 w-8" />}
              title="This invite link is turned off"
              description="Ask the person who sent it for a new link."
              action={
                <Link href="/plan" className="inline-flex min-h-[44px] items-center rounded-xl bg-maroon-700 px-5 text-sm font-semibold text-white hover:bg-maroon-800">
                  My plans
                </Link>
              }
            />
          )}
        </div>
      </div>
    );
  }

  const invite = preview.invite;
  // Already in it (or it is their own): no second confirmation.
  if (invite.myRole) redirect(`/plan/${invite.planId}`);

  const occasion = catalogue.find((c) => c.slug === invite.occasion)?.name ?? "Function";
  const owner = invite.ownerName ? personName(invite.ownerName) : null;

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Family plan" />
      <section className="container-app max-w-xl py-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">Family plan</p>
        <h1 className="mt-1 font-serif text-3xl font-bold leading-tight text-charcoal-900">
          {owner ? `${owner} invited you to their plan` : "You're invited to a family plan"}
        </h1>

        <div className="mt-5 rounded-2xl bg-maroon-700 p-5 text-white shadow-maroon">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold-300">{occasion}</p>
          <p className="mt-0.5 font-serif text-2xl font-bold leading-snug">{invite.title}</p>
          <ul className="mt-3 space-y-1 text-sm text-white/90">
            <li className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
              {invite.eventDate ? formatDiaryDay("en", invite.eventDate, { year: true }) : "Date not fixed yet"}
            </li>
            <li className="flex items-center gap-2">
              <Users className="h-4 w-4 shrink-0" aria-hidden />
              {invite.people === 1 ? "1 person in it so far" : `${invite.people} people in it so far`}
            </li>
          </ul>
        </div>

        <p className="mt-5 text-sm text-charcoal-700">
          You&apos;ll see the whole plan, with the board, the budget and the checklist, and you can vote on the options.
          {owner ? ` ${owner} can let you edit it too.` : " The person who started it can let you edit it too."}
        </p>
        <p className="mt-1 text-xs text-charcoal-600">{PRIVACY_NOTE}</p>
        <div className="mt-5">
          <JoinPlan token={token} />
        </div>
      </section>
    </div>
  );
}
