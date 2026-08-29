// ─────────────────────────────────────────────────────────────────────────────
// resolveTemplate — the Utility replacements and their legacy fallbacks.
//
// The bug this guards against is silent and expensive: a fallback that swaps
// the Content SID without reshaping the values. Twilio would accept it, Meta
// would deliver it, and the owner would get a receipt with the hall name and
// the date missing. Every case below asserts the SID and the variables move
// together.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveTemplate, WHATSAPP_TEMPLATES } from "@/lib/notifications/whatsapp-templates";

const NEW_SID    = "HX" + "a".repeat(32);
const LEGACY_SID = "HX" + "b".repeat(32);

const KEYS = [
  "TWILIO_TEMPLATE_OWNER_ACCOUNT_STATUS",
  "TWILIO_TEMPLATE_OWNER_PAYMENT_RECEIPT",
  "TWILIO_TEMPLATE_OWNER_HALL_LIVE",
  "TWILIO_TEMPLATE_OWNER_ACCOUNT_UPDATE",
  "TWILIO_TEMPLATE_OWNER_HALL_APPROVED",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("resolveTemplate — preferred template configured", () => {
  it("uses it, keeps the variables untouched, and reports no fallback", () => {
    process.env.TWILIO_TEMPLATE_OWNER_PAYMENT_RECEIPT = NEW_SID;
    const r = resolveTemplate("OWNER_PAYMENT_RECEIPT", ["Rs 2,999", "Premium", "Hallnect Mahal", "28 September 2026"]);
    expect(r).toEqual({
      key: "OWNER_PAYMENT_RECEIPT",
      sid: NEW_SID,
      variables: ["Rs 2,999", "Premium", "Hallnect Mahal", "28 September 2026"],
      usedFallback: false,
    });
  });

  it("ignores a legacy SID when the preferred one is present", () => {
    process.env.TWILIO_TEMPLATE_OWNER_ACCOUNT_STATUS = NEW_SID;
    process.env.TWILIO_TEMPLATE_OWNER_ACCOUNT_UPDATE = LEGACY_SID;
    const r = resolveTemplate("OWNER_ACCOUNT_STATUS", ["Your Hallnect owner account", "Restored", "You can sign in again."]);
    expect(r.sid).toBe(NEW_SID);
    expect(r.usedFallback).toBe(false);
  });
});

describe("resolveTemplate — falling back across a different arity", () => {
  it("reshapes 3 account-status values into the legacy template's 2", () => {
    process.env.TWILIO_TEMPLATE_OWNER_ACCOUNT_UPDATE = LEGACY_SID;
    const r = resolveTemplate("OWNER_ACCOUNT_STATUS", [
      "Your Hallnect owner account", "Restored", "You can sign in again and your listings are active.",
    ]);
    expect(r.key).toBe("OWNER_ACCOUNT_UPDATE");
    expect(r.sid).toBe(LEGACY_SID);
    expect(r.usedFallback).toBe(true);
    // Exactly the legacy arity — never 3 values against a 2-variable template.
    expect(r.variables).toHaveLength(WHATSAPP_TEMPLATES.OWNER_ACCOUNT_UPDATE.variables.length);
    expect(r.variables).toEqual([
      "Your Hallnect owner account — Restored.",
      "You can sign in again and your listings are active.",
    ]);
  });

  it("reshapes 4 receipt values into 2 WITHOUT losing the hall or the date", () => {
    process.env.TWILIO_TEMPLATE_OWNER_ACCOUNT_UPDATE = LEGACY_SID;
    const r = resolveTemplate("OWNER_PAYMENT_RECEIPT", ["Rs 2,999", "Premium", "Hallnect Mahal", "28 September 2026"]);
    expect(r.variables).toHaveLength(2);
    // The naive bug — forwarding values positionally — would drop these two.
    expect(r.variables.join(" ")).toContain("Hallnect Mahal");
    expect(r.variables.join(" ")).toContain("28 September 2026");
    expect(r.variables[0]).toBe("Rs 2,999 received for Premium on Hallnect Mahal.");
  });

  it("passes the single hall name straight through for hall-live", () => {
    process.env.TWILIO_TEMPLATE_OWNER_HALL_APPROVED = LEGACY_SID;
    const r = resolveTemplate("OWNER_HALL_LIVE", ["Hallnect Mahal"]);
    expect(r).toEqual({
      key: "OWNER_HALL_APPROVED", sid: LEGACY_SID, variables: ["Hallnect Mahal"], usedFallback: true,
    });
  });
});

describe("resolveTemplate — nothing configured", () => {
  it("returns no SID rather than inventing one, keeping the caller's arity", () => {
    const r = resolveTemplate("OWNER_ACCOUNT_STATUS", ["Account", "Suspended", "Contact support."]);
    expect(r.sid).toBeNull();
    expect(r.usedFallback).toBe(false);
    expect(r.variables).toHaveLength(3);
  });

  it("treats a malformed SID as unset and still falls back", () => {
    process.env.TWILIO_TEMPLATE_OWNER_ACCOUNT_STATUS = "not-a-sid";
    process.env.TWILIO_TEMPLATE_OWNER_ACCOUNT_UPDATE = LEGACY_SID;
    const r = resolveTemplate("OWNER_ACCOUNT_STATUS", ["Account", "Suspended", "Contact support."]);
    expect(r.usedFallback).toBe(true);
    expect(r.sid).toBe(LEGACY_SID);
  });

  it("does not fall back to a legacy template that is itself malformed", () => {
    process.env.TWILIO_TEMPLATE_OWNER_ACCOUNT_UPDATE = "HXnope";
    const r = resolveTemplate("OWNER_ACCOUNT_STATUS", ["Account", "Suspended", "Contact support."]);
    expect(r.sid).toBeNull();
    expect(r.usedFallback).toBe(false);
  });
});

describe("every declared fallback is arity-correct", () => {
  it("maps onto exactly the legacy template's variable count", () => {
    for (const t of Object.values(WHATSAPP_TEMPLATES)) {
      if (!t.legacy) continue;
      const sample = t.variables.map((_, i) => `v${i + 1}`);
      const mapped = t.legacy.toVariables(sample);
      expect(
        mapped.length,
        `${t.key} -> ${t.legacy.key} produced ${mapped.length} values for ${WHATSAPP_TEMPLATES[t.legacy.key].variables.length} placeholders`,
      ).toBe(WHATSAPP_TEMPLATES[t.legacy.key].variables.length);
      // Nothing may vanish: every source value has to appear somewhere.
      for (const v of sample) expect(mapped.join(" ")).toContain(v);
    }
  });
});
