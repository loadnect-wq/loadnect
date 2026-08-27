// ─────────────────────────────────────────────────────────────────────────────
// lib/booking-expiry.ts — expire booking requests the owner never answered.
// SERVER-ONLY.
//
// The 48-hour deadline was HALF built: migration 0027 added
// bookings.owner_response_due_at, a trigger stamps it the moment a booking
// enters booking_requested, and the owner dashboard counts down against it.
// Nothing ever acted on it. So a request an owner ignored sat in
// booking_requested forever — holding the customer's money, blocking those
// dates on the calendar for every other customer, and still acceptable weeks
// later, long after the couple had booked somewhere else.
//
// This is the missing half. For each overdue request it does, in order:
//   1. cancels the booking (status-guarded, so a simultaneous owner Accept
//      wins and the sweep skips it),
//   2. records the refund as PLATFORM-caused — the customer did nothing wrong
//      and the venue never responded, so the ₹200 platform fee goes back too,
//   3. releases the calendar dates,
//   4. notifies the customer, the owner and the admin.
//
// Idempotent and safe to run repeatedly: the status guard means an already
// cancelled booking matches zero rows and is skipped, and recordBookingRefund
// is itself idempotent.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordBookingRefund } from "@/lib/refunds";
import { releaseAvailabilityForBooking } from "@/lib/availability-release";
import { notifyBookingEvent } from "@/lib/notifications/events";

export type BookingExpirySummary = {
  /** Requests found past their deadline. */
  found: number;
  /** Actually cancelled by this run (excludes ones a concurrent Accept won). */
  expired: number;
  /** Bookings for which a refund was recorded as owed. */
  refundsRecorded: number;
  /** Failures, described for an admin. Never thrown — the sweep continues. */
  errors: string[];
};

/** Bounded so one run cannot spin forever; the sweep is repeatable. */
const MAX_PER_RUN = 200;

export async function expireOverdueBookingRequests(): Promise<BookingExpirySummary> {
  const summary: BookingExpirySummary = { found: 0, expired: 0, refundsRecorded: 0, errors: [] };

  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;

    const nowIso = new Date().toISOString();
    const { data: overdue, error } = await db
      .from("bookings")
      .select("id, owner_response_due_at")
      .eq("status", "booking_requested")
      .not("owner_response_due_at", "is", null)
      .lt("owner_response_due_at", nowIso)
      .order("owner_response_due_at", { ascending: true })
      .limit(MAX_PER_RUN);

    if (error) {
      summary.errors.push(`Could not read overdue requests: ${error.message}`);
      return summary;
    }

    const rows = (overdue ?? []) as { id: string }[];
    summary.found = rows.length;

    for (const row of rows) {
      try {
        // Status-guarded: if the owner accepted or declined in the meantime
        // this matches zero rows and we leave their decision alone.
        const { count, error: cancelErr } = await db
          .from("bookings")
          .update(
            {
              status: "cancelled",
              cancel_reason: "The venue did not respond within 48 hours — cancelled automatically",
            },
            { count: "exact" },
          )
          .eq("id", row.id)
          .eq("status", "booking_requested");

        if (cancelErr) {
          summary.errors.push(`${row.id}: ${cancelErr.message}`);
          continue;
        }
        if ((count ?? 0) === 0) continue; // owner got there first

        summary.expired += 1;

        // PLATFORM-caused: the customer is owed everything back, fee included.
        const refund = await recordBookingRefund(row.id, "platform");
        if (refund) summary.refundsRecorded += 1;

        await releaseAvailabilityForBooking(row.id);

        await notifyBookingEvent("booking.cancelled", row.id, {
          reason: "The venue did not respond in time",
        });
      } catch (e) {
        summary.errors.push(`${row.id}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }

    return summary;
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : "unknown");
    return summary;
  }
}

/**
 * Has this booking request run out of time?
 *
 * Used by the owner's Accept to refuse a request whose window has closed —
 * without it, an owner could accept days later a booking the customer has been
 * told would auto-expire, and whose refund may already be owed.
 */
export function isOwnerResponseOverdue(dueAt: string | null | undefined): boolean {
  if (!dueAt) return false;          // no deadline recorded → never blocks
  const t = Date.parse(dueAt);
  return Number.isFinite(t) && t < Date.now();
}
