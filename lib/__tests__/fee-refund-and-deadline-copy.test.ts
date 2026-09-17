import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Customer-facing copy must match what the refund code does and what the
// Refund / Cancellation policies say: the platform fee is kept only on a
// CUSTOMER cancellation (lib/refunds.ts), and returned when the venue declines,
// cancels or lets the 48-hour window lapse. The checkout once said simply
// "non-refundable" while the payment-success page promised it back.

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("platform fee refund wording", () => {
  const surfaces = ["app/book/[slug]/_components/BookingFlow.tsx", "app/customer/bookings/[id]/page.tsx"];
  for (const f of surfaces) {
    it(`${f} scopes "non-refundable" to a customer cancellation`, () => {
      const src = read(f).replace(/\s+/g, " ");
      expect(src).not.toMatch(/and is non-refundable\.|and non-refundable\./);
      expect(src).toContain("non-refundable if you cancel");
      expect(src).toMatch(/refunded in full if the venue declines, cancels or does not respond/);
    });
  }

  it("matches the refund code: only a customer cancellation keeps the fee", () => {
    const refunds = read("lib/refunds.ts");
    expect(refunds).toContain('initiator === "owner" ? "Venue" : "Platform"}-initiated cancellation — full refund');
  });
});

describe("owner response countdown", () => {
  it("shows days and hours so a fresh 48-hour window never reads as 1 day", () => {
    const src = read("app/owner/(dashboard)/bookings/_components/BookingActions.tsx");
    expect(src).toContain("`Respond within ${Math.floor(hours / 24)}d ${hours % 24}h`");
    expect(src).not.toContain("`Respond within ${Math.floor(hours / 24)}d`");
  });
});
