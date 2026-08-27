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
import { timingSafeEqual } from "node:crypto";
import { getProfile } from "@/lib/auth";
import { expireOverdueBookingRequests } from "@/lib/booking-expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const cronAuthorized = hasValidCronSecret(request);

  let adminAuthorized = false;
  if (!cronAuthorized) {
    const profile = await getProfile();
    adminAuthorized = profile?.role === "admin";
  }

  if (!cronAuthorized && !adminAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await expireOverdueBookingRequests();
    console.info(
      "[bookings:expire-overdue]",
      JSON.stringify({ via: cronAuthorized ? "cron" : "admin", ...summary }),
    );
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[bookings:expire-overdue] failed", err);
    return NextResponse.json({ error: "Expiry sweep failed" }, { status: 500 });
  }
}
