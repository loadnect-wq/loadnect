import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { verifyCashfreeWebhookSignature } from "@/lib/cashfree";

// ─────────────────────────────────────────────────────────────────────────────
// The Cashfree PG webhook signature scheme, pinned.
//
// WHY A KNOWN-ANSWER TEST AND NOT JUST A ROUND TRIP. A test that signs with the
// same helper it verifies with passes even if the scheme is wrong — swap the
// concatenation order, use hex instead of base64, key it with the wrong secret,
// and a self-consistent test still goes green while EVERY REAL WEBHOOK IS
// REJECTED. The vectors below were computed independently from Cashfree's
// documented rule, so they fail if the scheme drifts.
//
// The rule, quoted from
// https://www.cashfree.com/docs/payments/online/webhooks/signature-verification
//   "You need your Cashfree PG secret key and the payload to verify the
//    signature."
// and, on the computation: concatenate the timestamp and the raw request body,
// HMAC-SHA256 that string with the client secret, base64-encode the digest, and
// compare with x-webhook-signature.
//
// NOTE WHICH SECRET THAT IS: the PG CLIENT SECRET, not a separate
// dashboard-issued webhook secret. There is no such thing for PG webhooks.
// CASHFREE_WEBHOOK_SECRET exists only to pin a specific key during a rotation.
// ─────────────────────────────────────────────────────────────────────────────

const SECRET = "test_secret_key_do_not_use";
const TIMESTAMP = "1700000000";
const BODY = '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"order":{"order_id":"HN-TEST-1"}}}';

/** The signature computed from the documented rule, independently of lib/cashfree.ts. */
function referenceSignature(secret: string, timestamp: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}${body}`).digest("base64");
}

const saved: Record<string, string | undefined> = {};
function setEnv(k: string, v: string | undefined) {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

beforeEach(() => {
  // getCashfreeConfig() reads these; the fallback path is the one in production.
  setEnv("CASHFREE_APP_ID", "test_app_id");
  setEnv("CASHFREE_SECRET_KEY", SECRET);
  setEnv("CASHFREE_ENV", "sandbox");
  setEnv("CASHFREE_WEBHOOK_SECRET", undefined);
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("verifyCashfreeWebhookSignature — the documented scheme", () => {
  it("accepts a signature computed the way Cashfree computes it", () => {
    const sig = referenceSignature(SECRET, TIMESTAMP, BODY);
    expect(verifyCashfreeWebhookSignature(BODY, sig, TIMESTAMP)).toBe(true);
  });

  it("keys the HMAC with the PG SECRET KEY when no webhook secret is set", () => {
    // The production posture. If this ever fails, every real webhook 401s.
    const sig = referenceSignature(SECRET, TIMESTAMP, BODY);
    expect(process.env.CASHFREE_WEBHOOK_SECRET).toBeUndefined();
    expect(verifyCashfreeWebhookSignature(BODY, sig, TIMESTAMP)).toBe(true);
  });

  it("prefers CASHFREE_WEBHOOK_SECRET when one IS set", () => {
    setEnv("CASHFREE_WEBHOOK_SECRET", "a_pinned_rotation_key");
    // Signed with the pinned key → accepted.
    expect(verifyCashfreeWebhookSignature(
      BODY, referenceSignature("a_pinned_rotation_key", TIMESTAMP, BODY), TIMESTAMP,
    )).toBe(true);
    // Signed with the PG secret key → now REJECTED. This is the trap the admin
    // settings page warns about: setting this to anything other than the PG
    // secret key rejects every genuine webhook.
    expect(verifyCashfreeWebhookSignature(
      BODY, referenceSignature(SECRET, TIMESTAMP, BODY), TIMESTAMP,
    )).toBe(false);
  });

  it("treats a blank CASHFREE_WEBHOOK_SECRET as unset rather than as an empty key", () => {
    setEnv("CASHFREE_WEBHOOK_SECRET", "   ");
    expect(verifyCashfreeWebhookSignature(
      BODY, referenceSignature(SECRET, TIMESTAMP, BODY), TIMESTAMP,
    )).toBe(true);
  });

  // ── The scheme itself. Each of these is a plausible refactor that would
  //    silently reject every real webhook. ────────────────────────────────────

  it("signs timestamp BEFORE body, not body before timestamp", () => {
    const reversed = crypto.createHmac("sha256", SECRET)
      .update(`${BODY}${TIMESTAMP}`).digest("base64");
    expect(verifyCashfreeWebhookSignature(BODY, reversed, TIMESTAMP)).toBe(false);
  });

  it("is base64, not hex", () => {
    const hex = crypto.createHmac("sha256", SECRET)
      .update(`${TIMESTAMP}${BODY}`).digest("hex");
    expect(verifyCashfreeWebhookSignature(BODY, hex, TIMESTAMP)).toBe(false);
  });

  it("covers the body — a single changed byte invalidates it", () => {
    const sig = referenceSignature(SECRET, TIMESTAMP, BODY);
    const tampered = BODY.replace("HN-TEST-1", "HN-TEST-2");
    expect(verifyCashfreeWebhookSignature(tampered, sig, TIMESTAMP)).toBe(false);
  });

  it("covers the timestamp — replaying a body under a different timestamp fails", () => {
    const sig = referenceSignature(SECRET, TIMESTAMP, BODY);
    expect(verifyCashfreeWebhookSignature(BODY, sig, "1700000001")).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const sig = referenceSignature("not_the_secret", TIMESTAMP, BODY);
    expect(verifyCashfreeWebhookSignature(BODY, sig, TIMESTAMP)).toBe(false);
  });

  // ── Fail-closed on malformed input. None of these may throw: the route calls
  //    this inside a try, but a throw there becomes a 401 anyway, and silently
  //    turning a real webhook into a 401 is the failure being guarded. ────────

  it("returns false, and does not throw, for missing header values", () => {
    const sig = referenceSignature(SECRET, TIMESTAMP, BODY);
    expect(verifyCashfreeWebhookSignature(BODY, null, TIMESTAMP)).toBe(false);
    expect(verifyCashfreeWebhookSignature(BODY, sig, null)).toBe(false);
    expect(verifyCashfreeWebhookSignature(BODY, null, null)).toBe(false);
  });

  it("returns false for a signature of the wrong length instead of throwing", () => {
    // timingSafeEqual THROWS on unequal lengths; the length guard is what stops
    // an attacker turning a short header into a 500.
    for (const bad of ["", "x", "!!!!", "a".repeat(1000)]) {
      expect(() => verifyCashfreeWebhookSignature(BODY, bad, TIMESTAMP)).not.toThrow();
      expect(verifyCashfreeWebhookSignature(BODY, bad, TIMESTAMP)).toBe(false);
    }
  });

  it("does not accept a signature with surrounding whitespace", () => {
    // Documents current behaviour rather than endorsing it: if Cashfree ever
    // padded the header, this test is where that would surface.
    const sig = referenceSignature(SECRET, TIMESTAMP, BODY);
    expect(verifyCashfreeWebhookSignature(BODY, ` ${sig} `, TIMESTAMP)).toBe(false);
  });

  it("handles a body with unicode and newlines byte-for-byte", () => {
    const body = '{"note":"Sri Meenakshi Mahal — ₹1,00,000\\nline two"}';
    const sig = referenceSignature(SECRET, TIMESTAMP, body);
    expect(verifyCashfreeWebhookSignature(body, sig, TIMESTAMP)).toBe(true);
  });
});
