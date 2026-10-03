// ─────────────────────────────────────────────────────────────────────────────
// app/api/admin/date-alerts/send/route.ts
// Turns freed dates into browser notifications (0108, lib/date-alerts.server.ts),
// and deletes alerts whose date has passed. Idempotent: events are claimed
// before they are sent, and each browser hears about each hall once.
//
// AUTHORIZATION mirrors the other sweeps exactly (either is sufficient):
//   1. a logged-in ADMIN (role checked server-side), or
//   2. a machine caller presenting CRON_SECRET as a bearer token.
// With CRON_SECRET unset the header path is DISABLED — never a blank-secret
// bypass. The route takes no parameters and trusts no request body.
//
// GET DOES THE WORK. Vercel Cron calls GET, and a GET that only reported
// health would schedule a green, empty job forever (see payouts/reconcile's
// history).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { hasValidCronSecret, maintenanceAdmin } from "@/lib/cron-auth";
import { processDateAlerts } from "@/lib/date-alerts.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fifty events a run, each a handful of reads and at most a few pushes. A run
// must finish well inside its ten-minute interval.
export const maxDuration = 120;

async function run(via: "cron" | "admin") {
  try {
    const summary = await processDateAlerts();
    console.info("[date-alerts:send]", JSON.stringify({ via, ...summary }));
    if (summary.errors > 0) {
      return NextResponse.json({ ok: false, summary }, { status: 500 });
    }
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[date-alerts:send] failed", err);
    return NextResponse.json({ error: "Date alert sweep failed" }, { status: 500 });
  }
}

/** Vercel Cron. Secret-only, so no page an admin visits can fire it. */
export async function GET(request: Request) {
  if (!hasValidCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run("cron");
}

export async function POST(request: Request) {
  const cronAuthorized = hasValidCronSecret(request);
  if (!cronAuthorized && !(await maintenanceAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run(cronAuthorized ? "cron" : "admin");
}
