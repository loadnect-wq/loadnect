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
// body and takes no parameters. See docs/COMMISSION_CRON_SETUP.md.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getProfile } from "@/lib/auth";
import { runOverdueCommissionCheck } from "@/lib/commissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant-time bearer-token check against CRON_SECRET. Returns false when the
 *  secret is unset (no accidental empty-secret bypass) or the token mismatches. */
function hasValidCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.trim() === "") return false;

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token === "") return false;

  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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

  try {
    const summary = await runOverdueCommissionCheck();
    console.info(
      "[commissions:run-overdue-check]",
      JSON.stringify({ via: cronAuthorized ? "cron" : "admin", ...summary }),
    );
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[commissions:run-overdue-check] failed", err);
    // Never leak internal error details to the caller.
    return NextResponse.json({ error: "Overdue check failed" }, { status: 500 });
  }
}
