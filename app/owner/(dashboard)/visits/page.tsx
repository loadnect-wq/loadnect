// ─────────────────────────────────────────────────────────────────────────────
// /owner/visits — families asking to see the owner's halls.
//
// "To answer" first: each request shows who, when, how many and their note,
// with Call and WhatsApp straight to the family's VERIFIED number (0109), and
// Confirm / Decline with an optional message the family sees. Then visits
// coming up, then the last month's closed ones. A failed read says so.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, MessageCircle, Phone, StickyNote, Users } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { todayInBusinessTz } from "@/lib/dates";
import { whatsappUrl } from "@/lib/diary";
import { fetchVisitsForOwner, type SiteVisitWithHall } from "@/lib/site-visits.server";
import { VISIT_STATE_LABEL, partyLabel, visitState, visitWhen } from "@/lib/site-visits";
import { VisitAnswer } from "./_components/VisitAnswer";

export const metadata: Metadata = { title: "Site visits" };

const TABS = [
  { key: "open", label: "To answer" },
  { key: "upcoming", label: "Coming up" },
  { key: "closed", label: "Past and closed" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function tabOf(v: SiteVisitWithHall, today: string): TabKey {
  const state = visitState(v.status, v.visitDate, today);
  if (state === "requested") return "open";
  if (state === "confirmed") return "upcoming";
  return "closed";
}

type Props = { searchParams: Promise<{ tab?: string }> };

export default async function OwnerVisitsPage({ searchParams }: Props) {
  const profile = await requireRole(["owner_approved"]);
  const { tab: rawTab } = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : "open";
  const today = todayInBusinessTz();
  const visits = await fetchVisitsForOwner(profile.id);
  const counts = Object.fromEntries(TABS.map((t) => [t.key, (visits ?? []).filter((v) => tabOf(v, today) === t.key).length]));
  const shown = (visits ?? []).filter((v) => tabOf(v, today) === tab);
  // Closed visits read newest first; the others soonest first.
  if (tab === "closed") shown.reverse();

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Site visits" notificationsHref="/owner/notifications" />
      <div className="px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="mb-1 hidden font-serif text-xl font-bold text-charcoal-900 lg:block">Site visits</h1>
        <p className="mb-4 text-sm text-charcoal-700">Families who want to see your hall before they decide.</p>

        <div className="mb-4 flex rounded-2xl bg-ivory-200 p-1 text-xs font-semibold">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/owner/visits?tab=${t.key}`}
              className={`flex-1 rounded-xl px-2 py-2 text-center ${tab === t.key ? "bg-white text-charcoal-900 shadow-card" : "text-charcoal-600"}`}
            >
              {t.label}{counts[t.key] ? ` (${counts[t.key]})` : ""}
            </Link>
          ))}
        </div>

        {visits === null ? (
          <EmptyState
            icon={<CalendarCheck className="h-8 w-8" />}
            title="We couldn't load your site visits"
            description="Something went wrong on our side. Please try again in a minute."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck className="h-8 w-8" />}
            title={tab === "open" ? "No requests waiting" : tab === "upcoming" ? "No visits coming up" : "Nothing here yet"}
            description="When a family asks to see your hall, it appears here and on your dashboard."
          />
        ) : (
          <ul className="space-y-3">
            {shown.map((v) => {
              const state = visitState(v.status, v.visitDate, today);
              const greeting = `Hello ${v.contactName}, this is ${v.hall?.name ?? "the hall"} about your visit on ${visitWhen(v.visitDate, v.visitWindow)}. `;
              return (
                <li key={v.id} className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-charcoal-900">{v.contactName}</p>
                      <p className="mt-0.5 text-sm text-charcoal-800">{visitWhen(v.visitDate, v.visitWindow)}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-charcoal-600">
                        <Users className="h-3.5 w-3.5" aria-hidden /> {partyLabel(v.partySize)}
                        {v.hall && <> · {v.hall.name}</>}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-ivory-200 px-2.5 py-0.5 text-xs font-semibold text-charcoal-700">
                      {state === "requested" ? "New" : VISIT_STATE_LABEL[state]}
                    </span>
                  </div>

                  {v.note && (
                    <p className="mt-2 flex items-start gap-2 rounded-xl bg-ivory-100 px-3 py-2 text-sm text-charcoal-800">
                      <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-maroon-700" aria-hidden />
                      <span>{v.note}</span>
                    </p>
                  )}
                  {v.ownerMessage && state !== "requested" && (
                    <p className="mt-2 text-xs text-charcoal-600">You said: “{v.ownerMessage}”</p>
                  )}

                  {(state === "requested" || state === "confirmed") && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <a
                        href={`tel:${v.contactPhone}`}
                        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-border text-sm font-semibold text-charcoal-800 hover:bg-ivory-100"
                      >
                        <Phone className="h-4 w-4" aria-hidden /> Call
                      </a>
                      <a
                        href={whatsappUrl(v.contactPhone, greeting)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#1a7f45] text-sm font-semibold text-[#17703c] hover:bg-green-50"
                      >
                        <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
                      </a>
                    </div>
                  )}

                  {state === "requested" && <VisitAnswer visitId={v.id} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
