// ─────────────────────────────────────────────────────────────────────────────
// lib/refund-schedule.ts — the published customer-cancellation schedule (PURE).
//
// WHY THIS IS ITS OWN FILE: lib/refunds.ts is `import "server-only"`, so the
// cancel dialog could not read the schedule to show the customer what they get
// back — and so it showed nothing. /cancellation-policy promises in writing:
// "You will be shown the expected refund amount before you confirm." A customer
// cancelling six days out gets ZERO back, and found that out afterwards, from a
// row the booking page then hid because it renders only refund_amount > 0.
//
// The table lives here and lib/refunds.ts re-exports it, so there is still ONE
// source of truth and the server and the dialog can never quote different
// numbers.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Percent of the ADVANCE returned on a CUSTOMER cancellation, by how far ahead
 * of the event it lands. Editing this table is how the policy changes — no
 * caller hard-codes a number.
 *
 * Owner- and platform-initiated cancellations do not use this at all: those
 * return 100% of the advance AND the platform fee.
 */
export const CUSTOMER_REFUND_SCHEDULE = [
  { minDaysBeforeEvent: 31, percentOfAdvance: 100 },
  { minDaysBeforeEvent: 15, percentOfAdvance: 75 },
  { minDaysBeforeEvent: 7,  percentOfAdvance: 50 },
  { minDaysBeforeEvent: 0,  percentOfAdvance: 0 },
] as const;

/** Percent of the advance refundable for a customer cancellation. */
export function customerRefundPercent(daysUntilEvent: number): number {
  for (const tier of CUSTOMER_REFUND_SCHEDULE) {
    if (daysUntilEvent >= tier.minDaysBeforeEvent) return tier.percentOfAdvance;
  }
  return 0;
}

/**
 * Whole days from today until the event, matching the server's convention
 * (`daysBetweenInclusive(today, eventDate) - 1`) so the figure previewed in the
 * dialog is the figure the server will actually apply.
 */
export function daysUntilEventFromToday(eventDateIso: string, todayIso: string): number {
  const a = new Date(`${todayIso}T00:00:00Z`).getTime();
  const b = new Date(`${eventDateIso}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}
