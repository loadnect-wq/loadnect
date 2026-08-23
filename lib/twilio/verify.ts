// ─────────────────────────────────────────────────────────────────────────────
// lib/twilio/verify.ts — Twilio Verify OTP client (SERVER-ONLY).
//
// Uses the Twilio Verify v2 REST API directly via fetch (no SDK dependency).
// OTPs are generated, stored, expired and checked BY TWILIO — this codebase
// never generates, stores, or logs an OTP value.
//
// CHANNEL: WhatsApp by default, matching the platform-wide decision that
// Hallnect messages people on WhatsApp and not by SMS. Twilio Verify delivers
// the OTP over whichever channel is requested, provided that channel is
// enabled on the Verify Service. TWILIO_VERIFY_CHANNEL exists as an escape
// hatch for an account whose Verify Service has not had WhatsApp enabled yet —
// it is NOT a fallback: one channel is chosen, and nothing silently retries on
// another.
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

/** True only when all three Twilio Verify env vars are present. Never throws. */
export function isTwilioConfigured(): boolean {
  return readConfig() !== null;
}

/**
 * The channel Verify delivers the OTP on. Defaults to WhatsApp.
 * Only the two channels Verify supports for a numeric code are accepted; an
 * unrecognised value falls back to whatsapp rather than being passed through
 * to the API as garbage.
 */
export function verifyChannel(): "whatsapp" | "sms" {
  const raw = process.env.TWILIO_VERIFY_CHANNEL?.trim().toLowerCase();
  return raw === "sms" ? "sms" : "whatsapp";
}

function authHeader(cfg: TwilioConfig): string {
  return "Basic " + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64");
}

export type TwilioResult =
  | { ok: true; status: string }
  | { ok: false; error: "not_configured" | "invalid_phone" | "rate_limited" | "service_error" };

/** Asks Twilio Verify to send an OTP to an E.164 number over the chosen channel. */
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
        body: new URLSearchParams({ To: phoneE164, Channel: verifyChannel() }),
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
