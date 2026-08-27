// ─────────────────────────────────────────────────────────────────────────────
// app/api/admin/premium/expire-listings/route.ts
// Retire premium/pro listings whose paid window has closed, and clear any
// hall still carrying a tier without a live listing behind it. Idempotent.
//
// WHY THIS EXISTS: recompute_hall_premium() only ever ran as a reaction to a
// WRITE on premium_listings, and nothing was scheduled. Once end_date passed,
// halls.premium_tier stayed set forever — search ranking, the ?category=premium
// filter and the Pro/Premium badges all kept promoting a hall whose plan had
// lapsed, while the admin table correctly showed it as "Expired".
//
// AUTHORIZATION mirrors the booking-expiry sweep exactly (either is sufficient):
//   1. a logged-in ADMIN (role checked server-side), or
//   2. a machine caller presenting CRON_SECRET as a bearer token.
// With CRON_SECRET unset the header path is DISABLED — never a blank-secret
// bypass. The route takes no parameters and trusts no request body.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";
import { hasValidCronSecret } from "@/lib/cron-auth";
import { expirePremiumListings } from "@/lib/premium-expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Runs the sweep and reports it. Shared by both verbs. */
async function run(via: "cron" | "admin") {
  try {
    const summary = await expirePremiumListings();
    console.info("[premium:expire-listings]", JSON.stringify({ via, ...summary }));
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[premium:expire-listings] failed", err);
    return NextResponse.json({ error: "Premium expiry sweep failed" }, { status: 500 });
  }
}

/**
 * Vercel Cron. GET is SECRET-ONLY on purpose — see lib/cron-auth.ts. This
 * endpoint removes paid-for promotion from listings, so accepting a session
 * here would let any page an admin visits trigger it with an <img> tag.
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
