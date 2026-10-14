// ─────────────────────────────────────────────────────────────────────────────
// lib/owner-insights.server.ts — the reads behind the owner's Insights page.
// SERVER-ONLY. The arithmetic is lib/owner-insights.ts.
//
// The caller's SESSION client, so RLS decides: an owner reads only their own
// halls' rows (owns_hall on every table here; leads also need phone_verified,
// which is exactly the set the owner ever sees). Each section is read on its
// own, and a section that fails is null, so the page says "couldn't load"
// instead of showing a zero that reads as a bad month.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { monthRange, monthTimestamps, type InsightRows, type MonthKey } from "@/lib/owner-insights";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rowsOrNull<T>(label: string, query: PromiseLike<{ data: unknown; error: any }>): Promise<T[] | null> {
  try {
    const { data, error } = await query;
    if (error) {
      console.error(`[owner-insights] ${label} read failed:`, error.code, error.message);
      return null;
    }
    return (data ?? []) as T[];
  } catch (e) {
    console.error(`[owner-insights] ${label} read failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export async function fetchInsightRows(hallIds: string[], month: MonthKey): Promise<InsightRows> {
  if (hallIds.length === 0) {
    return { views: [], scans: [], leads: [], visits: [], reviews: [], bookings: [] };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await getSupabaseServerClient()) as any;
  const { start, end } = monthRange(month);
  const { from, to } = monthTimestamps(month);

  const [views, scans, leads, visits, reviews, bookings] = await Promise.all([
    rowsOrNull("views", db.from("hall_page_views").select("hall_id, views")
      .in("hall_id", hallIds).gte("view_date", start).lt("view_date", end)),
    rowsOrNull("scans", db.from("hall_qr_scans").select("hall_id, scans")
      .in("hall_id", hallIds).gte("scan_date", start).lt("scan_date", end)),
    rowsOrNull("leads", db.from("leads").select("hall_id, status, created_at, quoted_at, accepted_at")
      .in("hall_id", hallIds).gte("created_at", from).lt("created_at", to)),
    rowsOrNull("visits", db.from("site_visits").select("hall_id, status")
      .in("hall_id", hallIds).gte("created_at", from).lt("created_at", to)),
    rowsOrNull("reviews", db.from("reviews").select("hall_id, rating")
      .in("hall_id", hallIds).eq("is_visible", true).gte("created_at", from).lt("created_at", to)),
    rowsOrNull("bookings", db.from("bookings").select("hall_id, status, total_amount")
      .in("hall_id", hallIds).in("status", ["booking_requested", "owner_confirmed", "completed"])
      .gte("created_at", from).lt("created_at", to)),
  ]);

  return {
    views: views as InsightRows["views"],
    scans: scans as InsightRows["scans"],
    leads: leads as InsightRows["leads"],
    visits: visits as InsightRows["visits"],
    reviews: reviews as InsightRows["reviews"],
    bookings: bookings as InsightRows["bookings"],
  };
}

/** The first day any view was counted for these halls, or null if none yet. */
export async function firstCountedViewDate(hallIds: string[]): Promise<string | null> {
  if (hallIds.length === 0) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await getSupabaseServerClient()) as any;
  const rows = await rowsOrNull<{ view_date: string }>("first view", db.from("hall_page_views")
    .select("view_date").in("hall_id", hallIds).order("view_date", { ascending: true }).limit(1));
  return rows?.[0]?.view_date ?? null;
}
