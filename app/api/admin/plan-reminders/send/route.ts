// ─────────────────────────────────────────────────────────────────────────────
// app/api/admin/plan-reminders/send/route.ts
// The morning event-plan reminders (0116, lib/plan-reminders.server.ts).
// Scheduled twice (vercel.json): about 9:15 AM India time, and again at 11:15
// to retry anything that failed. A phone hears about a plan at most once a day:
// each send is claimed before it goes out.
//
// AUTHORIZATION mirrors the other sweeps exactly (either is sufficient):
//   1. a logged-in ADMIN (role checked server-side), or
//   2. a machine caller presenting CRON_SECRET as a bearer token.
// With CRON_SECRET unset the header path is DISABLED, never a blank-secret
// bypass. The route takes no parameters and trusts no request body.
//
// GET DOES THE WORK. Vercel Cron calls GET, and a GET that only reported
// health would schedule a green, empty job forever.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { hasValidCronSecret, maintenanceAdmin } from "@/lib/cron-auth";
import { processPlanReminders } from "@/lib/plan-reminders.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function run(via: "cron" | "admin") {
  try {
    const summary = await processPlanReminders();
    console.info("[plan-reminders:send]", JSON.stringify({ via, ...summary }));
    if (summary.errors > 0) {
      return NextResponse.json({ ok: false, summary }, { status: 500 });
    }
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[plan-reminders:send] failed", err);
    return NextResponse.json({ error: "Plan reminder sweep failed" }, { status: 500 });
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
