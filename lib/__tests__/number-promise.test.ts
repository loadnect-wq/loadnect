import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL_LAST_UPDATED } from "../content";

// "No spam calls." sits next to the phone box on the enquiry and booking forms.
// Each clause must stay true, so each one is pinned to the thing that makes it
// true. If a test here fails, the promise and the system have drifted apart.

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const promise = read("components/trust/NumberPromise.tsx");
const enquiry = read("app/enquiry/[slug]/_components/EnquiryFlow.tsx");
const booking = read("app/book/[slug]/_components/BookingFlow.tsx");
const privacy = read("app/(legal)/privacy/page.tsx");
const leadPolicy = read("supabase/migrations/0074_lead_policy_initplan.sql");

describe("the promise", () => {
  it("is on both forms, with the right wording for each", () => {
    expect(enquiry).toContain('<NumberPromise hallName={hall.name} flow="enquiry"');
    expect(booking).toContain('<NumberPromise hallName={hall.name} flow="booking"');
  });

  it("says 'only after you verify it' for enquiries alone", () => {
    expect(promise).toContain('flow === "enquiry" ? ", and only after you verify it" : ""');
  });

  it("links to the clause it is based on", () => {
    expect(promise).toContain('href="/privacy#sharing"');
  });
});

describe("what makes each clause true", () => {
  it("'only after you verify it': a venue cannot read an unverified enquiry", () => {
    expect(leadPolicy).toMatch(/owns_hall\(hall_id\) and phone_verified/);
  });

  it("'we never sell it': the privacy policy says so", () => {
    expect(privacy).toContain("We do not sell your personal data to third parties.");
  });

  it("'or share it with other halls': section 5(a) names one venue, and covers enquiries", () => {
    expect(privacy).toContain('<Section title="5. Data Sharing" id="sharing">');
    expect(privacy).toContain("(a) the venue you choose, and no other venue");
    expect(privacy).toContain("when you send an enquiry, your name, event details and verified phone number are shared with that venue");
    expect(privacy).toContain("other than replying to your enquiry or fulfilling your booking");
  });

  it("dates the policy change, so the page and the sitemap say it changed", () => {
    expect(LEGAL_LAST_UPDATED["/privacy"] >= "2026-10-02").toBe(true);
  });
});
