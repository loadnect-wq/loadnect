// ─────────────────────────────────────────────────────────────────────────────
// lib/owner-diary.ts — what the diary reads that lib/offline-bookings does not.
// SERVER-ONLY.
//
// The diary lists EVERY function at the hall in one place: the venue's own
// bookings (offline_bookings, with names and money) and the ones customers paid
// for on Hallnect. A manager who keeps two lists will stop keeping one of them.
// Hallnect's bookings are read-only here — their money is handled by checkout
// and payouts, and they are managed from /owner/bookings.
//
// Read through the session client, so RLS (bookings_select → owns_hall) is the
// ownership check, and STRICTLY: a failed read throws rather than rendering an
// empty diary, which would read as "nothing booked".
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ACTIVE_BOOKING_STATUSES } from "@/lib/availability";

export type DiaryOnlineBooking = {
  id: string;
  event_date: string;
  end_date: string;
  slot: "morning" | "evening" | "full_day";
  status: string;
};

/** Hallnect bookings at this hall that end on or after `fromDate`. */
export async function fetchDiaryOnlineBookings(hallId: string, fromDate: string): Promise<DiaryOnlineBooking[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("bookings")
    .select("id, event_date, end_date, slot, status")
    .eq("hall_id", hallId)
    .in("status", ACTIVE_BOOKING_STATUSES)
    .gte("end_date", fromDate)
    .order("event_date", { ascending: true });

  if (error) {
    console.error("[owner-diary] online bookings read failed:", error.code, error.message);
    throw new Error("Could not load your diary.");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any): DiaryOnlineBooking => ({
    id: r.id,
    event_date: r.event_date,
    end_date: r.end_date ?? r.event_date,
    slot: r.slot,
    status: r.status,
  }));
}
