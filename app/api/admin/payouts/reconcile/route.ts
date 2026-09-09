// ─────────────────────────────────────────────────────────────────────────────
// app/api/admin/payouts/reconcile/route.ts
// POST — ask Cashfree what happened to every transfer that is not yet final.
//
// THIS ROUTE NOW HAS ITS OWN SCHEDULE: every 15 minutes, in vercel.json, at
// :05/:20/:35/:50 — deliberately OFF the :30 boundary, because the booking
// sweep runs at 30 3,7,11 and still calls reconcileOpenPayouts() as a backstop.
// A shared minute meant two concurrent sweeps racing on payments.split_status.
//
// It did not, for a plan reason that no longer applies. Vercel Hobby capped the
// project at TWO cron jobs and vercel.json already held two, so a third entry
// failed the BUILD; the nightly booking sweep called reconcileOpenPayouts()
// inline instead. The team is on Pro as of 2026-09-09, which lifts both the
// count and the once-per-day interval, so reconciliation runs on its own clock.
//
// Why that mattered: an owner payout dispatched just after the nightly slot sat
// unreconciled for nearly 24 hours, and payments.split_status reads 'in_flight'
// throughout — which is exactly what issueRefund refuses to act on. So a slow
// owner payout froze a CUSTOMER's refund for up to a day. It is now ~15 minutes.
//
// The inline call in the booking sweep is deliberately KEPT as a backstop:
// Vercel documents cron delivery as best-effort with no retry, and an Instant
// Rollback does not update active cron jobs.
//
// WHY IT NEEDS TO RUN AT ALL, on a schedule or otherwise. A Cashfree
// Payouts transfer is asynchronous by definition: RECEIVED, QUEUED and PENDING
// are the normal path, SCHEDULED_FOR_NEXT_WORKINGDAY is a documented PENDING
// code, and NEFT does not run on Sundays. So a transfer dispatched on Saturday
// evening is genuinely unresolved until Monday, and the owner's screen and the
// refund interlock both depend on knowing which way it went.
//
// It is also the recovery path for a dispatch that died mid-flight. The
// owner_payouts row is written BEFORE the HTTP call precisely so that this job
// can ask about a transfer nobody is sure was ever sent — Cashfree's own
// guidance on a 5XX is "do not initiate another transaction, check the status".
//
// AUTHORIZATION mirrors the other maintenance routes exactly, and the two verbs
// differ on purpose (see lib/cron-auth.ts):
//
//   • GET  → CRON_SECRET ONLY. It mutates payments.split_status, and a browser
//            never attaches an Authorization header cross-origin, so there is
//            nothing for an `<img src>` to forge.
//   • POST → the secret OR a logged-in admin, for the on-demand button.
//
// With CRON_SECRET unset the header path is DISABLED — never a blank-secret
// bypass. Takes no parameters and trusts no request body.
//
// READ-ONLY AGAINST CASHFREE. It sends no money and can never send money; the
// only writes are to our own record of what Cashfree reported. That is what
// makes it safe to run on a schedule and safe to retry.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";
import { hasValidCronSecret } from "@/lib/cron-auth";
import { reconcileOpenPayouts } from "@/lib/payout-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 300s, not the old 60. A sweep is up to 50 sequential Cashfree status calls,
// each allowed 20 seconds (lib/cashfree-payouts.ts), so three slow ones used to
// exhaust the whole budget and the run was killed mid-sweep.
//
// 60 was NOT a plan ceiling — that was wrong when first written here. Fluid
// compute defaults to 300s on Hobby AND Pro; Pro's maximum is 800s. So 60 was
// a self-imposed value nobody had revisited. 300 is the plan default and is
// deliberately kept well under the 15-minute interval so runs cannot overlap —
// 800 would allow exactly that, which is why it is not used.
export const maxDuration = 300;

export async function POST(request: Request) {
  const viaCron = hasValidCronSecret(request);
  if (!viaCron) {
    const profile = await getProfile();
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Not authorised" }, { status: 401 });
    }
  }

  try {
    const summary = await reconcileOpenPayouts(50);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    // Loud, and a non-200, because a reconcile that silently does nothing is
    // indistinguishable from one that found nothing to do — and the difference
    // is whether anybody knows a transfer is unresolved.
    console.error("[payouts-reconcile] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Reconciliation failed" }, { status: 500 });
  }
}

/**
 * Vercel Cron. SECRET-ONLY, like the other scheduled sweeps — see
 * lib/cron-auth.ts. This GET now mutates (payments.split_status), so a session
 * must never authorize it: an `<img src="…/reconcile">` on any page an admin
 * visits would otherwise fire it.
 *
 * THIS USED TO BE A STUB that returned `{ok:true}` and reconciled nothing —
 * fine while nothing scheduled it, and a trap the moment anything did, because
 * Vercel Cron invokes with GET. Pointing a cron at the old handler would have
 * produced a green dashboard, a 200 in the logs, and no reconciliation at all,
 * forever. A job that cannot fail visibly is worse than no job.
 */
export async function GET(request: Request) {
  if (!hasValidCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await reconcileOpenPayouts(50);
    await recordReconcileRun(summary);
    console.info("[payouts-reconcile]", JSON.stringify({ via: "cron", ...summary }));
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    console.error("[payouts-reconcile] failed:", e instanceof Error ? e.message : e);
    await recordReconcileRun({ checked: 0, settled: 0, errors: 1 }, e);
    return NextResponse.json({ error: "Reconciliation failed" }, { status: 500 });
  }
}

/**
 * An audit row when something CHANGED — plus a daily heartbeat when it did not.
 *
 * Two mistakes were possible here and both were made on the way to this:
 *
 * 1. WRITING ONLY WHEN THERE WAS WORK. Useless exactly when it matters most: at
 *    launch there are no bookings and no payouts, so every run finds nothing,
 *    the condition never fires, and the audit log stays empty. An empty log then
 *    means, indistinguishably — the cron never ran, it ran and got a 401 because
 *    CRON_SECRET is unset, it ran and found nothing, or the path 404s. A job
 *    whose health cannot be told from its silence is not monitored at all.
 *    Hence the heartbeat.
 *
 * 2. WRITING WHENEVER ROWS WERE MERELY CHECKED. `checked > 0` looks like the
 *    obvious condition and is far too loud. Rows stay in the sweep for 48h past
 *    settlement, so a single payout makes ~192 consecutive runs "checked > 0",
 *    at up to 96 rows a day — and admin_audit_log is APPEND-ONLY
 *    (guard_audit_log_immutable, a BEFORE UPDATE OR DELETE trigger, with no
 *    DELETE policy), so every one of those is permanent. /admin/audit-logs
 *    paginates at 50 and its entity filter had no "cron" entry, so that chatter
 *    would push a real hall approval or user suspension off page one within the
 *    hour — in the table that exists specifically to make privileged HUMAN
 *    actions visible.
 *
 * So the condition is a STATE CHANGE, not activity: a transfer settled, or
 * something errored. Asking Cashfree about three still-pending transfers and
 * being told they are still pending is not an audit event. Steady state is
 * therefore about one row a day, plus a row whenever money actually moved or
 * something broke.
 *
 * Never throws and never changes the response: an audit write is a record of
 * the work, not part of it.
 */
async function recordReconcileRun(
  summary: { checked: number; settled: number; errors: number },
  thrown?: unknown,
): Promise<void> {
  const didWork = summary.settled > 0 || summary.errors > 0;
  try {
    const { getSupabaseAdminClient } = await import("@/lib/supabase/admin");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;

    if (!didWork) {
      // 23h, not 24h: a 24h window against a job that runs on a fixed clock
      // would drift into skipping a day entirely.
      const since = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
      const { data: recent, error: readErr } = await db.from("admin_audit_log")
        .select("id")
        .eq("action", "cron.payouts_reconcile")
        .gte("created_at", since)
        .limit(1);
      // On a read error, WRITE. A duplicate heartbeat is noise; a skipped one
      // is a gap that reads as a dead cron.
      if (!readErr && recent && recent.length > 0) return;
    }

    const { error } = await db.from("admin_audit_log").insert({
      actor_id:    null,
      actor_email: null,
      action:      "cron.payouts_reconcile",
      entity_type: "cron",
      new_status:  summary.errors > 0 ? "failed" : "ok",
      reason: didWork
        ? `Checked ${summary.checked} open transfer(s), ${summary.settled} settled, ` +
          `${summary.errors} error(s).` +
          (thrown ? ` Threw: ${thrown instanceof Error ? thrown.message : String(thrown)}` : "")
        : summary.checked > 0
          ? `Heartbeat: ran, ${summary.checked} transfer(s) still open, nothing changed.`
          : "Heartbeat: ran, no open transfers to reconcile.",
      metadata:    { via: "cron", heartbeat: !didWork, ...summary },
    });
    if (error) console.error("[payouts-reconcile] audit write failed", error.code, error.message);
  } catch (e) {
    console.error("[payouts-reconcile] audit write threw:", e instanceof Error ? e.message : e);
  }
}
