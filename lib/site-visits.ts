// ─────────────────────────────────────────────────────────────────────────────
// lib/site-visits.ts — "book a site visit". Shared rules and wording, safe for
// the client. The server half is lib/site-visits.server.ts; the table is
// supabase/migrations/0109_site_visits.sql.
//
// A family asks to see a hall on a day and a time of day. The owner confirms
// or declines, optionally with a message that fixes the exact time. Nothing
// is held: a confirmed visit promises the hall will be open for them, not a
// date for their function.
// ─────────────────────────────────────────────────────────────────────────────

import { formatDiaryDay } from "@/lib/diary";

export type VisitWindow = "morning" | "afternoon" | "evening";
export type VisitStatus = "requested" | "confirmed" | "declined" | "cancelled";

/** Times of day, not clock times: owners keep their own hours. */
export const VISIT_WINDOWS: Record<VisitWindow, { label: string; hours: string }> = {
  morning:   { label: "Morning",   hours: "10 am – 12 noon" },
  afternoon: { label: "Afternoon", hours: "12 noon – 4 pm" },
  evening:   { label: "Evening",   hours: "4 pm – 7 pm" },
};
export const VISIT_WINDOW_KEYS = Object.keys(VISIT_WINDOWS) as VisitWindow[];

/** A visit is for a family deciding now, not a year out. */
export const VISIT_HORIZON_DAYS = 60;

/** Upcoming requests one family may have open across all halls at once. */
export const MAX_OPEN_VISITS = 5;

export const MAX_PARTY = 20;

/** "Sat, 10 Oct · Morning (10 am – 12 noon)" */
export function visitWhen(date: string, window: VisitWindow): string {
  const w = VISIT_WINDOWS[window];
  return `${formatDiaryDay("en", date)} · ${w.label} (${w.hours})`;
}

export type VisitDisplayState = "requested" | "confirmed" | "declined" | "cancelled" | "past";

/**
 * What a visit is, as of today. A request or a confirmation whose day has gone
 * is simply "past" — nothing sweeps it, and nothing needs to.
 */
export function visitState(status: VisitStatus, date: string, today: string): VisitDisplayState {
  if ((status === "requested" || status === "confirmed") && date < today) return "past";
  return status;
}

export const VISIT_STATE_LABEL: Record<VisitDisplayState, string> = {
  requested: "Waiting for the hall",
  confirmed: "Confirmed",
  declined: "Declined",
  cancelled: "Cancelled",
  past: "Past",
};

/** "2 people" */
export function partyLabel(n: number): string {
  return n === 1 ? "1 person" : `${n} people`;
}
