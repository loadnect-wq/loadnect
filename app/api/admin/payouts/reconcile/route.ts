// ─────────────────────────────────────────────────────────────────────────────
// app/api/admin/payouts/reconcile/route.ts
// POST — ask Cashfree what happened to every transfer that is not yet final.
//
// THIS ROUTE NOW HAS ITS OWN SCHEDULE: every 15 minutes, in vercel.json.
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
// exhaust the whole budget and the run was killed mid-sweep. 60 was the Hobby
// ceiling, not a considered value; 300 is the plan default on Pro. Still far
// below the 15-minute interval, so runs cannot overlap.
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
 * An audit row when the run did something — plus a DAILY HEARTBEAT when it did
 * not.
 *
 * The heartbeat is the whole point, and leaving it out was a real mistake.
 * Writing a row only when `checked > 0` sounds tidy and is useless exactly when
 * it matters most: at launch there are no bookings and no payouts, so every run
 * finds nothing, the condition never fires, and the audit log stays empty. An
 * empty log then means, indistinguishably — the cron never ran, the cron ran and
 * got a 401 because CRON_SECRET is unset, the cron ran and found nothing, or
 * the path 404s. That is not a monitoring signal, it is the absence of one, and
 * a job whose health cannot be told from its silence is not monitored at all.
 *
 * So: a row whenever there was work or an error, and otherwise at most one row
 * per 23 hours saying "ran, nothing open". Quiet days cost one row; busy ones
 * are recorded as they happen; 96 rows a day never happens.
 *
 * Never throws and never changes the response: an audit write is a record of
 * the work, not part of it.
 */
async function recordReconcileRun(
  summary: { checked: number; settled: number; errors: number },
  thrown?: unknown,
): Promise<void> {
  const didWork = summary.checked > 0 || summary.errors > 0;
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
        : "Heartbeat: ran, no open transfers to reconcile.",
      metadata:    { via: "cron", heartbeat: !didWork, ...summary },
    });
    if (error) console.error("[payouts-reconcile] audit write failed", error.code, error.message);
  } catch (e) {
    console.error("[payouts-reconcile] audit write threw:", e instanceof Error ? e.message : e);
  }
}
