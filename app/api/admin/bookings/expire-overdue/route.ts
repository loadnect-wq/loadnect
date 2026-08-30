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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    console.info("[bookings:expire-overdue]", JSON.stringify({ via, ...summary, otpPruned }));
    return NextResponse.json({ ok: true, summary, otpPruned });
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
