// ─────────────────────────────────────────────────────────────────────────────
// lib/refund-sla.ts — watches the refund promise the site publishes.
// SERVER-ONLY.
//
// /refund-policy §8 says approved refunds are processed within 5–7 business
// days. Nothing in the product counted those days. recordBookingRefund marks a
// payment refund_state='owed' and stops; the money moves only when an admin
// presses the button in /admin/payments. There was no queue, no ageing and no
// reminder — so the published SLA was kept, or not, depending on whether
// somebody happened to look.
//
// THIS REPORTS. IT NEVER PAYS. issueRefund() in app/admin/actions.ts stays the
// only code that calls Cashfree, because it is the only place with the
// double-spend guard and the audit trail. A sweep that could move money on a
// timer is a different risk profile entirely, and not one worth taking to save
// a click.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyAdminOperational } from "@/lib/notifications/events";
import { todayInBusinessTz } from "@/lib/dates";

/**
 * Calendar days a refund may sit owed before it is reported.
 *
 * DERIVED FROM THE PUBLISHED WINDOW, not picked. The promise is 5–7 BUSINESS
 * days, which is roughly 7–11 calendar days depending on where the weekend
 * falls. The alarm has to fire while that window can still be kept, not after
 * it has closed — an alert that arrives on day 12 is a post-mortem, not a
 * warning.
 *
 * Four calendar days is about three business days, leaving two to four business
 * days of the promise still available when the alert lands.
 *
 * IF /refund-policy §8 CHANGES, THIS CHANGES. That file's comment says so too.
 */
export const REFUND_OVERDUE_DAYS = 4;

export type OverdueRefundSummary = {
  overdue: number;
  failed: number;
  totalAmount: number;
  alerted: boolean;
};

/**
 * Finds refunds owed longer than the SLA allows and sends ONE alert.
 *
 * Never throws — it is piggy-backed on the nightly booking sweep, which cancels
 * bookings and records refunds, and a reporting tidy-up must never fail the job
 * that moves customer money.
 */
export async function reportOverdueRefunds(): Promise<OverdueRefundSummary | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;

    const { data, error } = await db
      .from("payments")
      .select("id, booking_id, refund_amount, refund_state, refund_owed_at, updated_at")
      .in("refund_state", ["owed", "failed"])
      .gt("refund_amount", 0)
      .limit(500);

    if (error) {
      console.error("[refunds:overdue] could not read the queue:", error.code, error.message);
      return null;
    }

    const cutoffMs = Date.now() - REFUND_OVERDUE_DAYS * 24 * 60 * 60 * 1000;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flagged = (data ?? []).filter((p: any) => {
      // A FAILED refund is reported at any age. It is not waiting on a clock —
      // it is a refund that was attempted and did not land, so every day it
      // sits is a day nobody knows the customer has not been paid.
      if (p.refund_state === "failed") return true;

      // refund_owed_at is exact (0053). updated_at is the fallback for rows
      // written before that column existed, and it is a PROXY: any later touch
      // to the row resets it, so those refunds read younger than they are. That
      // errs toward under-reporting, which is the wrong direction — but it is
      // bounded to pre-0053 rows and it beats not checking them at all.
      const stamp = p.refund_owed_at ?? p.updated_at;
      if (!stamp) return false;
      const t = new Date(stamp).getTime();
      return Number.isFinite(t) && t < cutoffMs;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const failed = flagged.filter((p: any) => p.refund_state === "failed").length;
    const totalAmount = flagged.reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sum: number, p: any) => sum + Number(p.refund_amount ?? 0),
      0,
    );

    if (flagged.length === 0) {
      return { overdue: 0, failed: 0, totalAmount: 0, alerted: false };
    }

    // ONE message, never one per refund. Every SMS is billed, and a backlog of
    // twenty would otherwise send twenty — exhausting the admin's own per-phone
    // hourly ceiling, which the payout-failure alerts share. The date in the
    // dedupe key gives one alert per day and makes a retry within the day a
    // no-op.
    const failedNote = failed > 0 ? ` ${failed} failed and needs a retry.` : "";
    await notifyAdminOperational({
      key:       `refunds.overdue:${todayInBusinessTz()}`,
      eventType: "refunds.overdue",
      event:     "Refunds overdue",
      details:
        `${flagged.length} refund(s) totalling Rs.${totalAmount.toFixed(2)} ` +
        `owed over ${REFUND_OVERDUE_DAYS} days.${failedNote}`,
      reference: "Open /admin/payments to send them",
    });

    return { overdue: flagged.length, failed, totalAmount, alerted: true };
  } catch (err) {
    console.error(
      "[refunds:overdue] failed",
      err instanceof Error ? err.message : "unknown",
    );
    return null;
  }
}
