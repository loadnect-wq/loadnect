// ─────────────────────────────────────────────────────────────────────────────
// lib/__tests__/sms-templates.test.ts — the registry.
//
// The expensive mistake this file guards against is GSM-7. One character
// outside the GSM alphabet switches the whole message to UCS-2 and the segment
// size drops from 160 to 70 — so a booking confirmation carrying the rupee
// glyph costs three segments instead of one, on every booking, forever.
// The second is the positional contract: var order is what the DLT-registered
// template was approved against, and silently reindexing it fills every
// message with the right words in the wrong slots.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, afterEach } from "vitest";
import {
  SMS_TEMPLATES,
  ALL_SMS_TEMPLATE_KEYS,
  toGsm7,
  isGsm7,
  gsm7OrFallback,
  coerceVariables,
  renderTemplate,
  dltBody,
  msg91Body,
  segmentCount,
  templateIdFor,
  hasMalformedTemplateId,
  smsTemplateConfigStatus,
  MAX_VARIABLE_LENGTH,
  type SmsTemplateKey,
} from "@/lib/notifications/sms-templates";

const TEMPLATE = "0123456789abcdef01234567";
const touched: string[] = [];

afterEach(() => {
  for (const k of touched.splice(0)) delete process.env[k];
});

function setTemplate(key: SmsTemplateKey, value: string) {
  const name = SMS_TEMPLATES[key].envVar;
  process.env[name] = value;
  touched.push(name);
}

describe("GSM-7 safety", () => {
  it("transliterates the rupee sign rather than tripling the message cost", () => {
    expect(toGsm7("₹1,00,000")).toBe("Rs.1,00,000");
    expect(isGsm7(toGsm7("₹1,00,000"))).toBe(true);
  });

  it("transliterates dashes, quotes and ellipses that would force UCS-2", () => {
    expect(toGsm7("Declined — “no” … it’s off")).toBe("Declined - \"no\" ... it's off");
  });

  it("drops anything with no GSM-7 equivalent instead of letting it through", () => {
    const out = toGsm7("Grand Hall 🎉 மண்டபம்");
    expect(isGsm7(out)).toBe(true);
    expect(out).toBe("Grand Hall");
  });

  it("erases a Tamil name completely — which is why toGsm7 alone is not enough", () => {
    // GSM 03.38 contains no Indic script at all. On a Tamil Nadu marketplace
    // this is an ordinary venue name, not an edge case, and the whole of it
    // disappears. Pinned here because the fallback logic below only makes sense
    // once you have seen this.
    expect(toGsm7("திருமண மண்டபம்")).toBe("");
  });

  it("recognises the GSM-7 extension characters as safe", () => {
    expect(isGsm7("[]{}~^|\\€")).toBe(true);
  });

  it("rejects a bare rupee sign", () => {
    expect(isGsm7("₹200")).toBe(false);
  });
});

describe("gsm7OrFallback — the encoding and the fallback are one decision", () => {
  it("falls back for a name that is entirely Tamil", () => {
    // The bug it closes: `sanitize(name) ?? "your venue"` never reaches the
    // fallback, because "திருமண மண்டபம்" is a perfectly good non-empty string
    // until GSM-7 gets to it — and by then the choice has been made.
    expect(gsm7OrFallback("திருமண மண்டபம்", "your venue")).toBe("your venue");
  });

  it("falls back for Devanagari too", () => {
    expect(gsm7OrFallback("विवाह मंडप", "your venue")).toBe("your venue");
  });

  it("keeps the Latin part of a mixed name rather than discarding the value", () => {
    expect(gsm7OrFallback("Sri Krishna மண்டபம்", "your venue")).toBe("Sri Krishna");
  });

  it("keeps a normal name untouched, and sanitises it on the way through", () => {
    expect(gsm7OrFallback("Grand Hall", "your venue")).toBe("Grand Hall");
    expect(gsm7OrFallback("₹ Grand Hall 🎉", "your venue")).toBe("Rs. Grand Hall");
  });

  it("falls back for null, undefined and whitespace", () => {
    expect(gsm7OrFallback(null, "your venue")).toBe("your venue");
    expect(gsm7OrFallback(undefined, "your venue")).toBe("your venue");
    expect(gsm7OrFallback("   ", "your venue")).toBe("your venue");
  });

  it("makes the fallback itself GSM-7 safe, so it cannot reintroduce the problem", () => {
    expect(gsm7OrFallback("மண்டபம்", "₹0 due")).toBe("Rs.0 due");
  });
});

describe("variable coercion", () => {
  it("pads missing values to the declared arity with empty strings, never 'undefined'", () => {
    const out = coerceVariables("CUSTOMER_BOOKING_CONFIRMED", ["Asha"]);
    expect(out).toHaveLength(SMS_TEMPLATES.CUSTOMER_BOOKING_CONFIRMED.variables.length);
    expect(out.slice(1).every((v) => v === "")).toBe(true);
    expect(renderTemplate("CUSTOMER_BOOKING_CONFIRMED", out)).not.toContain("undefined");
  });

  it("drops extra values rather than appending them to the message", () => {
    const out = coerceVariables("OWNER_HALL_SUBMITTED", ["Grand Hall", "surprise", "extra"]);
    expect(out).toEqual(["Grand Hall"]);
  });

  it("turns null and undefined into empty strings", () => {
    expect(coerceVariables("OWNER_HALL_REJECTED", [null, undefined])).toEqual(["", ""]);
  });

  it("stringifies numbers", () => {
    expect(coerceVariables("OWNER_HALL_SUBMITTED", [42])).toEqual(["42"]);
  });

  it("truncates an over-long value and MARKS it, so a clipped name is not read as real", () => {
    const long = "A".repeat(MAX_VARIABLE_LENGTH + 40);
    const [v] = coerceVariables("OWNER_HALL_SUBMITTED", [long]);
    expect(v.length).toBeLessThanOrEqual(MAX_VARIABLE_LENGTH);
    expect(v.endsWith("...")).toBe(true);
  });

  it("never leaves a HOLE where a Tamil venue name was", () => {
    // Before the fix this produced "", and the customer read
    // "your hall booking at  on 12 Jan" — the venue silently missing from a
    // confirmation, on a marketplace whose venues are largely Tamil-named.
    const [hall] = coerceVariables("OWNER_HALL_SUBMITTED", ["திருமண மண்டபம்"]);
    expect(hall).not.toBe("");
    expect(isGsm7(hall)).toBe(true);

    const values = coerceVariables(
      "CUSTOMER_BOOKING_CONFIRMED",
      ["ரமேஷ்", "திருமண மண்டபம்", "12 Jan 2027", "HN-1024"],
    );
    expect(values.every((v) => v !== "")).toBe(true);
    const message = renderTemplate("CUSTOMER_BOOKING_CONFIRMED", values);
    expect(isGsm7(message)).toBe(true);
    // The booking is still identifiable even when both names were lost.
    expect(message).toContain("HN-1024");
    expect(message).not.toMatch(/\s{2,}/);
  });

  it("still records a MISSING value as empty rather than inventing a stand-in", () => {
    // The fallback is for a value that GSM-7 erased, not for one the caller
    // never supplied — "" there is the documented signal that a variable was
    // not passed.
    expect(coerceVariables("OWNER_HALL_REJECTED", [null, ""])).toEqual(["", ""]);
  });

  it("makes every value GSM-7 safe on the way in", () => {
    const [v] = coerceVariables("OWNER_HALL_SUBMITTED", ["₹ Grand Hall 🎉"]);
    expect(isGsm7(v)).toBe(true);
    expect(v).toBe("Rs. Grand Hall");
  });
});

describe("every registered template", () => {
  it("renders GSM-7-safe copy for realistic values", () => {
    for (const key of ALL_SMS_TEMPLATE_KEYS) {
      const values = coerceVariables(key, SMS_TEMPLATES[key].variables.map(() => "Rs.1,00,000"));
      const message = renderTemplate(key, values);
      expect(isGsm7(message), `${key} is not GSM-7 safe: ${message}`).toBe(true);
    }
  });

  it("fits inside two SMS segments with realistic values", () => {
    // Not a style rule — segments are the bill. A template that quietly grew to
    // three segments triples the cost of every booking that uses it.
    for (const key of ALL_SMS_TEMPLATE_KEYS) {
      const values = coerceVariables(key, SMS_TEMPLATES[key].variables.map((n) => `<${n}>`));
      const message = renderTemplate(key, values);
      expect(segmentCount(message), `${key} needs ${segmentCount(message)} segments: ${message}`)
        .toBeLessThanOrEqual(2);
    }
  });

  it("names itself as its own key, so the registry cannot be mis-wired", () => {
    for (const key of ALL_SMS_TEMPLATE_KEYS) {
      expect(SMS_TEMPLATES[key].key).toBe(key);
      expect(SMS_TEMPLATES[key].envVar).toBe(`MSG91_TEMPLATE_${key}`);
    }
  });

  it("declares at least one variable and uses every one it declares", () => {
    for (const key of ALL_SMS_TEMPLATE_KEYS) {
      const t = SMS_TEMPLATES[key];
      expect(t.variables.length).toBeGreaterThan(0);
      // An unused variable means the DLT body has fewer placeholders than the
      // sender fills, and the operator match would fail.
      const body = msg91Body(key);
      t.variables.forEach((_, i) => {
        expect(body, `${key} never uses var${i + 1}`).toContain(`##var${i + 1}##`);
      });
    }
  });

  it("identifies the brand, since a six-character DLT header does not", () => {
    for (const key of ALL_SMS_TEMPLATE_KEYS) {
      expect(renderTemplate(key, coerceVariables(key, [])), key).toMatch(/Hallnect/);
    }
  });

  it("never places two variables back to back", () => {
    // STPL rejected CUSTOMER_PAYMENT_SUCCESS for exactly this: "Please reduce two
    // continuous variable into one." Between adjacent slots the operator has no
    // fixed text to review, so every variable needs static words in front of it.
    for (const key of ALL_SMS_TEMPLATE_KEYS) {
      const adjacent = dltBody(key).match(/\{#var#\}[\s.,;:\-()]*\{#var#\}/);
      expect(adjacent?.[0], `${key} has back-to-back variables: ${adjacent?.[0]}`)
        .toBeUndefined();
    }
  });

  it("contains no URL, which would need separate DLT whitelisting", () => {
    for (const key of ALL_SMS_TEMPLATE_KEYS) {
      expect(dltBody(key), key).not.toMatch(/https?:\/\/|www\./i);
    }
  });
});

describe("the DLT and MSG91 bodies come from the same source as the message", () => {
  it("produces {#var#} for the DLT portal", () => {
    const body = dltBody("OWNER_HALL_REJECTED");
    expect(body).toContain("{#var#}");
    expect(body.match(/\{#var#\}/g)).toHaveLength(
      SMS_TEMPLATES.OWNER_HALL_REJECTED.variables.length,
    );
  });

  it("produces ##varN## for the MSG91 panel, in declaration order", () => {
    const body = msg91Body("CUSTOMER_PAYMENT_SUCCESS");
    const order = [...body.matchAll(/##var(\d+)##/g)].map((m) => Number(m[1]));
    // CUSTOMER_PAYMENT_SUCCESS renders amount (var4) before the ref (var3) —
    // the ORDER IN THE BODY may differ from declaration order, but every
    // declared index must appear exactly once.
    expect([...order].sort((a, b) => a - b))
      .toEqual(SMS_TEMPLATES.CUSTOMER_PAYMENT_SUCCESS.variables.map((_, i) => i + 1));
  });

  it("keeps the same fixed scaffolding in both, so the approved body matches what is sent", () => {
    const skeleton = (s: string) => s.replace(/\{#var#\}|##var\d+##/g, " ");
    for (const key of ALL_SMS_TEMPLATE_KEYS) {
      expect(skeleton(dltBody(key)), key).toBe(skeleton(msg91Body(key)));
    }
  });
});

describe("template id configuration", () => {
  it("accepts a 24-character hex id", () => {
    setTemplate("ADMIN_ALERT", TEMPLATE);
    expect(templateIdFor("ADMIN_ALERT")).toBe(TEMPLATE);
    expect(hasMalformedTemplateId("ADMIN_ALERT")).toBe(false);
  });

  it("treats a wrong-shaped id as MISSING and flags it as malformed", () => {
    // Reported in the dashboard as "invalid", not discovered as a rejected send.
    setTemplate("ADMIN_ALERT", "HX0123456789abcdef0123456789abcd");  // a Twilio SID
    expect(templateIdFor("ADMIN_ALERT")).toBeNull();
    expect(hasMalformedTemplateId("ADMIN_ALERT")).toBe(true);
  });

  it("reports an unset id as neither configured nor malformed", () => {
    expect(templateIdFor("ADMIN_ALERT")).toBeNull();
    expect(hasMalformedTemplateId("ADMIN_ALERT")).toBe(false);
  });

  it("summarises configuration for the admin dashboard without leaking the id", () => {
    setTemplate("ADMIN_ALERT", TEMPLATE);
    const rows = smsTemplateConfigStatus();
    expect(rows).toHaveLength(ALL_SMS_TEMPLATE_KEYS.length);

    const row = rows.find((r) => r.key === "ADMIN_ALERT")!;
    expect(row.configured).toBe(true);
    expect(row.segments).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(TEMPLATE);
  });
});

describe("segmentCount", () => {
  it("counts GSM-7 at 160 for one segment and 153 thereafter", () => {
    expect(segmentCount("a".repeat(160))).toBe(1);
    expect(segmentCount("a".repeat(161))).toBe(2);
    expect(segmentCount("a".repeat(306))).toBe(2);
  });

  it("counts non-GSM-7 at 70 — the whole reason toGsm7 exists", () => {
    expect(segmentCount("₹" + "a".repeat(69))).toBe(1);
    expect(segmentCount("₹" + "a".repeat(70))).toBe(2);
  });
});
