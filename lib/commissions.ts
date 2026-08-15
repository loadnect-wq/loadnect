// ─────────────────────────────────────────────────────────────────────────────
// lib/commissions.ts — Owner-commission workflow (server-only).
//
// This module is the TRUSTED BACKEND for the commission workflow. It runs with
// the service-role admin client and is the ONLY place that:
//   • records an owner's manual UPI payment submission (as a claim, never paid),
//   • lets an admin verify / reject a submission (verify ⇒ commission paid),
//   • runs the overdue sweep + creates the one-time owner settlement adjustment.
//
// CUSTOMER-SAFETY INVARIANT: no function here ever writes to `bookings` or any
// customer record. Unpaid commission is recovered only via an
// `owner_settlement_adjustments` row that reduces the OWNER payout.
//
// IDEMPOTENCY: the adjustment insert relies on the UNIQUE(commission_id)
// constraint on owner_settlement_adjustments — a duplicate is swallowed, so the
// sweep can be run any number of times without double-deducting.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const DEFAULT_DUE_DAYS = 7;

export type OverdueRunSummary = {
  checkedAt:            string;
  dueDaysUsed:         number;
  autoAdjustEnabled:   boolean;
  markedOverdue:       number;
  adjustmentsCreated:  number;
  adjustmentsSkipped:  number; // already existed (idempotent no-op)
  errors:              number;
};

// Statuses that still represent an UNPAID commission (owner hasn't settled).
// A verified 'paid'/'collected'/'paid_out'/'refunded'/'waived'/'adjusted' row is
// NOT swept. 'payment_submitted'/'payment_under_review'/'rejected' are still
// unpaid (a claim isn't payment), so they can go overdue.
const UNPAID_STATUSES = [
  "pending",
  "collected", // legacy: fee collected from customer at booking, owner still owes
  "payment_submitted",
  "payment_under_review",
  "rejected",
  "overdue",
] as const;

/**
 * Runs the overdue-commission sweep. Safe to call repeatedly (idempotent).
 *
 * Step 1 — mark any unpaid commission whose due_date has passed as 'overdue'.
 * Step 2 — if auto-adjustment is enabled, for each overdue commission that does
 *          NOT already have a settlement adjustment, insert ONE
 *          owner_settlement_adjustments row (commission_deduction) and flip the
 *          commission to 'adjusted_from_owner_settlement'.
 *
 * Never touches bookings or customer rows.
 */
export async function runOverdueCommissionCheck(): Promise<OverdueRunSummary> {
  const db = getSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const summary: OverdueRunSummary = {
    checkedAt:           nowIso,
    dueDaysUsed:         DEFAULT_DUE_DAYS,
    autoAdjustEnabled:   false,
    markedOverdue:       0,
    adjustmentsCreated:  0,
    adjustmentsSkipped:  0,
    errors:              0,
  };

  // ── Read platform settings (due days + auto-adjust flag) ──────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settings } = await (db as any)
    .from("platform_settings")
    .select("commission_due_days, enable_auto_commission_adjustment")
    .eq("id", true)
    .maybeSingle();

  summary.dueDaysUsed = Number(settings?.commission_due_days ?? DEFAULT_DUE_DAYS);
  summary.autoAdjustEnabled = Boolean(settings?.enable_auto_commission_adjustment);

  // ── Step 1: mark overdue ──────────────────────────────────────────────────
  // Only rows that are still unpaid AND past their due_date AND not already
  // overdue. due_date is authoritative (set at creation as created_at + N days).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: toMark, error: markSelErr } = await (db as any)
    .from("commissions")
    .select("id")
    .lt("due_date", nowIso)
    .in("status", ["pending", "collected", "payment_submitted", "payment_under_review", "rejected"]);

  if (markSelErr) {
    summary.errors += 1;
    return summary;
  }

  const overdueIds: string[] = (toMark ?? []).map((r: { id: string }) => r.id);

  if (overdueIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: markErr, count } = await (db as any)
      .from("commissions")
      .update({ status: "overdue" }, { count: "exact" })
      .in("id", overdueIds);

    if (markErr) summary.errors += 1;
    else summary.markedOverdue = count ?? overdueIds.length;
  }

  // ── Step 2: create settlement adjustments (only if enabled) ───────────────
  if (!summary.autoAdjustEnabled) {
    return summary;
  }

  // All commissions currently overdue (freshly marked + any previously marked
  // that never got adjusted, e.g. a prior run before auto-adjust was enabled).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: overdueRows, error: overdueSelErr } = await (db as any)
    .from("commissions")
    .select("id, booking_id, hall_owner_id, commission_amount, settlement_adjustment_status")
    .eq("status", "overdue");

  if (overdueSelErr) {
    summary.errors += 1;
    return summary;
  }

  for (const c of overdueRows ?? []) {
    // Guard 1: skip if already marked adjusted at the commission level.
    if (c.settlement_adjustment_status === "adjusted") {
      summary.adjustmentsSkipped += 1;
      continue;
    }

    // Guard 2 (hard idempotency): commission_id is UNIQUE on the adjustments
    // table, so this insert either succeeds once or fails with 23505 forever.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insErr } = await (db as any)
      .from("owner_settlement_adjustments")
      .insert({
        owner_id:        c.hall_owner_id,
        booking_id:      c.booking_id,
        commission_id:   c.id,
        adjustment_type: "commission_deduction",
        amount:          c.commission_amount,
        reason:
          "Commission was adjusted from owner settlement because payment was not " +
          "completed within the allowed 7-day period.",
        source:          "overdue_commission",
        status:          "applied",
      });

    if (insErr) {
      if (insErr.code === "23505") {
        // Already adjusted on a prior run — idempotent no-op.
        summary.adjustmentsSkipped += 1;
      } else {
        summary.errors += 1;
        continue; // don't flip the commission if the adjustment failed
      }
    } else {
      summary.adjustmentsCreated += 1;
    }

    // Flip the commission to the terminal "recovered from settlement" state.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .from("commissions")
      .update({
        status:                        "adjusted_from_owner_settlement",
        settlement_adjustment_status:  "adjusted",
      })
      .eq("id", c.id);
  }

  return summary;
}

export { UNPAID_STATUSES };
