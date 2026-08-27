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
