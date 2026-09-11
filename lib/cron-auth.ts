// ─────────────────────────────────────────────────────────────────────────────
// lib/cron-auth.ts — shared authorization for scheduled maintenance routes.
// SERVER-ONLY.
//
// Vercel Cron invokes a path with a GET and, when CRON_SECRET is set on the
// project, adds `Authorization: Bearer <CRON_SECRET>` itself. These helpers are
// the only thing those routes trust.
//
// WHY GET AND POST ARE AUTHORIZED DIFFERENTLY. Both sweeps mutate data —
// cancelling bookings, issuing refunds, adjusting settlements. A GET that
// mutates is reachable by CSRF: an admin merely visiting a page containing
// `<img src="https://hallnect.com/api/admin/...">` would fire it. So:
//
//   • GET  → the CRON SECRET ONLY. A browser never attaches an Authorization
//            header cross-origin, so there is nothing to forge.
//   • POST → secret OR an admin session, as before. A cross-origin POST cannot
//            be silently issued with credentials the way an image load can.
//
// With CRON_SECRET unset the header path is DISABLED entirely — an empty or
// missing secret must never become a blank-token bypass.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { timingSafeEqual } from "node:crypto";
import { getProfile } from "@/lib/auth";

/** Constant-time bearer check against CRON_SECRET. False when the secret is
 *  unset, so a project without one simply has no machine access. */
export function hasValidCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.trim() === "") return false;

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token === "") return false;

  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  // Compare lengths first: timingSafeEqual throws on a mismatch, and the
  // length of a secret is not the part worth hiding.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Is this request coming from our own site?
 *
 * Judged from Sec-Fetch-Site where the browser sends it — it is the browser's
 * own assertion and script cannot set it — falling back to comparing Origin
 * against the request URL's origin. A request with NEITHER header is allowed:
 * that is a non-browser client, which cannot be CSRF'd, and refusing it would
 * break curl and the platform's own callers.
 */
export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "same-site" || site === "none";

  const origin = request.headers.get("origin");
  if (!origin) return true;  // no browser context to forge from
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/**
 * The admin-session half of a maintenance POST: a real, ACTIVE admin, asking
 * from our own site. Returns the profile, or null to refuse.
 *
 * TWO THINGS ALL FOUR MAINTENANCE ROUTES GOT WRONG, each in its own way.
 *
 * 1. is_active WAS NEVER CHECKED. Every route tested `profile?.role === "admin"`
 *    and nothing else. requireAuth() is what enforces suspension, and these are
 *    route handlers — they never call it. So a suspended admin kept the sweeps
 *    for as long as their access token lived. Narrow today, because the user
 *    list refuses to suspend an admin and therefore none exists; closed here
 *    because that refusal is a screen's rule, not an invariant.
 *
 * 2. ORIGIN IS NOW CHECKED, as defence in depth and NOT as the primary control.
 *    The header comment above is right that a cross-origin POST is far weaker
 *    than an image load, and the actual reason belongs written down: the
 *    Supabase session cookies are SameSite=Lax, and Lax does not attach cookies
 *    to a cross-site POST at all, so a forged form already arrives with no
 *    session and dies at getProfile(). This adds a second, explicit refusal
 *    that does not depend on a cookie attribute set in another module staying
 *    as it is.
 */
export async function maintenanceAdmin(
  request: Request,
): Promise<{ id: string; email: string | null } | null> {
  if (!isSameOriginRequest(request)) return null;
  const profile = await getProfile();
  if (!profile || profile.role !== "admin" || profile.is_active === false) return null;
  return { id: profile.id, email: profile.email ?? null };
}
