// ─────────────────────────────────────────────────────────────────────────────
// lib/muhurtham.server.ts — how booked each muhurtham day already is. SERVER-ONLY.
//
// ONLY "BOOKED", NEVER "FREE". A hall counts as booked on a date when a
// full-day claim for it is recorded on Hallnect — an online booking, or a date
// the venue blocked in its diary. The opposite is NOT "free": a venue that does
// not keep its diary here may well be taken. So the page states booked counts,
// which are facts, and tells families that each hall confirms their date. This
// is the growth plan's rule: never show a date as free until the calendar
// behind it is real.
//
// THREE STATES. A failed read returns null, and the page then shows the dates
// without counts. Returning zeros would print "none booked yet" against every
// date because a query failed — the fail-open defect this codebase keeps having
// to remove.
//
// Read through the cookie-free anon client so the page can be cached: RLS shows
// anonymous visitors approved halls and their public availability rows
// (availability.is_public, 0062) — exactly the set this counts.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabasePublicClient } from "@/lib/supabase/public";
import { FULL_BLOCK_STATUSES } from "@/lib/availability-status";

export type MuhurthamBookings = {
  /** Approved halls on Hallnect — the denominator. */
  listedHalls: number;
  /** date → number of distinct listed halls with a full-day claim that day. */
  bookedByDate: Map<string, number>;
};

export async function fetchMuhurthamBookings(dates: readonly string[]): Promise<MuhurthamBookings | null> {
  if (dates.length === 0) return { listedHalls: 0, bookedByDate: new Map() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabasePublicClient() as any;

  const [halls, blocks] = await Promise.all([
    db.from("halls").select("id", { count: "exact", head: true }).eq("status", "approved"),
    db.from("availability")
      .select("hall_id, date")
      .in("date", dates as string[])
      .in("status", FULL_BLOCK_STATUSES),
  ]);

  if (halls.error || blocks.error) {
    console.error("[muhurtham] bookings read failed:", halls.error?.code ?? blocks.error?.code, halls.error?.message ?? blocks.error?.message);
    return null;
  }

  const perDate = new Map<string, Set<string>>();
  for (const row of (blocks.data ?? []) as { hall_id: string; date: string }[]) {
    perDate.set(row.date, (perDate.get(row.date) ?? new Set()).add(row.hall_id));
  }
  return {
    listedHalls: halls.count ?? 0,
    bookedByDate: new Map([...perDate].map(([d, ids]) => [d, ids.size])),
  };
}
