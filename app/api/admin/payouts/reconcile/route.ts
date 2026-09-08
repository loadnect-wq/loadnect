// ─────────────────────────────────────────────────────────────────────────────
// app/api/admin/payouts/reconcile/route.ts
// POST — ask Cashfree what happened to every transfer that is not yet final.
//
// THE SCHEDULE LIVES ELSEWHERE, and this header used to claim otherwise. Vercel
// Hobby caps this project at TWO cron jobs and vercel.json already holds two, so
// a third entry fails the BUILD. The nightly sweep in
// app/api/admin/bookings/expire-overdue therefore calls reconcileOpenPayouts()
// directly, alongside the other jobs piggy-backed on that slot. This route is
// the ON-DEMAND path: an admin, or a real scheduler if one is ever added.
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
// AUTHORIZATION mirrors the other maintenance routes exactly (either is
// sufficient): a logged-in ADMIN, or a machine presenting CRON_SECRET as a
// bearer token. With CRON_SECRET unset the header path is DISABLED — never a
// blank-secret bypass. Takes no parameters and trusts no request body.
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
export const maxDuration = 60;

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

/** GET exists so the URL can be pasted into a scheduler and checked. It
 *  reconciles nothing and reveals nothing. */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "payouts-reconcile" });
}
