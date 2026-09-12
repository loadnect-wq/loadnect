// ─────────────────────────────────────────────────────────────────────────────
// lib/auth/actor-key.ts — a stable, non-reversible label for a signed-OUT
// caller. SERVER-ONLY.
//
// Sign-in by mobile is the first endpoint in Hallnect that SENDS A BILLED SMS
// TO AN ARBITRARY NUMBER FOR SOMEBODY WITH NO ACCOUNT. Every per-actor ceiling
// in lib/otp-guard.ts keys on a user id, and there isn't one yet, so this
// supplies the substitute that migration 0087 made room for in
// otp_attempts.actor_key.
//
// NEVER THE ADDRESS ITSELF. An IP is personal data, the attempts table is read
// by support tooling, and rate limiting only ever needs "same caller or not" —
// which a keyed hash answers identically. Same construction as
// contact_messages.sender_bucket, deliberately, so there is one idea here and
// not two.
//
// THIS IS NOT AN IDENTITY. An address is shed by changing network, and nothing
// here pretends otherwise. It raises the cost of walking a list of strangers'
// numbers and bounds one caller's blast radius. The ceilings an attacker cannot
// shed — 10 sends/day per PHONE and the fail-closed 300/day global fuse — are
// the real backstop and are shared with the signed-in flows.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { createHash, createHmac } from "node:crypto";
import { headers } from "next/headers";

/**
 * The HMAC key that makes the hash non-reversible.
 *
 * IPv4 has about four billion values, so an UNSALTED hash of an address is
 * brute-forced in seconds: it would store the address while looking like it did
 * not. A key is therefore mandatory, not a nicety.
 *
 * OTP_ACTOR_SALT is preferred and should be set. When it is absent this derives
 * one from SUPABASE_SERVICE_ROLE_KEY instead of failing, and that choice is
 * deliberate: this code path already cannot run without the service-role key
 * (lib/otp-guard.ts reaches the database through it), so the fallback adds no
 * new deployment dependency and cannot be missing when the rest works. Deriving
 * through HMAC means the key itself is never recoverable from a stored value.
 *
 * A DIFFERENT PEPPER PER PURPOSE. This is not the contact form's salt, so the
 * same visitor's contact-form bucket and OTP actor key cannot be correlated by
 * anyone who sees both tables.
 */
function pepper(): string {
  const explicit = (process.env.OTP_ACTOR_SALT ?? "").trim();
  if (explicit) return explicit;

  const derived = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (derived) {
    return createHmac("sha256", derived).update("hallnect:otp-actor:v1").digest("hex");
  }
  return "";
}

/**
 * Callers with NO usable client address all share this one bucket.
 *
 * The alternative was refusing them outright, which breaks local development
 * (no proxy sets a forwarded-for header) and any non-browser client. Sharing a
 * single heavily-contended bucket is the safer failure: such callers are metered
 * TOGETHER rather than each getting a private allowance, so an attacker gains
 * nothing by stripping headers — they land in the most crowded bucket there is.
 */
const SHARED_UNKNOWN = "unknown-client";

/**
 * A stable label for the current signed-out caller.
 *
 * x-vercel-forwarded-for FIRST because on Vercel the platform sets it and a
 * client cannot forge it. x-forwarded-for is client-APPENDABLE, so its leftmost
 * entry is attacker-controlled: trusting it would let one caller mint a fresh
 * actor key per request and walk straight through every per-actor ceiling. It
 * is read only as a fallback for non-Vercel hosting.
 */
export async function clientActorKey(): Promise<string> {
  const key = pepper();

  let ip = "";
  try {
    const h = await headers();
    const raw =
      h.get("x-vercel-forwarded-for") ??
      h.get("x-forwarded-for") ??
      h.get("x-real-ip") ??
      "";
    ip = raw.split(",")[0]?.trim() ?? "";
  } catch {
    ip = "";
  }

  if (!ip) return SHARED_UNKNOWN;

  // With no pepper available at all the honest thing is to stop pretending the
  // value is pseudonymous and put every caller in the shared bucket, rather
  // than write a reversible hash of an address into the database.
  if (!key) return SHARED_UNKNOWN;

  return createHash("sha256").update(`${key}|${ip}`).digest("hex").slice(0, 32);
}
