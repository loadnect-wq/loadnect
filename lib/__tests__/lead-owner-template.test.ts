import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ownerLeadNotification } from "@/lib/notifications/events";
import {
  SMS_TEMPLATES, coerceVariables, renderTemplate, MAX_VARIABLE_LENGTH,
} from "@/lib/notifications/sms-templates";

// ─────────────────────────────────────────────────────────────────────────────
// The interim substitution: while OWNER_NEW_LEAD is awaiting DLT approval, a
// new enquiry is announced on the approved generic owner template.
//
// WHY THIS IS TESTED HARDER THAN ITS SIZE SUGGESTS. It is a branch that nobody
// exercises by hand — it only fires when one env var is absent and another is
// present, which is a state no developer sits in. Get it wrong and a venue is
// silently never told about an enquiry it is being charged commission on;
// get it wrong the other way and the substitution never retires.
// ─────────────────────────────────────────────────────────────────────────────

const REAL = "a".repeat(24);      // shape of a valid 24-hex MSG91 template id
const FALLBACK = "b".repeat(24);

const saved: Record<string, string | undefined> = {};
function setEnv(k: string, v: string | undefined) {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

const LEAD = {
  hallName: "Sri Meenakshi Mahal",
  contactName: "Priya",
  dateLabel: "12 Jan 2027",
  guestLabel: "400",
  contactPhone: "+919876543210",
  ref: "HN-1A2B3C4D",
};

beforeEach(() => {
  setEnv("MSG91_TEMPLATE_OWNER_NEW_LEAD", undefined);
  setEnv("MSG91_TEMPLATE_OWNER_ACCOUNT_STATUS", undefined);
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("ownerLeadNotification — which template carries a new enquiry", () => {
  it("uses the REAL template the moment it is configured", () => {
    setEnv("MSG91_TEMPLATE_OWNER_NEW_LEAD", REAL);
    setEnv("MSG91_TEMPLATE_OWNER_ACCOUNT_STATUS", FALLBACK);
    const r = ownerLeadNotification(LEAD);
    expect(r.templateKey).toBe("OWNER_NEW_LEAD");
    expect(r.substituted).toBe(false);
  });

  it("THE SUBSTITUTION RETIRES ITSELF — no flag, no cleanup", () => {
    // The whole design rests on this: setting one env var ends the interim
    // measure permanently, with no deploy and nobody remembering.
    setEnv("MSG91_TEMPLATE_OWNER_ACCOUNT_STATUS", FALLBACK);
    expect(ownerLeadNotification(LEAD).substituted).toBe(true);

    setEnv("MSG91_TEMPLATE_OWNER_NEW_LEAD", REAL);
    expect(ownerLeadNotification(LEAD).substituted).toBe(false);
  });

  it("falls back to the approved generic template while DLT is pending", () => {
    setEnv("MSG91_TEMPLATE_OWNER_ACCOUNT_STATUS", FALLBACK);
    const r = ownerLeadNotification(LEAD);
    expect(r.templateKey).toBe("OWNER_ACCOUNT_STATUS");
    expect(r.substituted).toBe(true);
  });

  it("records against the REAL template when NEITHER is configured", () => {
    // So the admin centre names the template that is actually missing rather
    // than blaming a stand-in that was never going to be used.
    const r = ownerLeadNotification(LEAD);
    expect(r.templateKey).toBe("OWNER_NEW_LEAD");
    expect(r.substituted).toBe(false);
  });

  it("ignores a MALFORMED template id, exactly as templateIdFor does", () => {
    // A mistyped variable must read as "not configured" and fall through,
    // not as configured-and-broken.
    setEnv("MSG91_TEMPLATE_OWNER_NEW_LEAD", "not-a-real-id");
    setEnv("MSG91_TEMPLATE_OWNER_ACCOUNT_STATUS", FALLBACK);
    expect(ownerLeadNotification(LEAD).templateKey).toBe("OWNER_ACCOUNT_STATUS");
  });
});

describe("the substituted message the venue actually receives", () => {
  beforeEach(() => setEnv("MSG91_TEMPLATE_OWNER_ACCOUNT_STATUS", FALLBACK));

  function rendered() {
    const r = ownerLeadNotification(LEAD);
    return renderTemplate(r.templateKey, coerceVariables(r.templateKey, r.templateVariables));
  }

  it("CARRIES NO PHONE NUMBER — an operator rejected the version that did", () => {
    // Reversed on evidence, not on taste. The first live enquiry put the
    // customer's number in a variable and the carrier refused delivery:
    // MSG91 accepted it, the DLR came back "failed". Operators filter variable
    // content that looks like injected contact details, because that is how a
    // registered template gets used to deliver unregistered content.
    //
    // The number is on the dashboard instead — which the approved body already
    // tells the owner to open — and the dashboard cannot be refused by a third
    // party.
    const msg = rendered();
    expect(msg).not.toContain("+919876543210");
    expect(msg).not.toMatch(/\d{6,}/);
  });

  it("names the venue, the customer and the date", () => {
    const msg = rendered();
    expect(msg).toContain("Sri Meenakshi Mahal");
    expect(msg).toContain("Priya");
    expect(msg).toContain("12 Jan 2027");
  });

  it("keeps every variable within the 30-char DLT cap operators commonly apply", () => {
    // MAX_VARIABLE_LENGTH is 60, which is this codebase's limit, not the
    // carrier's. The rejected message had a 48-character variable.
    const r = ownerLeadNotification(LEAD);
    for (const v of coerceVariables(r.templateKey, r.templateVariables)) {
      expect(v.length, `"${v}" is ${v.length} chars`).toBeLessThanOrEqual(30);
    }
  });

  it("truncates a very long venue name rather than overflowing the cap", () => {
    const r = ownerLeadNotification({ ...LEAD, hallName: "A".repeat(80) });
    for (const v of coerceVariables(r.templateKey, r.templateVariables)) {
      expect(v.length).toBeLessThanOrEqual(30);
    }
  });

  it("keeps the DLT-REGISTERED wording byte-for-byte", () => {
    // The substitution is only legitimate because the approved body is
    // untouched — only the variable VALUES differ. If this ever fails, we are
    // sending something a reviewer did not approve.
    const msg = rendered();
    expect(msg).toContain("Hallnect venue owner account update for your hall listing.");
    expect(msg).toContain("Sign in to your owner dashboard to review it.");
  });

  it("tells the owner it needs an answer", () => {
    expect(rendered()).toContain("New enquiry awaiting reply");
  });

  it("no variable overflows this codebase's own cap either", () => {
    const r = ownerLeadNotification(LEAD);
    for (const v of coerceVariables(r.templateKey, r.templateVariables)) {
      expect(v.length).toBeLessThanOrEqual(MAX_VARIABLE_LENGTH);
    }
  });

  it("reads the same whether or not the lead carries a phone", () => {
    // The message no longer depends on the number, so a lead without one is
    // not a degraded message — it is the same message.
    const withPhone = ownerLeadNotification(LEAD);
    const without = ownerLeadNotification({ ...LEAD, contactPhone: null });
    expect(without.templateVariables).toEqual(withPhone.templateVariables);
    // No empty slot: DLT operators drop messages with blank variables.
    for (const v of coerceVariables(without.templateKey, without.templateVariables)) {
      expect(v.trim()).not.toBe("");
    }
  });

  it("survives a venue name with no GSM-7 form at all", () => {
    // A Tamil venue name filters to nothing under GSM 03.38. The message must
    // still be a sentence, not "New enquiry for ".
    const r = ownerLeadNotification({ ...LEAD, hallName: "திருமணம்" });
    const vars = coerceVariables(r.templateKey, r.templateVariables);
    for (const v of vars) expect(v.trim()).not.toBe("");
  });
});

describe("what is deliberately NOT substituted", () => {
  it("every approved CUSTOMER template says 'hall booking', so none can carry an enquiry", () => {
    // The reason the customer's side waits for DLT. Sending any of these for an
    // enquiry would tell someone their venue is booked when they only asked a
    // question — a false statement about a wedding venue, to the person least
    // able to check it.
    const customerKeys = [
      "CUSTOMER_BOOKING_CREATED", "CUSTOMER_BOOKING_CONFIRMED",
      "CUSTOMER_BOOKING_CANCELLED", "CUSTOMER_PAYMENT_SUCCESS",
      "CUSTOMER_PAYMENT_FAILED", "CUSTOMER_REFUND_INITIATED",
    ] as const;
    for (const key of customerKeys) {
      const body = SMS_TEMPLATES[key].body(SMS_TEMPLATES[key].variables.map(() => "X"));
      expect(body.toLowerCase(), `${key} would be a safe stand-in`).toMatch(/booking|refund|payment/);
    }
  });

  it("the generic owner template is genuinely generic, which is why it fits", () => {
    const t = SMS_TEMPLATES.OWNER_ACCOUNT_STATUS;
    expect(t.variables).toEqual(["item", "status", "detail"]);
    const body = t.body(["X", "Y", "Z"]);
    // Says nothing that a new enquiry would contradict.
    expect(body).not.toMatch(/booking|payment|refund|cancelled/i);
  });
});
