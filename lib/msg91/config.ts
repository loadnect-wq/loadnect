// ─────────────────────────────────────────────────────────────────────────────
// lib/msg91/config.ts — MSG91 credentials and switches (SERVER-ONLY).
//
// MSG91 is the ONLY messaging provider this platform uses: OTP and every
// transactional SMS go through it. There is no second provider and no
// fallback — a message either goes out over MSG91 or it is recorded as not
// sent, with the reason.
//
// Everything is read LAZILY from the environment so the app builds and boots
// with none of it set. Nothing here throws: an unconfigured deployment must
// degrade to "messaging is off", never to a crashed request.
//
// WHAT MSG91 NEEDS BEFORE A SINGLE SMS CAN LEAVE (India, TRAI DLT):
//   1. MSG91_AUTH_KEY   — the account key. One per account, from the panel.
//   2. MSG91_SENDER_ID  — the 6-character DLT-approved header (e.g. HLNECT).
//   3. a DLT-registered template per message, whose MSG91 template id goes in
//      MSG91_TEMPLATE_<KEY> (see lib/notifications/sms-templates.ts).
// Items 2 and 3 cannot be created by writing code: the header and each
// template body must first be approved on a telecom DLT portal against a
// registered Principal Entity. isMsg91Configured() is false until they exist,
// and the outbox records every message as 'skipped' with that reason rather
// than pretending.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

/** MSG91 REST base. All v5 endpoints hang off this. */
export const MSG91_API_BASE = "https://control.msg91.com/api/v5";

/** Every network call is bounded; a hung provider must not hold a request. */
export const MSG91_TIMEOUT_MS = 10_000;

function readTrimmed(key: string): string | null {
  const v = process.env[key];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function readBool(key: string, fallback: boolean): boolean {
  const v = readTrimmed(key)?.toLowerCase();
  if (v === undefined || v === null) return fallback;
  return v === "true" || v === "1" || v === "yes";
}

/** The account auth key. Never logged, never returned to a browser. */
export function msg91AuthKey(): string | null {
  return readTrimmed("MSG91_AUTH_KEY");
}

/**
 * The DLT-approved sender header.
 *
 * Indian A2P headers are exactly 6 alphanumeric characters. Validating the
 * SHAPE here means a mistyped variable is reported as "not configured" in the
 * admin dashboard instead of being discovered as a rejected send in
 * production. A non-conforming value is treated as absent, not passed through.
 */
export function msg91SenderId(): string | null {
  const raw = readTrimmed("MSG91_SENDER_ID");
  if (!raw) return null;
  return /^[A-Za-z0-9]{3,11}$/.test(raw) ? raw.toUpperCase() : null;
}

/** True when MSG91_SENDER_ID is set but is not a usable header. */
export function hasMalformedSenderId(): boolean {
  return readTrimmed("MSG91_SENDER_ID") !== null && msg91SenderId() === null;
}

/** The MSG91 template id used by the OTP endpoints. 24 hex characters. */
export function msg91OtpTemplateId(): string | null {
  const raw = readTrimmed("MSG91_OTP_TEMPLATE_ID");
  if (!raw) return null;
  return /^[0-9a-fA-F]{24}$/.test(raw) ? raw : null;
}

/** True when MSG91_OTP_TEMPLATE_ID is set but is not a valid template id. */
export function hasMalformedOtpTemplateId(): boolean {
  return readTrimmed("MSG91_OTP_TEMPLATE_ID") !== null && msg91OtpTemplateId() === null;
}

/**
 * The master switch for OUTBOUND NOTIFICATION SMS.
 *
 * Defaults to FALSE. A deployment that has credentials but has not been
 * deliberately switched on sends nothing: turning a messaging channel on is an
 * explicit act, because the failure mode of the opposite default is messaging
 * real customers from a staging environment.
 */
export function isSmsEnabled(): boolean {
  return readBool("MSG91_SMS_ENABLED", false);
}

/** Credentials + header present. Says nothing about per-message templates. */
export function isMsg91Configured(): boolean {
  return msg91AuthKey() !== null && msg91SenderId() !== null;
}

/** OTP needs the auth key and the OTP template, but not the notification switch. */
export function isOtpConfigured(): boolean {
  return msg91AuthKey() !== null && msg91OtpTemplateId() !== null;
}

/**
 * TEST MODE — every notification SMS is redirected to MSG91_TEST_TO.
 *
 * Exists so the whole pipeline can be exercised against real MSG91 without
 * messaging real customers. Defaults to FALSE: a forgotten test flag in
 * production would silently divert every customer's booking confirmation to
 * one phone, which is worse than sending nothing.
 *
 * OTP is deliberately NOT redirected — an OTP proves control of the number it
 * was sent to, so diverting it would verify the wrong phone.
 */
export function isSmsTestMode(): boolean {
  return readBool("MSG91_TEST_MODE", false);
}

/** Where test-mode messages actually go. Null when unset. */
export function smsTestRecipient(): string | null {
  return readTrimmed("MSG91_TEST_TO");
}

/**
 * Shared secret MSG91 must present on the delivery-report webhook.
 * Optional: when unset the webhook accepts nothing and says so, rather than
 * accepting unauthenticated writes.
 */
export function msg91WebhookSecret(): string | null {
  return readTrimmed("MSG91_WEBHOOK_SECRET");
}

export type Msg91Status = {
  enabled: boolean;
  configured: boolean;
  otpConfigured: boolean;
  testMode: boolean;
  testRecipient: string | null;
  /** Masked — never the key itself. */
  authKeyHint: string | null;
  senderId: string | null;
  malformedSenderId: boolean;
  otpTemplateId: string | null;
  malformedOtpTemplateId: boolean;
  webhookSecretSet: boolean;
};

/**
 * A safe summary for the admin dashboard.
 *
 * The auth key is reduced to its last 4 characters — enough to tell two keys
 * apart when checking which one a deployment picked up, useless to anyone who
 * reads it over a shoulder or out of a screenshot.
 */
export function getMsg91Status(): Msg91Status {
  const key = msg91AuthKey();
  return {
    enabled: isSmsEnabled(),
    configured: isMsg91Configured(),
    otpConfigured: isOtpConfigured(),
    testMode: isSmsTestMode(),
    testRecipient: smsTestRecipient(),
    authKeyHint: key ? `••••${key.slice(-4)}` : null,
    senderId: msg91SenderId(),
    malformedSenderId: hasMalformedSenderId(),
    otpTemplateId: msg91OtpTemplateId(),
    malformedOtpTemplateId: hasMalformedOtpTemplateId(),
    webhookSecretSet: msg91WebhookSecret() !== null,
  };
}
