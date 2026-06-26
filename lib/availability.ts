// Server-side availability check.
// THIS IS THE AUTHORITATIVE source for "can this slot be booked?".
// Never trust the frontend's calendar state — always re-check here before
// creating a booking or payment.

import { getSupabaseServerClient } from "@/lib/supabase/server";

export type BookingSlot = "morning" | "evening" | "full_day";

// Availability-table statuses that fully block ANY booking on this date+slot.
// (booked/blocked/full_day_booked/maintenance block any slot;
//  morning_booked/evening_booked/partially_booked block the matching slot or full_day)
export const HARD_BLOCK_STATUSES = new Set([
  "booked",
  "blocked",
  "full_day_booked",
  "maintenance",
]);

// Slot-specific availability statuses.
export const MORNING_BLOCK_STATUSES  = new Set(["morning_booked", "partially_booked"]);
export const EVENING_BLOCK_STATUSES  = new Set(["evening_booked", "partially_booked"]);

// Active booking statuses — these reserve a slot.
// Matches the partial unique index `uq_booking_active_slot` in migration 0003.
export const ACTIVE_BOOKING_STATUSES = [
  "payment_success",
  "booking_requested",
  "owner_confirmed",
  "completed",
];

export type AvailabilityCheck =
  | { available: true }
  | { available: false; reason: string };

/**
 * Authoritative server-side check: can a customer book this hall on this
 * (date, slot) right now? Combines:
 *   1. availability rows owners have explicitly set (maintenance/blocked/etc.)
 *   2. existing ACTIVE bookings (full-day vs half-day overlaps)
 *
 * SECURITY: Uses the session-aware server client so RLS applies. Customers
 * see availability rows only for APPROVED halls (availability_select policy).
 * This function is meant to be called from server actions — never trust the
 * client's calendar snapshot.
 */
export async function checkSlotAvailability(
  hallId: string,
  date:   string,         // YYYY-MM-DD
  slot:   BookingSlot,
): Promise<AvailabilityCheck> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Date must be in the future (or today). The DB also has a constraint
  // (event_date >= '2024-01-01') and the trigger blocks past bookings.
  const today = new Date().toISOString().split("T")[0];
  if (date < today) {
    return { available: false, reason: "Event date cannot be in the past." };
  }

  // ── 1. Check the availability table ────────────────────────────────────────
  const { data: availRows, error: availErr } = await db
    .from("availability")
    .select("slot, status")
    .eq("hall_id", hallId)
    .eq("date", date);

  if (availErr) {
    // Tables not provisioned → treat as available (dev environment).
    if (availErr.code !== "PGRST205" && availErr.code !== "42P01") {
      console.error("[checkSlotAvailability] availability query failed", availErr.message);
      return { available: false, reason: "Could not verify availability. Please try again." };
    }
  }

  for (const row of (availRows ?? []) as { slot: string; status: string }[]) {
    // Hard blocks affect any slot.
    if (HARD_BLOCK_STATUSES.has(row.status)) {
      return { available: false, reason: "This date is unavailable." };
    }

    // Partial blocks: only block matching slots.
    if (slot === "full_day") {
      // Full-day needs the entire day clear — any partial block kills it.
      if (MORNING_BLOCK_STATUSES.has(row.status) || EVENING_BLOCK_STATUSES.has(row.status)) {
        return { available: false, reason: "Part of this day is already taken." };
      }
    } else if (slot === "morning") {
      if (MORNING_BLOCK_STATUSES.has(row.status)) {
        return { available: false, reason: "Morning slot is unavailable." };
      }
      // A morning request is also blocked if someone marked the full day.
      if (row.slot === "full_day" && (row.status === "booked" || row.status === "full_day_booked")) {
        return { available: false, reason: "This date is fully booked." };
      }
    } else if (slot === "evening") {
      if (EVENING_BLOCK_STATUSES.has(row.status)) {
        return { available: false, reason: "Evening slot is unavailable." };
      }
      if (row.slot === "full_day" && (row.status === "booked" || row.status === "full_day_booked")) {
        return { available: false, reason: "This date is fully booked." };
      }
    }
  }

  // ── 2. Check existing ACTIVE bookings on the same date ─────────────────────
  const { data: bookings, error: bookingsErr } = await db
    .from("bookings")
    .select("slot, status")
    .eq("hall_id", hallId)
    .eq("event_date", date)
    .in("status", ACTIVE_BOOKING_STATUSES);

  if (bookingsErr) {
    if (bookingsErr.code !== "PGRST205" && bookingsErr.code !== "42P01") {
      console.error("[checkSlotAvailability] bookings query failed", bookingsErr.message);
      return { available: false, reason: "Could not verify availability. Please try again." };
    }
  }

  for (const b of (bookings ?? []) as { slot: string; status: string }[]) {
    // Full-day request conflicts with anything; any request conflicts with full-day.
    if (slot === "full_day" || b.slot === "full_day") {
      return { available: false, reason: "Another booking already covers this date." };
    }
    // Same half-slot already booked.
    if (slot === b.slot) {
      return { available: false, reason: `The ${slot} slot is already booked.` };
    }
  }

  return { available: true };
}

/**
 * Bulk version: returns a map of per-(date,slot) availability for a hall over
 * a date window. Used to render the booking flow's calendar with accurate,
 * server-fetched availability — no frontend hardcoding.
 */
export type DaySlotAvailability = {
  date:     string;
  morning:  boolean;
  evening:  boolean;
  full_day: boolean;
};

export async function fetchHallAvailabilityWindow(
  hallId: string,
  fromDate: string,
  toDate:   string,
): Promise<DaySlotAvailability[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [availRes, bookingsRes] = await Promise.all([
    db.from("availability")
      .select("date, slot, status")
      .eq("hall_id", hallId)
      .gte("date", fromDate)
      .lte("date", toDate),
    db.from("bookings")
      .select("event_date, slot, status")
      .eq("hall_id", hallId)
      .gte("event_date", fromDate)
      .lte("event_date", toDate)
      .in("status", ACTIVE_BOOKING_STATUSES),
  ]);

  // Build availability map starting from "everything available"
  const result = new Map<string, DaySlotAvailability>();
  const start = new Date(fromDate);
  const end   = new Date(toDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().split("T")[0];
    result.set(iso, { date: iso, morning: true, evening: true, full_day: true });
  }

  // Apply availability rows
  for (const row of (availRes.data ?? []) as { date: string; slot: string; status: string }[]) {
    const day = result.get(row.date);
    if (!day) continue;
    if (HARD_BLOCK_STATUSES.has(row.status)) {
      day.morning = day.evening = day.full_day = false;
      continue;
    }
    if (MORNING_BLOCK_STATUSES.has(row.status)) {
      day.morning  = false;
      day.full_day = false;
    }
    if (EVENING_BLOCK_STATUSES.has(row.status)) {
      day.evening  = false;
      day.full_day = false;
    }
  }

  // Apply active bookings
  for (const b of (bookingsRes.data ?? []) as { event_date: string; slot: string; status: string }[]) {
    const day = result.get(b.event_date);
    if (!day) continue;
    if (b.slot === "full_day") {
      day.morning = day.evening = day.full_day = false;
    } else if (b.slot === "morning") {
      day.morning  = false;
      day.full_day = false;
    } else if (b.slot === "evening") {
      day.evening  = false;
      day.full_day = false;
    }
  }

  return [...result.values()];
}
