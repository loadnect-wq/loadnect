// ─────────────────────────────────────────────────────────────────────────────
// lib/msg91/otp.ts — phone-ownership OTP via MSG91 (SERVER-ONLY).
//
// MSG91 GENERATES, STORES, EXPIRES AND CHECKS THE CODE. This codebase never
// creates an OTP, never stores one, never logs one, and never returns one to a
// browser — the same property the previous provider gave us, kept deliberately.
// The only OTP value that ever enters this process is the one the USER types,
// and it goes straight back out to /otp/verify.
//
// ENDPOINTS (verified against docs.msg91.com, 2026-08-30):
//   send    POST https://control.msg91.com/api/v5/otp?template_id=&mobile=&authkey=
//   verify  GET  https://control.msg91.com/api/v5/otp/verify?otp=&mobile=   (authkey header)
//   resend  GET  https://control.msg91.com/api/v5/otp/retry?authkey=&retrytype=&mobile=
//
// EVERY ONE OF THEM ANSWERS HTTP 200 ON FAILURE. A wrong OTP is
// 200 {"type":"error","message":"OTP not match"}. lib/msg91/client.ts is what
// turns that into ok:false; nothing in this file may bypass it.
//
// CHANNEL: SMS. MSG91's OTP product can also deliver by voice or email, but a
// single channel is chosen and nothing silently retries on another — a user
// told "check your SMS" must not have the code arrive somewhere else.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { msg91OtpTemplateId, isOtpConfigured } from "./config";
import { msg91Request, toMsg91Mobile, type Msg91ErrorKind } from "./client";

export type OtpSendResult =
  | { ok: true }
  | { ok: false; error: OtpFailure };

export type OtpFailure =
  | "not_configured"
  | "invalid_phone"
  | "rate_limited"
  | "service_error";

export type OtpCheckResult =
  | { ok: true; approved: boolean }
  | { ok: false; error: "not_configured" | "service_error" };

/** MSG91 kinds → the four outcomes the UI has copy for. */
function toFailure(kind: Msg91ErrorKind): OtpFailure {
  switch (kind) {
    case "not_configured": return "not_configured";
    case "invalid_request": return "invalid_phone";
    case "rate_limited":    return "rate_limited";
    default:                return "service_error";
  }
}

/**
 * Sends a one-time code to an E.164 number.
 *
 * NOT retried. MSG91 may have accepted and dispatched the first request even
 * when the response never reached us; a retry would send a SECOND code and
 * invalidate the first, so the user would type the code they received and be
 * told it is wrong.
 */
export async function sendVerificationOtp(phoneE164: string): Promise<OtpSendResult> {
  const templateId = msg91OtpTemplateId();
  if (!isOtpConfigured() || !templateId) {
    return { ok: false, error: "not_configured" };
  }

  const res = await msg91Request({
    path: "otp",
    method: "POST",
    authInQuery: true,
    retries: 0,
    query: {
      template_id: templateId,
      mobile: toMsg91Mobile(phoneE164),
      // MSG91 caps expiry per template; 10 minutes is long enough to switch
      // apps and read an SMS, short enough that a code seen over a shoulder
      // is not useful tomorrow.
      otp_expiry: "10",
      otp_length: "6",
    },
  });

  if (res.ok) return { ok: true };
  return { ok: false, error: toFailure(res.kind) };
}

/**
 * Re-sends the SAME code. Distinct from sendVerificationOtp: MSG91's /retry
 * does not mint a new value, so a user who eventually receives the first SMS
 * can still use it.
 */
export async function resendVerificationOtp(phoneE164: string): Promise<OtpSendResult> {
  if (!isOtpConfigured()) return { ok: false, error: "not_configured" };

  const res = await msg91Request({
    path: "otp/retry",
    method: "GET",
    authInQuery: true,
    retries: 0,
    query: { mobile: toMsg91Mobile(phoneE164), retrytype: "text" },
  });

  if (res.ok) return { ok: true };
  return { ok: false, error: toFailure(res.kind) };
}

/**
 * Checks a code.
 *
 * `{ ok: true, approved: false }` means MSG91 answered and the code was wrong
 * or expired — a normal, expected outcome that the caller counts toward the
 * attempt cap. `{ ok: false }` means we could not get an answer at all, and
 * MUST NOT be counted as a failed attempt or treated as approval.
 *
 * The distinction is the whole security property here: collapsing them either
 * lets a provider outage lock a legitimate user out, or — far worse — lets one
 * be read as success.
 */
export async function checkVerificationOtp(
  phoneE164: string,
  code: string,
): Promise<OtpCheckResult> {
  if (!isOtpConfigured()) return { ok: false, error: "not_configured" };

  const res = await msg91Request({
    path: "otp/verify",
    method: "GET",
    retries: 0,
    query: { mobile: toMsg91Mobile(phoneE164), otp: code },
  });

  if (res.ok) return { ok: true, approved: true };

  // "OTP not match" / "OTP expired" — MSG91 answered, the answer was no.
  if (res.kind === "invalid_request" || res.kind === "rejected") {
    return { ok: true, approved: false };
  }

  // Auth, network, timeout, 5xx: we do not know, so we do not guess.
  return { ok: false, error: "service_error" };
}
