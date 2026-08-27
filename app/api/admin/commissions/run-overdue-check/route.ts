// ─────────────────────────────────────────────────────────────────────────────
// app/api/admin/commissions/run-overdue-check/route.ts
// POST — run the overdue-commission sweep (mark overdue + one-time owner
// settlement adjustment). Idempotent; safe to run repeatedly.
//
// AUTHORIZATION (either is sufficient):
//   1. A logged-in ADMIN (session role checked server-side), OR
//   2. A machine caller (Vercel Cron / curl) presenting the shared secret in
//      the `Authorization: Bearer <CRON_SECRET>` header (constant-time compare).
//
// If CRON_SECRET is not set, the header path is DISABLED (never a blank-secret
// bypass) — only an admin session works. This route never trusts the request
// body and takes no parameters. See docs/SCHEDULED_JOBS.md.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";
import { hasValidCronSecret } from "@/lib/cron-auth";
import { runOverdueCommissionCheck } from "@/lib/commissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Runs the sweep and reports it. Shared by both verbs. */
async function run(via: "cron" | "admin") {
  try {
    const summary = await runOverdueCommissionCheck();
    console.info("[commissions:run-overdue-check]", JSON.stringify({ via, ...summary }));
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[commissions:run-overdue-check] failed", err);
    // Never leak internal error details to the caller.
    return NextResponse.json({ error: "Overdue check failed" }, { status: 500 });
  }
}

/**
 * Vercel Cron. GET is SECRET-ONLY on purpose — see lib/cron-auth.ts. This
 * sweep deducts money from owner settlements, so accepting a session here
 * would let any page an admin visits trigger it with an <img> tag.
 */
export async function GET(request: Request) {
  if (!hasValidCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run("cron");
}

export async function POST(request: Request) {
  // Path 2: machine caller with the shared secret.
  const cronAuthorized = hasValidCronSecret(request);

  // Path 1: logged-in admin session.
  let adminAuthorized = false;
  if (!cronAuthorized) {
    const profile = await getProfile();
    adminAuthorized = profile?.role === "admin";
  }

  if (!cronAuthorized && !adminAuthorized) {
    // Same generic 401 for both "not logged in" and "not an admin" — no info leak.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return run(cronAuthorized ? "cron" : "admin");
}
