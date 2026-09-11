// ─────────────────────────────────────────────────────────────────────────────
// app/api/admin/leads/expire-stale/route.ts
// Retires enquiries time has overtaken: pending ones whose event date has
// passed, and never-verified ones older than the TTL. Idempotent.
//
// WHY THIS EXISTS: migration 0073 declared an 'expired' lead status and nothing
// wrote it. Without a sweep the venue's "To answer" tab fills with weddings
// that already happened — and a queue that never empties stops being read.
//
// AUTHORIZATION mirrors the other three sweeps exactly (either is sufficient):
//   1. a logged-in ADMIN (role checked server-side), or
//   2. a machine caller presenting CRON_SECRET as a bearer token.
// With CRON_SECRET unset the header path is DISABLED — never a blank-secret
// bypass. The route takes no parameters and trusts no request body.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { hasValidCronSecret, maintenanceAdmin } from "@/lib/cron-auth";
import { expireStaleLeads } from "@/lib/lead-expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Declared explicitly: after() runs inside the route budget, it does not
// extend it. This sweep sends nothing, so 60s is generous.
export const maxDuration = 60;

async function run(via: "cron" | "admin") {
  try {
    const summary = await expireStaleLeads();
    console.info("[leads:expire-stale]", JSON.stringify({ via, ...summary }));
    // A partial failure is reported as such rather than as success — the sweep
    // returns an error tally instead of throwing, and a 200 that hid it would
    // make a permanently failing sweep look healthy in the cron log.
    if (summary.errors > 0) {
      return NextResponse.json({ ok: false, summary }, { status: 500 });
    }
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[leads:expire-stale] failed", err);
    return NextResponse.json({ error: "Lead expiry sweep failed" }, { status: 500 });
  }
}

/**
 * Vercel Cron. GET is SECRET-ONLY on purpose — see lib/cron-auth.ts. Accepting
 * a session here would let any page an admin visits trigger a bulk status
 * change with an <img> tag.
 */
export async function GET(request: Request) {
  if (!hasValidCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run("cron");
}

export async function POST(request: Request) {
  const cronAuthorized = hasValidCronSecret(request);

  // maintenanceAdmin also requires an ACTIVE account and a same-origin request;
  // the old check read role alone.
  if (!cronAuthorized && !(await maintenanceAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return run(cronAuthorized ? "cron" : "admin");
}
