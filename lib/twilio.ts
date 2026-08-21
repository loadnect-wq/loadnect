// ─────────────────────────────────────────────────────────────────────────────
// lib/twilio.ts — Twilio Verify OTP client (SERVER-ONLY).
//
// Uses the Twilio Verify v2 REST API directly via fetch (no SDK dependency).
// OTPs are generated, stored, expired and checked BY TWILIO — this codebase
// never generates, stores, or logs an OTP value.
//
// CONFIGURATION (see .env.example): credentials are read lazily so the app
// builds and runs with none of them set. isTwilioConfigured() is the pre-flight
// guard: when false, callers show "Phone verification is not configured yet."
// There is NO mock/bypass OTP in any environment — an unconfigured service
// simply refuses, it never pretends.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import crypto from "node:crypto";

const VERIFY_BASE = "https://verify.twilio.com/v2";

type TwilioConfig = { accountSid: string; authToken: string; verifyServiceSid: string };

function readConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (!accountSid || !authToken || !verifyServiceSid) return null;
  return { accountSid, authToken, verifyServiceSid };
}

/** True only when all three Twilio env vars are present. Never throws. */
export function isTwilioConfigured(): boolean {
  return readConfig() !== null;
}

function authHeader(cfg: TwilioConfig): string {
  return "Basic " + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64");
}

export type TwilioResult =
  | { ok: true; status: string }
  | { ok: false; error: "not_configured" | "invalid_phone" | "rate_limited" | "service_error" };

// normalizePhoneE164 moved to lib/notifications/phone.ts (pure, client-safe);
// re-exported here so every existing server-side import keeps working.
export { normalizePhoneE164 } from "@/lib/notifications/phone";

/** Asks Twilio Verify to send an OTP via SMS to an E.164 number. */
export async function sendVerificationOtp(phoneE164: string): Promise<TwilioResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: false, error: "not_configured" };

  try {
    const res = await fetch(
      `${VERIFY_BASE}/Services/${cfg.verifyServiceSid}/Verifications`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader(cfg),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: phoneE164, Channel: "sms" }),
      signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      },
    );

    if (res.status === 429) return { ok: false, error: "rate_limited" };
    if (res.status === 400) return { ok: false, error: "invalid_phone" };
    if (!res.ok) {
      // Log status only — never the body (it can echo the phone number) and
      // never credentials.
      console.error(`[twilio] verification send failed: HTTP ${res.status}`);
      return { ok: false, error: "service_error" };
    }
    const data = (await res.json()) as { status?: string };
    return { ok: true, status: data.status ?? "pending" };
  } catch (e) {
    console.error("[twilio] verification send error:", e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "service_error" };
  }
}

export type TwilioCheckResult =
  | { ok: true; approved: boolean }
  | { ok: false; error: "not_configured" | "service_error" };

/** Checks an OTP with Twilio Verify. `approved: false` = wrong/expired code. */
export async function checkVerificationOtp(
  phoneE164: string,
  code: string,
): Promise<TwilioCheckResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: false, error: "not_configured" };

  try {
    const res = await fetch(
      `${VERIFY_BASE}/Services/${cfg.verifyServiceSid}/VerificationCheck`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader(cfg),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: phoneE164, Code: code }),
      signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      },
    );

    // Twilio returns 404 when the verification expired or was never started —
    // treat as a failed (not errored) check.
    if (res.status === 404) return { ok: true, approved: false };
    if (!res.ok) {
      console.error(`[twilio] verification check failed: HTTP ${res.status}`);
      return { ok: false, error: "service_error" };
    }
    const data = (await res.json()) as { status?: string };
    return { ok: true, approved: data.status === "approved" };
  } catch (e) {
    console.error("[twilio] verification check error:", e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "service_error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transactional SMS (Twilio Messages API) — separate from Verify OTP above.
//
// Gating is TWO independent switches, both required:
//   1. TWILIO_ENABLED=true          — the explicit master switch
//   2. credentials present          — SID + auth token + a sender
// A sender is either TWILIO_MESSAGING_SERVICE_SID (preferred: Twilio picks the
// number, handles India DLT routing) or TWILIO_PHONE_NUMBER (single from-number).
// With either switch off, callers record the SMS as 'skipped' — the app keeps
// working, nothing throws, nothing pretends to have sent.
// ─────────────────────────────────────────────────────────────────────────────

const MESSAGES_BASE = "https://api.twilio.com/2010-04-01";

type SmsConfig = {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string | null;
  fromNumber: string | null;
};

function readSmsConfig(): SmsConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() || null;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER?.trim() || null;
  if (!accountSid || !authToken) return null;
  if (!messagingServiceSid && !fromNumber) return null;
  return { accountSid, authToken, messagingServiceSid, fromNumber };
}

/** The explicit master switch. Defaults to OFF — SMS never sends by surprise. */
export function isTwilioSmsEnabled(): boolean {
  return process.env.TWILIO_ENABLED?.trim().toLowerCase() === "true";
}

/** True when credentials + a sender exist (independent of the master switch). */
export function isTwilioSmsConfigured(): boolean {
  return readSmsConfig() !== null;
}

/** Masked status for the admin dashboard. NEVER returns the auth token. */
export function getTwilioSmsStatus(): {
  enabled: boolean;
  configured: boolean;
  accountSidMasked: string | null;
  sender: "messaging_service" | "phone_number" | null;
} {
  const cfg = readSmsConfig();
  return {
    enabled: isTwilioSmsEnabled(),
    configured: cfg !== null,
    accountSidMasked: cfg
      ? `${cfg.accountSid.slice(0, 2)}…${cfg.accountSid.slice(-4)}`
      : null,
    sender: cfg ? (cfg.messagingServiceSid ? "messaging_service" : "phone_number") : null,
  };
}

export type SmsSendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: "disabled" | "not_configured" | "invalid_phone" | "rate_limited" | "service_error"; detail?: string };

/**
 * Sends one SMS via the Twilio Messages API. The caller (notification service)
 * has already decided recipient and content server-side — this function only
 * transports. Logs status codes, never bodies or credentials.
 */
export async function sendSms(toE164: string, body: string): Promise<SmsSendResult> {
  if (!isTwilioSmsEnabled()) return { ok: false, error: "disabled" };
  const cfg = readSmsConfig();
  if (!cfg) return { ok: false, error: "not_configured" };

  const params = new URLSearchParams({ To: toE164, Body: body.slice(0, 800) });
  if (cfg.messagingServiceSid) params.set("MessagingServiceSid", cfg.messagingServiceSid);
  else if (cfg.fromNumber) params.set("From", cfg.fromNumber);

  try {
    const res = await fetch(`${MESSAGES_BASE}/Accounts/${cfg.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      cache: "no-store",
      // A Twilio outage must never hang the booking/payment action that
      // triggered the SMS — the catch maps the abort to service_error and the
      // outbox row stays admin-retryable.
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 429) return { ok: false, error: "rate_limited" };
    if (res.status === 400) {
      // 21211 invalid To number and friends — the number, not the service.
      console.error(`[twilio] sms rejected: HTTP 400`);
      return { ok: false, error: "invalid_phone", detail: "Provider rejected the phone number" };
    }
    if (!res.ok) {
      console.error(`[twilio] sms send failed: HTTP ${res.status}`);
      return { ok: false, error: "service_error", detail: `HTTP ${res.status}` };
    }

    const data = (await res.json()) as { sid?: string };
    return { ok: true, providerMessageId: data.sid ?? "unknown" };
  } catch {
    console.error("[twilio] sms send failed: network error");
    return { ok: false, error: "service_error", detail: "network error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook signature verification (X-Twilio-Signature) — for STATUS CALLBACKS
// Twilio pushes TO us (registration/bundle status, message status), as opposed
// to the outbound calls above. Two documented signing schemes exist:
//
//   • application/x-www-form-urlencoded
//       signed string = fullUrl + each POST param as key+value, keys sorted
//       (Unix case-sensitive), concatenated with NO delimiters.
//
//   • application/json
//       Twilio appends ?bodySHA256=<hex sha256 of the raw body> to the URL and
//       signs the URL *including that query string*. The body itself is NOT
//       concatenated. Validation therefore has TWO parts: the HMAC must match
//       AND sha256(rawBody) must equal the bodySHA256 parameter — otherwise a
//       replayed signature could be paired with a swapped body.
//
// Both are implemented directly: this project has no Twilio SDK dependency
// (lib/twilio.ts uses raw fetch throughout).
// ─────────────────────────────────────────────────────────────────────────────

export type TwilioSignatureResult =
  | { ok: true }
  | { ok: false; reason: "no_signature" | "not_configured" | "body_hash_mismatch" | "signature_mismatch" };

/**
 * Verifies an inbound Twilio webhook's X-Twilio-Signature header.
 *
 * Returns a REASON on failure so the route can log precisely why — in
 * particular distinguishing "we have no auth token yet" (expected before
 * Twilio credentials are configured) from a genuine signature mismatch.
 *
 * candidateOrigins exists because Twilio signs the EXACT URL it was configured
 * with. This site answers on both the apex and www hosts, so a URL pasted as
 * either one must verify; we try each and accept the first that matches.
 */
export function verifyTwilioWebhookSignature(input: {
  /** request.url — carries the query string, which the JSON scheme signs. */
  requestUrl: string;
  /** Origins Twilio may have been configured with, e.g. https://www.example.com */
  candidateOrigins: string[];
  signature: string | null;
  /** Raw body exactly as received, read before any parsing. */
  rawBody: string;
  contentType: string | null;
}): TwilioSignatureResult {
  const { requestUrl, candidateOrigins, signature, rawBody, contentType } = input;

  if (!signature) return { ok: false, reason: "no_signature" };

  // Signature verification needs ONLY the auth token. readConfig() also demands
  // TWILIO_VERIFY_SERVICE_SID, which is unrelated to webhooks — requiring it
  // here would break verification for anyone using SMS/registration without
  // the Verify product.
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!authToken) return { ok: false, reason: "not_configured" };

  const isJson = (contentType ?? "").toLowerCase().includes("application/json");

  let parsed: URL;
  try { parsed = new URL(requestUrl); } catch { return { ok: false, reason: "signature_mismatch" }; }

  if (isJson) {
    // Part 1: the body must hash to exactly what the URL claims.
    const claimed = parsed.searchParams.get("bodySHA256");
    if (!claimed) return { ok: false, reason: "body_hash_mismatch" };
    const actual = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");
    const cBuf = Buffer.from(claimed.toLowerCase());
    const aBuf = Buffer.from(actual);
    if (cBuf.length !== aBuf.length || !crypto.timingSafeEqual(cBuf, aBuf)) {
      return { ok: false, reason: "body_hash_mismatch" };
    }
  }

  // Part 2: the HMAC over the exact configured URL (path + query preserved).
  const suffix = isJson ? "" : formParamsSortedConcat(rawBody);
  for (const origin of candidateOrigins) {
    const url = `${origin.replace(/\/$/, "")}${parsed.pathname}${parsed.search}`;
    const expected = crypto
      .createHmac("sha1", authToken)
      .update(url + suffix, "utf8")
      .digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { ok: true };
  }

  return { ok: false, reason: "signature_mismatch" };
}

/** Sorts x-www-form-urlencoded params by key (Unix case-sensitive) and
 *  concatenates key+value pairs with no separators — the exact transform
 *  Twilio's form-encoded signing scheme requires. */
function formParamsSortedConcat(rawBody: string): string {
  const params = new URLSearchParams(rawBody);
  const keys = Array.from(new Set(params.keys())).sort();
  // getAll: a repeated key contributes each of its values, in order.
  return keys.map((k) => params.getAll(k).map((v) => k + v).join("")).join("");
}
