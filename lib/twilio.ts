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
