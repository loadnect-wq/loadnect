// ─────────────────────────────────────────────────────────────────────────────
// lib/availability-status.ts — the availability vocabulary, in ONE place.
//
// NO IMPORTS, DELIBERATELY. This is imported by server code and by client
// components alike; the moment it pulls in lib/supabase/server it can no longer
// be used in the browser, and the copies start breeding again.
//
// WHY IT EXISTS. `offline_booked` was added in migration 0056 and taught to
// assert_inventory_free, which is the thing that actually prevents a double
// booking. It was NOT taught to the four separate hardcoded lists the
// application kept:
//
//   lib/availability.ts   HARD_BLOCK_STATUSES   the customer's booking calendar
//   lib/halls.ts          FULL_BLOCK_STATUSES   the date-filtered search
//   HallDetailView.tsx    FULL_BLOCK            the public availability strip
//   offline-booking.test  a literal array       the test that claimed to cover it
//
// So a venue could block a date for an offline booking and Hallnect would still
// list the hall in a search for that date, paint the date green on the venue
// page, and let the customer walk the whole checkout — only for the database to
// refuse the payment at the last step. Measured against a live block, not
// reasoned about: the public strip rendered 10 and 11 September as available
// while `availability` held offline_booked rows for both.
//
// No double booking ever occurred, because the database's list was complete.
// Every OTHER list was a lie about it.
// ─────────────────────────────────────────────────────────────────────────────

export type BookingSlot = "morning" | "evening" | "full_day";

/**
 * Statuses that take the WHOLE day, whatever slot is being asked for.
 *
 * Must stay in step with assert_inventory_free (migration 0057), which encodes
 * the same set in SQL. That function is authoritative — it holds the advisory
 * lock — so a status present there and missing here does not cause a double
 * booking; it causes a customer to be refused after paying attention to a
 * calendar that told them yes.
 */
export const HARD_BLOCK_STATUSES: ReadonlySet<string> = new Set([
  "booked",
  "blocked",
  "full_day_booked",
  "maintenance",
  "offline_booked",
]);

/** Blocks a morning request, and any full-day request. */
export const MORNING_BLOCK_STATUSES: ReadonlySet<string> = new Set([
  "morning_booked",
  "partially_booked",
]);

/** Blocks an evening request, and any full-day request. */
export const EVENING_BLOCK_STATUSES: ReadonlySet<string> = new Set([
  "evening_booked",
  "partially_booked",
]);

/**
 * Every status that makes a day completely unsellable — the union of the hard
 * blocks with "both halves are gone". Used by the search filter and the public
 * availability strip, which care only about the day, not the slot.
 */
export const FULL_BLOCK_STATUSES: readonly string[] = [...HARD_BLOCK_STATUSES];

/** Statuses that leave part of the day sellable. */
export const PARTIAL_BLOCK_STATUSES: ReadonlySet<string> = new Set([
  ...MORNING_BLOCK_STATUSES,
  ...EVENING_BLOCK_STATUSES,
]);

/** Which of a day's three sellable slots are still free. */
export type SlotFreedom = Record<BookingSlot, boolean>;

/**
 * Applies one claim to a day, in place.
 *
 * THE RULE THAT IS EASY TO GET WRONG: a half-day claim takes its own half AND
 * full_day, because a day with a morning booking can no longer be sold whole.
 */
export function occupySlot(free: SlotFreedom, slot: BookingSlot): void {
  if (slot === "full_day") {
    free.morning = free.evening = free.full_day = false;
  } else {
    free[slot] = false;
    free.full_day = false;
  }
}
