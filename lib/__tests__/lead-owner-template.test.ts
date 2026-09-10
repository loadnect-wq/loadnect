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

  it("THE CUSTOMER'S PHONE SURVIVES — it is the thing the venue paid for", () => {
    // The one value that must not be lost. sanitizeNotificationText strips runs
    // of 7+ digits from free text, so a careless refactor that routed this
    // through it would deliver a message with the number filed off.
    expect(rendered()).toContain("+919876543210");
  });

  it("names the venue, the customer and the date", () => {
    const msg = rendered();
    expect(msg).toContain("Sri Meenakshi Mahal");
    expect(msg).toContain("Priya");
    expect(msg).toContain("12 Jan 2027");
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
    expect(rendered()).toContain("Awaiting your reply");
  });

  it("no variable overflows the DLT length cap, so nothing truncates mid-number", () => {
    const r = ownerLeadNotification(LEAD);
    for (const v of coerceVariables(r.templateKey, r.templateVariables)) {
      expect(v.length).toBeLessThanOrEqual(MAX_VARIABLE_LENGTH);
      expect(v).not.toContain("...");
    }
  });

  it("still says something useful when the lead carries no phone", () => {
    const r = ownerLeadNotification({ ...LEAD, contactPhone: null });
    const msg = renderTemplate(r.templateKey, coerceVariables(r.templateKey, r.templateVariables));
    expect(msg).toContain("Priya");
    expect(msg).toContain(LEAD.ref);
    // No empty slot: DLT operators drop messages with blank variables.
    for (const v of coerceVariables(r.templateKey, r.templateVariables)) {
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
