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

/**
 * Normalises a phone number to E.164. Defaults to India (+91) for bare
 * 10-digit numbers, but passes through any explicit +country number, so
 * international customers are not locked out.
 *
 * Returns null when the input cannot be a valid E.164 number. Normalisation
 * prevents duplicate identities like "9876543210" vs "+919876543210".
 */
export function normalizePhoneE164(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;

  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return null;

  let candidate: string;
  if (hadPlus) {
    candidate = `+${digits}`;
  } else if (digits.length === 10) {
    candidate = `+91${digits}`;                  // bare Indian mobile
  } else if (digits.length === 11 && digits.startsWith("0")) {
    candidate = `+91${digits.slice(1)}`;         // 0-prefixed Indian mobile
  } else if (digits.length === 12 && digits.startsWith("91")) {
    candidate = `+${digits}`;                    // 91XXXXXXXXXX without +
  } else {
    candidate = `+${digits}`;                    // explicit international, no +
  }

  // E.164: + followed by 8–15 digits, no leading zero on the country code.
  if (!/^\+[1-9]\d{7,14}$/.test(candidate)) return null;
  return candidate;
}

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
