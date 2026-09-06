// ─────────────────────────────────────────────────────────────────────────────
// lib/offline-bookings.ts — bookings a venue took off-platform. SERVER-ONLY.
//
// A venue that takes a booking over the phone has to be able to say so here, or
// Hallnect will happily sell the same date online. That is the whole feature.
//
// EVERYTHING GOES THROUGH THE RPCs, and that is not indirection for its own
// sake. create_offline_booking and cancel_offline_booking hold an advisory
// transaction lock on every day they touch (migration 0057), which is the only
// thing that makes them safe against a customer paying for the same date in the
// same moment. offline_bookings deliberately has NO client write policy, so a
// direct insert from here would not merely bypass the lock — it would be
// refused. If you find yourself reaching for .from("offline_bookings").insert(),
// read 0057 first.
//
// The session client is used, not the service role: the RPCs are SECURITY
// DEFINER and check owns_hall(hall_id) OR is_admin() using auth.uid(), so the
// caller's identity IS the authorisation. A service-role call would arrive with
// no auth.uid() and be refused — correctly.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export type OfflineBookingRow = {
  id: string;
  hall_id: string;
  event_date: string;
  end_date: string;
  slot: "morning" | "evening" | "full_day";
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  reference: string | null;
  status: "confirmed" | "cancelled";
  created_at: string;
};

export type OfflineBookingResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Turns a Postgres error into something a venue owner can act on.
 *
 * The clash case is raised as 23P01 with a message beginning INVENTORY_TAKEN,
 * and that message names WHICH kind of claim won — "a confirmed booking", "an
 * offline booking", "a maintenance block". That distinction is the useful part:
 * "this date is taken" leaves an owner guessing whether they double-entered it
 * themselves or a customer booked it from under them.
 *
 * Everything else is deliberately generic. Raw Postgres text on an owner's
 * screen is both unhelpful and a disclosure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function friendlyError(error: any): string {
  const raw = String(error?.message ?? "");

  if (raw.includes("INVENTORY_TAKEN")) {
    const cause = raw.split("INVENTORY_TAKEN:")[1]?.split("already holds")[0]?.trim();
    return cause
      ? `Those dates are not free — ${cause} already holds them. Refresh the calendar to see what changed.`
      : "Those dates are already taken. Refresh the calendar to see what changed.";
  }
  if (error?.code === "42501" || raw.includes("only manage inventory for your own venue")) {
    return "You can only manage inventory for your own venue.";
  }
  if (raw.includes("end date cannot be before")) {
    return "The end date cannot be before the start date.";
  }
  if (raw.includes("more than 31 days")) {
    return "An offline booking cannot span more than 31 days.";
  }

  console.error("[offline-bookings]", error?.code, raw);
  return "Could not save that booking. Please try again.";
}

export async function createOfflineBooking(input: {
  hallId: string;
  eventDate: string;
  endDate: string;
  slot: "morning" | "evening" | "full_day";
  customerName?: string | null;
  customerPhone?: string | null;
  notes?: string | null;
  reference?: string | null;
}): Promise<OfflineBookingResult> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db.rpc("create_offline_booking", {
    _hall_id:        input.hallId,
    _event_date:     input.eventDate,
    _end_date:       input.endDate,
    _slot:           input.slot,
    _customer_name:  input.customerName ?? null,
    _customer_phone: input.customerPhone ?? null,
    _notes:          input.notes ?? null,
    _reference:      input.reference ?? null,
  });

  if (error) return { ok: false, error: friendlyError(error) };
  if (!data)  return { ok: false, error: "Could not save that booking. Please try again." };
  return { ok: true, id: String(data) };
}

export async function cancelOfflineBooking(id: string): Promise<OfflineBookingResult> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db.rpc("cancel_offline_booking", { _id: id });
  if (error) return { ok: false, error: friendlyError(error) };
  return { ok: true, id };
}

/**
 * The venue's own offline bookings. RLS (owns_hall OR is_admin) is the gate —
 * this is read through the session client precisely so that policy IS the
 * check, rather than a second ownership test here that could disagree with it.
 */
export async function fetchOfflineBookings(
  hallId: string,
  opts?: { includeCancelled?: boolean },
): Promise<OfflineBookingRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let q = db
    .from("offline_bookings")
    .select("id, hall_id, event_date, end_date, slot, customer_name, customer_phone, notes, reference, status, created_at")
    .eq("hall_id", hallId)
    .order("event_date", { ascending: true });

  if (!opts?.includeCancelled) q = q.eq("status", "confirmed");

  const { data, error } = await q;
  if (error) {
    // A missing table (un-migrated environment) must not break the calendar.
    console.error("[offline-bookings] list failed:", error.code, error.message);
    return [];
  }
  return (data ?? []) as OfflineBookingRow[];
}
