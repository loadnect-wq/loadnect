// ─────────────────────────────────────────────────────────────────────────────
// lib/owner-calendar.ts — the owner's calendar, DERIVED. SERVER-ONLY.
//
// There is no table of "which dates are available". There never should have
// been: a stored answer has to be maintained, and anything maintained by hand
// drifts from the bookings it is supposed to describe. Availability is the
// ABSENCE of a claim, computed here from the records that create claims:
//
//   bookings           a customer paid on Hallnect          → red
//   offline_bookings   the venue took it off-platform       → amber
//   availability rows  with neither foreign key set         → grey (see below)
//
// The third case is legacy/platform-only. Since 0063 no client can write this
// table at all, so a bare row can now only come from Hallnect itself. An owner
// cannot clear one from here, and the UI says so rather than offering a button
// that would fail.
//
// `availability` is still read for that third case only. It is NOT consulted
// for bookings or offline bookings, because for those it is a PROJECTION —
// derived output that exists so anonymous visitors and Realtime have something
// public to read. Deriving from a projection is how the two drift apart.
//
// SECURITY. Everything here goes through the session client, so RLS is the
// gate: bookings_select and offline_bookings_select are both owns_hall(), and
// availability_select adds the owner's own halls to the public set. There is
// deliberately no second ownership check here that could disagree with them.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isoDateRange } from "@/lib/dates";
import {
  ACTIVE_BOOKING_STATUSES,
  HARD_BLOCK_STATUSES,
  MORNING_BLOCK_STATUSES,
  EVENING_BLOCK_STATUSES,
  occupySlot,
} from "@/lib/availability";

export type CalendarSlot = "morning" | "evening" | "full_day";

/** Who holds a date, and — only for the kind the owner can undo — the handle. */
export type ClaimKind = "online" | "offline" | "platform";

export type DayClaim = {
  kind: ClaimKind;
  slot: CalendarSlot;
  /** Present only for `offline` — the id cancel_offline_booking takes. */
  offlineBookingId: string | null;
  /** Present only for `online` — so the owner can open the booking. */
  bookingId: string | null;
  /** Offline only, and owner-visible only. Never leaves this dashboard. */
  customerName: string | null;
  reference: string | null;
  /** True when the claim starts before or ends after the day being rendered. */
  spansOtherDays: boolean;
  startDate: string;
  endDate: string;
};

export type CalendarDay = {
  date: string;
  claims: DayClaim[];
  free: Record<CalendarSlot, boolean>;
  /** Convenience for the grid: nothing at all is claimed on this day. */
  fullyFree: boolean;
};

const SLOTS: CalendarSlot[] = ["morning", "evening", "full_day"];

export async function fetchOwnerCalendar(
  hallId: string,
  fromDate: string,
  toDate: string,
): Promise<CalendarDay[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [bookingsRes, offlineRes, availRes] = await Promise.all([
    // Overlap, not equality: a range booking that STARTED before this window
    // still occupies days inside it.
    db.from("bookings")
      .select("id, event_date, end_date, slot, status")
      .eq("hall_id", hallId)
      .lte("event_date", toDate)
      .gte("end_date", fromDate)
      .in("status", ACTIVE_BOOKING_STATUSES),
    db.from("offline_bookings")
      .select("id, event_date, end_date, slot, customer_name, reference")
      .eq("hall_id", hallId)
      .eq("status", "confirmed")
      .lte("event_date", toDate)
      .gte("end_date", fromDate),
    // Bare rows only — the ones that are a claim in their own right rather than
    // a projection of one of the two tables above.
    db.from("availability")
      .select("date, slot, status")
      .eq("hall_id", hallId)
      .gte("date", fromDate)
      .lte("date", toDate)
      .is("booking_id", null)
      .is("offline_booking_id", null),
  ]);

  for (const [what, res] of [
    ["bookings", bookingsRes],
    ["offline_bookings", offlineRes],
    ["availability", availRes],
  ] as const) {
    // A missing table (un-migrated environment) must not blank the calendar —
    // but an owner must never be shown a calendar that silently omits a claim,
    // so anything else is surfaced rather than swallowed.
    if (res.error && res.error.code !== "PGRST205" && res.error.code !== "42P01") {
      console.error(`[owner-calendar] ${what} read failed:`, res.error.code, res.error.message);
      throw new Error("Could not load the calendar.");
    }
  }

  const days = new Map<string, CalendarDay>();
  for (const iso of isoDateRange(fromDate, toDate)) {
    days.set(iso, {
      date: iso,
      claims: [],
      free: { morning: true, evening: true, full_day: true },
      fullyFree: true,
    });
  }

  function addClaim(
    startIso: string,
    endIso: string,
    slot: CalendarSlot,
    base: Omit<DayClaim, "slot" | "spansOtherDays" | "startDate" | "endDate">,
  ) {
    const spans = endIso !== startIso;
    for (const iso of isoDateRange(startIso, endIso)) {
      const day = days.get(iso);
      if (!day) continue; // outside the rendered window
      day.claims.push({ ...base, slot, spansOtherDays: spans, startDate: startIso, endDate: endIso });
      occupySlot(day.free, slot);
    }
  }

  type BookingRow = { id: string; event_date: string; end_date: string | null; slot: string };
  for (const b of (bookingsRes.data ?? []) as BookingRow[]) {
    addClaim(b.event_date, b.end_date ?? b.event_date, b.slot as CalendarSlot, {
      kind: "online",
      offlineBookingId: null,
      bookingId: b.id,
      customerName: null,
      reference: null,
    });
  }

  type OfflineRow = {
    id: string;
    event_date: string;
    end_date: string | null;
    slot: string;
    customer_name: string | null;
    reference: string | null;
  };
  for (const o of (offlineRes.data ?? []) as OfflineRow[]) {
    addClaim(o.event_date, o.end_date ?? o.event_date, o.slot as CalendarSlot, {
      kind: "offline",
      offlineBookingId: o.id,
      bookingId: null,
      customerName: o.customer_name,
      reference: o.reference,
    });
  }

  // Bare availability rows. Their STATUS carries the slot meaning, not the
  // `slot` column, so they are translated rather than read literally.
  type AvailRow = { date: string; slot: string; status: string };
  for (const r of (availRes.data ?? []) as AvailRow[]) {
    const day = days.get(r.date);
    if (!day) continue;
    let slot: CalendarSlot | null = null;
    if (HARD_BLOCK_STATUSES.has(r.status)) slot = "full_day";
    else if (MORNING_BLOCK_STATUSES.has(r.status) && EVENING_BLOCK_STATUSES.has(r.status)) slot = "full_day";
    else if (MORNING_BLOCK_STATUSES.has(r.status)) slot = "morning";
    else if (EVENING_BLOCK_STATUSES.has(r.status)) slot = "evening";
    if (!slot) continue; // e.g. an explicit 'available'
    day.claims.push({
      kind: "platform",
      slot,
      offlineBookingId: null,
      bookingId: null,
      customerName: null,
      reference: null,
      spansOtherDays: false,
      startDate: r.date,
      endDate: r.date,
    });
    occupySlot(day.free, slot);
  }

  for (const day of days.values()) {
    day.fullyFree = SLOTS.every((s) => day.free[s]);
  }
  return [...days.values()];
}
