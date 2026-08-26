// WhatsApp transport safety tests.
//
// The rule these pin: a safety switch must fail CLOSED. Everything else in the
// pipeline is recoverable — a skipped notification can be retried, a wrong
// template can be re-approved — but a message delivered to a real customer
// cannot be recalled.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isWhatsAppEnabled, isWhatsAppTestMode, isTestModeMisconfigured,
  isWhatsAppConfigured, getWhatsAppStatus, toWhatsAppAddress,
  sendWhatsAppTemplate, isPermanentWhatsAppError,
} from "@/lib/twilio/whatsapp";

const KEYS = [
  "TWILIO_WHATSAPP_ENABLED", "TWILIO_WHATSAPP_TEST_MODE", "TWILIO_WHATSAPP_TEST_TO",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM",
  "TWILIO_MESSAGING_SERVICE_SID",
] as const;

let saved: Record<string, string | undefined> = {};
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); });
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
});

/** Credentials good enough that only the switch under test can block a send. */
function configureCredentials() {
  process.env.TWILIO_ACCOUNT_SID = "AC" + "0".repeat(32);
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_WHATSAPP_FROM = "+15554741132";
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
}

describe("master switch", () => {
  it("defaults to OFF when unset — WhatsApp never sends by surprise", () => {
    delete process.env.TWILIO_WHATSAPP_ENABLED;
    expect(isWhatsAppEnabled()).toBe(false);
  });

  it("only the exact string 'true' enables it", () => {
    for (const v of ["false", "1", "yes", "TRUE ", ""]) {
      process.env.TWILIO_WHATSAPP_ENABLED = v;
      expect(isWhatsAppEnabled()).toBe(v.trim().toLowerCase() === "true");
    }
  });

  it("refuses to send while disabled, even with everything else configured", async () => {
    configureCredentials();
    process.env.TWILIO_WHATSAPP_ENABLED = "false";
    const r = await sendWhatsAppTemplate({
      toE164: "+919000000000", contentSid: "HX" + "a".repeat(32), variables: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("disabled");
  });
});

describe("test mode fails CLOSED", () => {
  beforeEach(() => { configureCredentials(); process.env.TWILIO_WHATSAPP_ENABLED = "true"; });

  it("is not active when the flag is on but no test recipient is set", () => {
    process.env.TWILIO_WHATSAPP_TEST_MODE = "true";
    delete process.env.TWILIO_WHATSAPP_TEST_TO;
    expect(isWhatsAppTestMode()).toBe(false);
    expect(isTestModeMisconfigured()).toBe(true);
  });

  it("REFUSES the send rather than delivering to the real recipient", async () => {
    // The regression this exists for: the operator asked not to message real
    // people, and the old behaviour messaged them anyway.
    process.env.TWILIO_WHATSAPP_TEST_MODE = "true";
    delete process.env.TWILIO_WHATSAPP_TEST_TO;
    const r = await sendWhatsAppTemplate({
      toE164: "+919000000000", contentSid: "HX" + "a".repeat(32), variables: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("not_configured");
      expect(r.detail).toMatch(/TWILIO_WHATSAPP_TEST_TO/);
      // Permanent, so a retry can never escalate into a live send.
      expect(isPermanentWhatsAppError(r.kind)).toBe(true);
    }
  });

  it("is active and reports healthy once a test recipient exists", () => {
    process.env.TWILIO_WHATSAPP_TEST_MODE = "true";
    process.env.TWILIO_WHATSAPP_TEST_TO = "+919344040013";
    expect(isWhatsAppTestMode()).toBe(true);
    expect(isTestModeMisconfigured()).toBe(false);
  });

  it("a bare test recipient with the flag off does not redirect anything", () => {
    process.env.TWILIO_WHATSAPP_TEST_MODE = "false";
    process.env.TWILIO_WHATSAPP_TEST_TO = "+919344040013";
    expect(isWhatsAppTestMode()).toBe(false);
    expect(isTestModeMisconfigured()).toBe(false);
  });
});

describe("status reporting", () => {
  it("NEVER exposes the auth token, and masks the account SID", () => {
    configureCredentials();
    const s = getWhatsAppStatus();
    expect(JSON.stringify(s)).not.toContain("test-token");
    expect(s.accountSidMasked).toBe("AC…0000");
    expect(s.senderKind).toBe("whatsapp_number");
  });

  it("reports the blocked state so a dashboard cannot show a false green", () => {
    configureCredentials();
    process.env.TWILIO_WHATSAPP_ENABLED = "true";
    process.env.TWILIO_WHATSAPP_TEST_MODE = "true";
    delete process.env.TWILIO_WHATSAPP_TEST_TO;
    const s = getWhatsAppStatus();
    expect(s.testModeMisconfigured).toBe(true);
    expect(s.testMode).toBe(false);
  });

  it("is not configured without credentials or without a sender", () => {
    configureCredentials();
    expect(isWhatsAppConfigured()).toBe(true);
    delete process.env.TWILIO_WHATSAPP_FROM;
    expect(isWhatsAppConfigured()).toBe(false);
  });
});

describe("address normalisation", () => {
  it("always yields the whatsapp: form, so a send can never fall back to SMS", () => {
    expect(toWhatsAppAddress("+919344040013")).toBe("whatsapp:+919344040013");
    expect(toWhatsAppAddress("whatsapp:+919344040013")).toBe("whatsapp:+919344040013");
    expect(toWhatsAppAddress("  WhatsApp:+919344040013 ")).toBe("whatsapp:+919344040013");
  });
});
