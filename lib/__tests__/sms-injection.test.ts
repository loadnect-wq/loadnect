// ─────────────────────────────────────────────────────────────────────────────
// lib/__tests__/sms-injection.test.ts
//
// CONTENT INJECTION INTO BRANDED SMS. Every message here leaves from Hallnect's
// DLT-registered sender header, so whatever we interpolate inherits the
// platform's credibility. A venue owner's rejection reason, a hall name and a
// customer's name are all attacker-controlled free text that reaches a
// customer's handset inside an official message.
//
// The template STRUCTURE is never at risk — values only fill ##varN## slots, so
// this is content injection, not template injection. What is at risk is the
// text a recipient reads and believes.
//
// The defect these tests pin down: sanitizeNotificationText ran on the RAW
// string, but the string sent to MSG91 is the GSM-7 form, and toGsm7 DROPS
// every character outside GSM-7. A zero-width space is not \s and not \w, so it
// broke every regex in the sanitizer; toGsm7 then deleted it, reassembling the
// phone number in the delivered message. Sanitising a different string from the
// one you send is the whole bug.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { sanitizeNotificationText, sanitizeName } from "@/lib/notifications/phone";
import { toGsm7 } from "@/lib/notifications/sms-templates";

/** What the recipient actually reads: sanitised, then GSM-7 encoded. */
const delivered = (raw: string) => toGsm7(sanitizeNotificationText(raw) ?? "");

const ZWSP = "​"; // zero-width space
const ZWNJ = "‌";
const ZWJ  = "‍";
const BOM  = "﻿";
const WJ   = "⁠"; // word joiner
const RLM  = "‏";

describe("SMS content injection — zero-width smuggling", () => {
  it("does not let a zero-width space reassemble a phone number", () => {
    // The original bypass. Reads as a normal sentence on the wire; the number
    // only becomes contiguous after toGsm7 drops the invisible character.
    const out = delivered(`Call 98765${ZWSP}43210 to rebook direct and save the advance`);
    expect(out).not.toMatch(/9876543210/);
    expect(out).not.toMatch(/\d{7,}/);
  });

  it.each([
    ["zero-width non-joiner", ZWNJ],
    ["zero-width joiner", ZWJ],
    ["byte-order mark", BOM],
    ["word joiner", WJ],
    ["right-to-left mark", RLM],
    ["soft hyphen", "­"],
  ])("closes the same hole for a %s", (_label, ch) => {
    expect(delivered(`Call 98765${ch}43210 now`)).not.toMatch(/\d{7,}/);
  });

  it("does not let zero-width characters reassemble a domain", () => {
    const out = delivered(`Claim your refund at evil${ZWSP}.com/x right away`);
    expect(out.toLowerCase()).not.toContain("evil.com");
  });

  it("strips a phone number split by punctuation filler", () => {
    // 'digits separated by any filler' is the same attack without needing an
    // invisible character at all.
    for (const filler of [".", "-", " ", "_", "/", ",", ":"]) {
      const out = delivered(`Reach me on 98765${filler}43210 today`);
      expect(out.replace(/\D/g, "")).not.toContain("9876543210");
    }
  });

  it("still refuses the plain forms it always caught", () => {
    expect(delivered("Visit https://evil.link/x now")).not.toContain("evil.link");
    expect(delivered("Visit www.evil.link now")).not.toContain("evil.link");
    expect(delivered("Mail me @attacker now")).not.toContain("@attacker");
    expect(delivered("Call 9876543210 now").replace(/\D/g, "")).not.toContain("9876543210");
  });

  it("leaves a legitimate reason readable — the sanitiser must not eat real text", () => {
    // If this over-strips, owners lose the ability to explain a cancellation
    // and the feature is worse than the vulnerability.
    const out = delivered("Sorry, the hall is under renovation that week");
    expect(out).toBe("Sorry, the hall is under renovation that week");
  });

  it("keeps a short reference number, which is not a phone number", () => {
    // Booking refs are 8 alphanumerics and must survive.
    expect(delivered("Ref ABCD1234 cancelled")).toContain("ABCD1234");
  });

  it("sanitizeName is held to the same standard — it feeds every booking SMS", () => {
    // A hall renamed after approval appears in every message about that hall.
    const out = toGsm7(sanitizeName(`Grand Mahal call 98765${ZWSP}43210`, "your venue"));
    expect(out).not.toMatch(/\d{7,}/);
    expect(toGsm7(sanitizeName("Grand Mahal", "your venue"))).toBe("Grand Mahal");
  });

  it("falls back rather than emitting an empty name when everything is stripped", () => {
    expect(sanitizeName(`${ZWSP}${BOM}`, "your venue")).toBe("your venue");
    expect(sanitizeName("https://evil.link", "your venue")).toBe("your venue");
  });
});
