// ─────────────────────────────────────────────────────────────────────────────
// app/api/admin/bookings/expire-overdue/route.ts
// POST — cancel booking requests the owner never answered within 48 hours,
// record the customer's refund, and release the dates. Idempotent.
//
// It is also the project's ONLY nightly maintenance slot for bookings, so it
// carries the abandoned-checkout cleanup, the OTP retention prune and the
// refund-SLA report as well — see run(). Every run writes one row to
// admin_audit_log, because Hobby keeps runtime logs for about an hour and a
// job whose only trace is a log line cannot be shown to have run at all.
//
// AUTHORIZATION mirrors the commission sweep exactly (either is sufficient):
//   1. a logged-in ADMIN (role checked server-side), or
//   2. a machine caller presenting CRON_SECRET as a bearer token.
// With CRON_SECRET unset the header path is DISABLED — never a blank-secret
// bypass. The route takes no parameters and trusts no request body.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";
import { hasValidCronSecret } from "@/lib/cron-auth";
import { expireOverdueBookingRequests } from "@/lib/booking-expiry";
import { reportOverdueRefunds } from "@/lib/refund-sla";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// See app/api/webhooks/cashfree/route.ts for why this is declared
// explicitly: after() runs inside the route budget, it does not extend it.
export const maxDuration = 60;


/**
 * Discards OTP rate-limit rows older than the longest window the limiter looks
 * back over.
 *
 * Piggy-backed on this daily sweep rather than given its own cron: it is a
 * single DELETE, and adding a second schedule for it would be more moving parts
 * than the job is worth. Deliberately best-effort — a retention tidy-up must
 * never fail the booking expiry, which moves customer money.
 *
 * It matters because otp_attempts is a record of which account verified which
 * phone number, and left alone that becomes a permanent one.
 */
async function pruneOtpAttempts(): Promise<number | null> {
  try {
    const { getSupabaseAdminClient } = await import("@/lib/supabase/admin");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    const { data, error } = await db.rpc("cleanup_otp_attempts");
    if (error) {
      console.error("[otp:prune] failed", error.code, error.message);
      return null;
    }
    return typeof data === "number" ? data : 0;
  } catch (err) {
    console.error("[otp:prune] failed", err instanceof Error ? err.message : "unknown");
    return null;
  }
}

/**
 * Cancels checkouts a customer started and never paid for.
 *
 * cleanup_expired_pending_bookings() has been in the database since migration
 * 0011 and was reachable from exactly ONE place: the on-demand button in
 * /admin/bookings. So it ran when somebody remembered, which is to say almost
 * never — one booking had been sitting in pending_payment since 2026-08-30
 * against an expires_at that lapsed twenty minutes after it was created.
 *
 * It cancels the booking and nothing else, which is correct for this status: a
 * pending_payment booking holds no availability row (applyPaidSideEffects
 * writes those on PAYMENT), and the SWEEP has no refund to make because the
 * raced capture is owned by verifyAndApplyPayment on its own path, described
 * below. Note the careful wording: it is not that no money can exist, only that
 * settling it is not this function's job. That is why this is a bare RPC and
 * not a second expiry pipeline like the one above.
 *
 * IT DOES NOT FOLLOW THAT A SWEPT BOOKING CAN NEVER BE PAID AFTERWARDS, and
 * this comment used to say exactly that — that the Cashfree order carries the
 * booking's own expires_at, so it dies with the hold. Read lib/payments.ts: it
 * does not. gatewayExpiryFor clamps the order expiry to a FLOOR of now + 20
 * minutes, because Cashfree rejects outright any order expiring inside 15
 * minutes. The hold is 20 minutes too (PENDING_PAYMENT_TIMEOUT_MIN), so an
 * order minted the instant the booking is created does expire with it — but one
 * minted partway through the hold outlives it by however long the customer took
 * to reach the payment step. startPaymentForBooking refuses to mint an order at
 * all once expires_at has passed, so that overhang is bounded by the hold
 * length. It is not zero.
 *
 * SO SAY WHAT HAPPENS WHEN THIS SWEEP LOSES THAT RACE, because it can. The
 * customer pays, Cashfree captures, and verifyAndApplyPayment finds its
 * pending_payment → booking_requested update matching zero rows. It re-reads
 * the booking, sees 'cancelled', and takes the orphaned branch: the FULL
 * capture (platform fee included) is stamped refund_state='owed' with the
 * payment left at payment_success — which is what puts the row in the admin
 * refund queue at all.
 *
 * THE CUSTOMER IS CHARGED, AND STAYS CHARGED. Cashfree captured the money and
 * payments.status is left at payment_success, so it sits with Hallnect until an
 * admin refunds it by hand from /admin — there is no automatic return.
 *
 * AND THEY ARE NOT TOLD A REFUND IS COMING. The only message they receive is
 * booking.cancelled. refund.initiated is ADMIN-ONLY by design
 * (lib/notifications/events.ts) because the approved customer template promises
 * the money in 5-7 working days, which is not true while it is still in
 * Hallnect's account; the customer-facing template fires on refund.sent, once
 * the money has actually left. So a customer caught by this race has paid, has
 * no booking, and has been told nothing about their money — which is precisely
 * why the manual step must not be forgotten, and why the sweep must never be
 * made to expire a booking any earlier than the booking's own expires_at.
 *
 * Best-effort like every other step here — see run(). Returns null when the
 * step itself failed, which is deliberately distinct from 0 ("ran, nothing to
 * cancel"): the audit row below has to be able to tell those apart.
 */
async function cancelAbandonedCheckouts(): Promise<number | null> {
  try {
    const { getSupabaseAdminClient } = await import("@/lib/supabase/admin");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    const { data, error } = await db.rpc("cleanup_expired_pending_bookings");
    if (error) {
      console.error("[bookings:cleanup-pending] failed", error.code, error.message);
      return null;
    }
    return typeof data === "number" ? data : 0;
  } catch (err) {
    console.error(
      "[bookings:cleanup-pending] failed",
      err instanceof Error ? err.message : "unknown",
    );
    return null;
  }
}

/**
 * Who set this run going. A cron has nobody behind it; an admin pressing the
 * button does, and is attributed — taken from the SESSION, never from the
 * request, for the same reason lib/audit.ts takes no actor parameter.
 */
type SweepActor =
  | { via: "cron" }
  | { via: "admin"; id: string; email: string | null };

/**
 * Writes ONE durable row per run into admin_audit_log.
 *
 * WHY A TABLE AND NOT THE LOG LINE ABOVE. Vercel's Hobby plan keeps runtime
 * logs for about an hour, so a sweep that quietly started failing — or stopped
 * being invoked at all — left nothing anybody could find the next morning. It
 * had to be reconstructed from the state of the bookings themselves. A row per
 * run puts both failures and ABSENCES in /admin/audit-logs: a bad night shows
 * as a row saying so, and a missing night shows as a gap in the dates.
 *
 * SERVICE ROLE ON PURPOSE. admin_audit_log's INSERT policy is
 * (is_admin() OR is_trusted_backend()), and the cron path has no session to
 * satisfy either — which is also why lib/audit.ts cannot be reused here: it
 * reads the actor from the session and returns early when there is none. The
 * admin client bypasses RLS, which is what a scheduled job needs and why it is
 * confined to trusted server code.
 *
 * NEVER THROWS AND NEVER CHANGES THE RESPONSE. A sweep that cancelled bookings
 * and recorded refunds must not be reported as failed because the write
 * recording it hiccuped — that turns the observability into the outage.
 */
async function recordSweepRun(
  actor: SweepActor,
  outcome: { ok: boolean; reason: string; metadata: Record<string, unknown> },
): Promise<void> {
  try {
    const { getSupabaseAdminClient } = await import("@/lib/supabase/admin");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;

    const { error } = await db.from("admin_audit_log").insert({
      actor_id:    actor.via === "admin" ? actor.id : null,
      actor_email: actor.via === "admin" ? actor.email : null,
      action:      "cron.expire_overdue",
      // No single row is the subject — the run is. entity_id stays null rather
      // than naming one arbitrary booking out of the batch.
      entity_type: "cron",
      new_status:  outcome.ok ? "ok" : "failed",
      // The audit page renders `reason` but not `metadata`, so the summary has
      // to be legible here; the counts are repeated in metadata for anyone
      // querying the table. The column's CHECK caps it at 1000 characters.
      reason:      outcome.reason.slice(0, 1000),
      metadata:    { via: actor.via, ...outcome.metadata },
    });

    if (error) {
      console.error(
        "[bookings:expire-overdue] audit write failed",
        error.code,
        error.message,
      );
    }
  } catch (err) {
    console.error(
      "[bookings:expire-overdue] audit write failed",
      err instanceof Error ? err.message : "unknown",
    );
  }
}

/** null means the step failed; a number means it ran. See cancelAbandonedCheckouts. */
function stepResult(n: number | null): string {
  return n === null ? "failed" : String(n);
}

/** Runs the sweep and reports it. Shared by both verbs. */
async function run(actor: SweepActor) {
  const via = actor.via;
  try {
    const summary = await expireOverdueBookingRequests();

    // Each step swallows its own failure, so one failing step is RECORDED and
    // the rest still run. That isolation is load-bearing here: these are
    // unrelated jobs sharing one schedule only because the Hobby plan caps this
    // project at two crons, so letting one throw would silently retire jobs
    // nobody chose to retire — and it would do so on the night they first broke.
    const pendingCancelled = await cancelAbandonedCheckouts();
    const otpPruned = await pruneOtpAttempts();

    // The overdue-refund report runs LAST, and deliberately so: the sweep above
    // cancels unanswered bookings and records their refunds, so running the
    // report after it means this morning's new refunds are counted in this
    // morning's report rather than waiting a day to be noticed.
    //
    // Piggy-backed here rather than given its own schedule — the same reasoning
    // as pruneOtpAttempts above, plus a hard constraint: this project is on the
    // Vercel Hobby plan, which caps it at TWO cron jobs, and vercel.json already
    // holds exactly two. A third entry is rejected at BUILD time, so adding one
    // would not add a report, it would fail the deployment.
    const refundSla = await reportOverdueRefunds();

    // ok REFLECTS WHAT HAPPENED TO THE ROWS, not merely that the function
    // returned. This reported ok:true even when every booking it touched
    // failed, because the summary's per-row error list was never consulted —
    // so a run that cancelled nothing and recorded no refunds looked, to a cron
    // dashboard and to anyone reading the response, exactly like a quiet night.
    //
    // These rows are customers owed money. A sweep that silently fails on all
    // of them is the case most worth surfacing, so it is logged at error level
    // and answered with 500: a monitored cron retries a 500 and ignores a 200.
    const failures = summary.errors ?? [];
    const ok = failures.length === 0;
    const payload = { ok, summary, pendingCancelled, otpPruned, refundSla };

    // The tidy-up steps deliberately do NOT feed `ok`: it drives the status
    // code, and a failed OTP prune is not worth making a monitored cron retry a
    // refund sweep for. They are carried by the audit row instead, where a
    // failed step reads "failed" rather than disappearing into a 200.
    await recordSweepRun(actor, {
      ok,
      reason:
        `Expired ${summary.expired} of ${summary.found} unanswered request(s), ` +
        `${summary.refundsRecorded} refund(s) recorded. ` +
        `Abandoned checkouts cancelled: ${stepResult(pendingCancelled)}. ` +
        `OTP rows pruned: ${stepResult(otpPruned)}. ` +
        `Refunds past SLA: ${refundSla ? refundSla.overdue : "failed"}.` +
        (failures.length > 0 ? ` ${failures.length} booking(s) failed.` : ""),
      metadata: payload,
    });

    if (ok) {
      console.info("[bookings:expire-overdue]", JSON.stringify({ via, ...payload }));
      return NextResponse.json(payload);
    }

    console.error(
      "[bookings:expire-overdue] completed with failures",
      JSON.stringify({ via, ...payload }),
    );
    return NextResponse.json(payload, { status: 500 });
  } catch (err) {
    console.error("[bookings:expire-overdue] failed", err);
    // A run that died before finishing is exactly the run worth a durable
    // record, so the audit write happens on this path too. It is awaited: the
    // response ends the invocation, and work left unawaited after it may never
    // be executed.
    await recordSweepRun(actor, {
      ok: false,
      reason: `Sweep threw before completing: ${err instanceof Error ? err.message : "unknown"}`,
      metadata: { fatal: true },
    });
    return NextResponse.json({ error: "Expiry sweep failed" }, { status: 500 });
  }
}

/**
 * Vercel Cron. GET is SECRET-ONLY on purpose — see lib/cron-auth.ts. This
 * endpoint cancels bookings and issues refunds, so accepting a session here
 * would let any page an admin visits trigger it with an <img> tag.
 */
export async function GET(request: Request) {
  if (!hasValidCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run({ via: "cron" });
}

export async function POST(request: Request) {
  // Unchanged authorization, written as an early return so the admin's identity
  // survives the check: the audit row records WHO pressed the button, and a
  // boolean `adminAuthorized` had already thrown that away by this point.
  if (hasValidCronSecret(request)) return run({ via: "cron" });

  const profile = await getProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return run({ via: "admin", id: profile.id, email: profile.email });
}
