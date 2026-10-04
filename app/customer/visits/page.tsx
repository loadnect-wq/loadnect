// ─────────────────────────────────────────────────────────────────────────────
// /customer/visits — the halls a family asked to see, and what each said.
// Upcoming first; a failed read says so rather than showing an empty list.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, MapPin, MessageSquareQuote } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { todayInBusinessTz } from "@/lib/dates";
import { mapsUrl } from "@/lib/compare";
import { fetchVisitsForCustomer } from "@/lib/site-visits.server";
import {
  VISIT_STATE_LABEL,
  partyLabel,
  visitState,
  visitWhen,
  type VisitDisplayState,
} from "@/lib/site-visits";
import { CancelVisit } from "./_components/CancelVisit";

export const metadata: Metadata = { title: "My visits" };

const STATE_STYLE: Record<VisitDisplayState, string> = {
  requested: "bg-gold-50 text-gold-800 ring-gold-300/70",
  confirmed: "bg-green-50 text-green-800 ring-green-300/70",
  declined: "bg-red-50 text-red-800 ring-red-200",
  cancelled: "bg-ivory-200 text-charcoal-600 ring-border",
  past: "bg-ivory-200 text-charcoal-600 ring-border",
};

export default async function CustomerVisitsPage() {
  const profile = await requireRole(["customer"]);
  const visits = await fetchVisitsForCustomer(profile.id);
  const today = todayInBusinessTz();

  // Upcoming (soonest first), then everything else (latest first).
  const sorted = visits
    ? [
        ...visits.filter((v) => v.visitDate >= today).sort((a, b) => a.visitDate.localeCompare(b.visitDate)),
        ...visits.filter((v) => v.visitDate < today),
      ]
    : null;

  return (
    <>
      <AppHeader title="My visits" showBack />
      <div className="px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="mb-1 hidden font-serif text-xl font-bold text-charcoal-900 lg:block">My visits</h1>
        <p className="mb-4 text-sm text-charcoal-700">Halls you asked to see, and what each one said.</p>

        {sorted === null ? (
          <EmptyState
            icon={<CalendarCheck className="h-8 w-8" />}
            title="We couldn't load your visits"
            description="Something went wrong on our side. Please try again in a minute."
          />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck className="h-8 w-8" />}
            title="No visits yet"
            description="Open any hall and tap “Visit the hall” to ask to see it before you decide."
            action={<Link href="/halls" className={buttonVariants({ variant: "gold", size: "sm" })}>Browse halls</Link>}
          />
        ) : (
          <ul className="space-y-3">
            {sorted.map((v) => {
              const state = visitState(v.status, v.visitDate, today);
              const live = state === "requested" || state === "confirmed";
              return (
                <li key={v.id} className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {v.hall ? (
                        <Link href={`/halls/${v.hall.slug}`} className="font-semibold text-charcoal-900 hover:text-maroon-700">
                          {v.hall.name}
                        </Link>
                      ) : (
                        <p className="font-semibold text-charcoal-900">A hall no longer on Hallnect</p>
                      )}
                      <p className="mt-0.5 text-sm text-charcoal-700">{visitWhen(v.visitDate, v.visitWindow)}</p>
                      <p className="text-xs text-charcoal-600">{partyLabel(v.partySize)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${STATE_STYLE[state]}`}>
                      {VISIT_STATE_LABEL[state]}
                    </span>
                  </div>

                  {v.ownerMessage && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl bg-ivory-100 px-3 py-2 text-sm text-charcoal-800">
                      <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-maroon-700" aria-hidden />
                      <span>{v.ownerMessage}</span>
                    </p>
                  )}
                  {state === "requested" && (
                    <p className="mt-2 text-xs text-charcoal-600">The hall will confirm, usually by calling you.</p>
                  )}

                  {live && v.hall && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {state === "confirmed" && (
                        <a
                          href={mapsUrl({ ...v.hall })}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-maroon-700 hover:underline"
                        >
                          <MapPin className="h-4 w-4" aria-hidden /> Directions
                        </a>
                      )}
                      {live && <CancelVisit visitId={v.id} />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
