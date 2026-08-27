// ─────────────────────────────────────────────────────────────────────────────
// lib/availability-release.ts — give a cancelled booking's dates back.
// SERVER-ONLY.
//
// applyPaidSideEffects blocks the calendar on payment, stamping booking_id on
// every row it writes. NOTHING released those rows again: a cancelled,
// rejected or expired booking left its dates marked full_day_booked forever,
// so every cancellation permanently destroyed inventory that nobody could
// re-book and no screen explained. On a marketplace with a handful of venues
// that is the difference between a working calendar and a dead one.
//
// The rows are DELETED rather than set back to 'available': absence is what
// this schema means by available, and deleting cannot resurrect an owner's
// manual 'blocked' that predated the booking — those rows carry no booking_id
// and are therefore never touched here.
//
// Uses the service-role client deliberately. Cancellation runs from the
// CUSTOMER's session, and availability_write is owns_hall(hall_id), so the
// customer's own client cannot release the hall's calendar.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Frees every availability row this booking reserved. Never throws: a
 * cancellation must succeed even if the calendar write fails, so a failure is
 * logged for repair rather than surfaced to whoever cancelled.
 */
export async function releaseAvailabilityForBooking(bookingId: string): Promise<void> {
  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;

    const { error, count } = await db
      .from("availability")
      .delete({ count: "exact" })
      .eq("booking_id", bookingId);

    if (error) {
      // 42703 = booking_id column absent (pre-0009 database). Nothing to do:
      // those deployments never linked availability rows to a booking.
      if (error.code !== "42703" && error.code !== "PGRST204") {
        console.error(`[availability] could not release booking ${bookingId}:`, error.message);
      }
      return;
    }
    if ((count ?? 0) > 0) {
      console.info(`[availability] released ${count} date(s) for cancelled booking ${bookingId}`);
    }
  } catch (e) {
    console.error("[availability] release failed:", e instanceof Error ? e.message : e);
  }
}
