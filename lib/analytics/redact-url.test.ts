import { describe, it, expect } from "vitest";
import { redactUrl } from "./redact-url";

// The point of these is not that the function works — it is that a future edit
// which starts letting identifiers through fails the build instead of quietly
// shipping them to Google.
describe("redactUrl", () => {
  it("strips the Cashfree order id from the payment return URL", () => {
    // The case this whole module exists for: a fresh document load, redirected
    // from Cashfree, carrying a booking uuid AND a payment order id together.
    const r = redactUrl(
      "https://hallnect.com/booking/3f1a2b4c-55d6-4e7f-8a9b-0c1d2e3f4a5b/status?order_id=order_2847ABCdef",
    );
    expect(r.page_path).toBe("/booking/:id/status");
    expect(r.page_location).toBe("https://hallnect.com/booking/:id/status");
    expect(r.page_location).not.toContain("order_");
    expect(r.page_location).not.toContain("3f1a2b4c");
  });

  it("drops every query string, not just known-bad parameter names", () => {
    // An allowlist would leak any parameter added later. This asserts the
    // blunt rule, so replacing it with a filter breaks a test on purpose.
    const r = redactUrl("https://hallnect.com/halls?phone=9876543210&email=a%40b.com&city=madurai");
    expect(r.page_location).toBe("https://hallnect.com/halls");
    expect(r.page_path).toBe("/halls");
  });

  it("redacts a uuid in any segment, not only the second", () => {
    const r = redactUrl("https://hallnect.com/owner/bookings/8c7d6e5f-4a3b-2c1d-9e8f-7a6b5c4d3e2f");
    expect(r.page_path).toBe("/owner/bookings/:id");
  });

  it("redacts uppercase uuids too", () => {
    const r = redactUrl("https://hallnect.com/booking/3F1A2B4C-55D6-4E7F-8A9B-0C1D2E3F4A5B/status");
    expect(r.page_path).toBe("/booking/:id/status");
  });

  it("leaves ordinary marketing paths intact — the reports still have to be useful", () => {
    expect(redactUrl("https://hallnect.com/wedding-halls/madurai").page_path)
      .toBe("/wedding-halls/madurai");
    expect(redactUrl("https://hallnect.com/").page_path).toBe("/");
  });

  it("does not mistake a slug that merely contains hex for an id", () => {
    const r = redactUrl("https://hallnect.com/halls/deadbeef-palace");
    expect(r.page_path).toBe("/halls/deadbeef-palace");
  });

  it("reports nothing rather than the raw string when the URL will not parse", () => {
    const r = redactUrl("not a url at all");
    expect(r.page_location).toBe("");
    expect(r.page_path).toBe("/");
  });

  it("drops the fragment as well", () => {
    const r = redactUrl("https://hallnect.com/premium#pricing?order_id=x");
    expect(r.page_location).toBe("https://hallnect.com/premium");
  });
});
