// ─────────────────────────────────────────────────────────────────────────────
// app/api/admin/bookings/expire-overdue/route.ts
// POST — cancel booking requests the owner never answered within 48 hours,
// record the customer's refund, and release the dates. Idempotent.
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

/** Runs the sweep and reports it. Shared by both verbs. */
async function run(via: "cron" | "admin") {
  try {
    const summary = await expireOverdueBookingRequests();
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
    const payload = { ok, summary, otpPruned, refundSla };

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
  return run("cron");
}

export async function POST(request: Request) {
  const cronAuthorized = hasValidCronSecret(request);

  let adminAuthorized = false;
  if (!cronAuthorized) {
    const profile = await getProfile();
    adminAuthorized = profile?.role === "admin";
  }

  if (!cronAuthorized && !adminAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return run(cronAuthorized ? "cron" : "admin");
}
