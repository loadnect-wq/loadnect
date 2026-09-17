// ─────────────────────────────────────────────────────────────────────────────
// lib/hall-commission.ts — reads the commission SNAPSHOT stored on bookings.
// SERVER-ONLY.
//
// WHAT THIS MODULE USED TO BE. It read and wrote each hall's own commission
// rate, chosen by the owner from 1.5% to 5%. That system is gone: Hallnect
// charges one standard rate (lib/commission.ts), so there is no per-hall rate
// to read, set, filter, sort or fall back from. halls.commission_rate survives
// only as a recorded value constrained to the standard (migration 0097).
//
// WHAT IT STILL DOES. Historical bookings keep the rate and amount they were
// charged. Those columns are hidden from anon and authenticated (0032), so
// they are read here through the service role, and shown as stored — never
// recomputed at today's rate.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/** What a booking's own commission snapshot says, in rupees. */
export type BookingCommission = {
  /** The rate stored ON THE BOOKING at creation — never today's hall rate. */
  rate: number | null;
  amount: number | null;
  ownerNetAdvance: number | null;
};

/**
 * Commission snapshots for many bookings, keyed by booking id.
 *
 * SERVICE ROLE, because migration 0032 hides commission_rate,
 * commission_amount and owner_net_advance on `bookings` from both anon and
 * authenticated — including the admin's own session, since an admin is
 * `authenticated` too. Naming those columns in fetchAllBookings' select would
 * raise 42703 and blank /admin/bookings entirely.
 *
 * READS THE SNAPSHOT, NEVER RECOMPUTES IT. What an admin is shown must be what
 * the customer was actually charged, which is the figure stored on the row at
 * booking time — not the hall's rate today, and not this rate re-multiplied
 * against the price. If the hall's rate has since changed, these numbers stay
 * as they were, which is the entire point of snapshotting them.
 */
export async function readBookingCommissions(
  bookingIds: readonly string[],
): Promise<Map<string, BookingCommission>> {
  const out = new Map<string, BookingCommission>();
  if (bookingIds.length === 0) return out;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    const { data, error } = await db
      .from("bookings")
      .select("id, commission_rate, commission_amount, owner_net_advance")
      .in("id", [...bookingIds]);
    if (error) {
      console.error("[hall-commission] booking read failed", error.code, error.message);
      return out;
    }
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const num = (v: unknown) => (v == null ? null : Number(v));
      out.set(String(row.id), {
        rate:            num(row.commission_rate),
        amount:          num(row.commission_amount),
        ownerNetAdvance: num(row.owner_net_advance),
      });
    }
    return out;
  } catch (e) {
    console.error("[hall-commission] booking read threw", e instanceof Error ? e.message : e);
    return out;
  }
}
