import { describe, it, expect } from "vitest";
import {
  fiscalYearOf,
  formatInvoiceNumber,
  splitTax,
} from "@/lib/tax-invoice";
import { toPaise } from "@/lib/money";

describe("fiscal year — April to March, not January to December", () => {
  it("puts April through December in the year that started that April", () => {
    expect(fiscalYearOf(new Date("2026-04-01T00:00:00Z"))).toBe("2026-27");
    expect(fiscalYearOf(new Date("2026-09-04T00:00:00Z"))).toBe("2026-27");
    expect(fiscalYearOf(new Date("2026-12-31T23:59:59Z"))).toBe("2026-27");
  });

  it("puts January through March in the year that started the PREVIOUS April", () => {
    // The boundary that silently restarts an invoice series if it is wrong.
    expect(fiscalYearOf(new Date("2027-01-01T00:00:00Z"))).toBe("2026-27");
    expect(fiscalYearOf(new Date("2027-03-31T23:59:59Z"))).toBe("2026-27");
    expect(fiscalYearOf(new Date("2027-04-01T00:00:00Z"))).toBe("2027-28");
  });

  it("handles the decade rollover in the short year", () => {
    expect(fiscalYearOf(new Date("2029-05-01T00:00:00Z"))).toBe("2029-30");
    expect(fiscalYearOf(new Date("2099-05-01T00:00:00Z"))).toBe("2099-00");
  });
});

describe("invoice number — Rule 46(b)", () => {
  it("never exceeds sixteen characters", () => {
    // The rule's hard limit. 99,999 invoices in a year all fit.
    for (const serial of [1, 42, 99_999]) {
      const n = formatInvoiceNumber("2026-27", serial);
      expect(n.length).toBeLessThanOrEqual(16);
    }
  });

  it("is zero-padded so the series sorts and reads as consecutive", () => {
    expect(formatInvoiceNumber("2026-27", 1)).toBe("HN/2026-27/00001");
    expect(formatInvoiceNumber("2026-27", 237)).toBe("HN/2026-27/00237");
  });
});

describe("tax split — the halves must reconcile to the tax actually charged", () => {
  it("splits 18% on a ₹200 fee into ₹18 + ₹18", () => {
    const s = splitTax(200, 18);
    expect(s.cgstAmount).toBe(18);
    expect(s.sgstAmount).toBe(18);
    expect(s.igstAmount).toBe(0);
    expect(s.total).toBe(236);
  });

  it("never loses or invents a paisa on an odd split", () => {
    // The bug this guards: computing CGST and SGST INDEPENDENTLY as
    // round(value * 9%) can produce a pair summing to one paisa more or less
    // than the 18% actually collected. CGST is derived and SGST is the
    // remainder, so the two always sum to the tax charged — on every amount.
    for (const fee of [6.25, 12.5, 93.75, 0.05, 1, 7.77, 199.99, 1234.56]) {
      const s = splitTax(fee, 18);
      const expectedTax = Math.round((toPaise(fee) * 1800) / 10_000);
      expect(toPaise(s.cgstAmount) + toPaise(s.sgstAmount)).toBe(expectedTax);
      expect(toPaise(s.total)).toBe(toPaise(fee) + expectedTax);
    }
  });

  it("matches what the capped fee on a ₹100 hall actually charges", () => {
    // End to end with lib/booking-payment: fee ₹6.25, GST ₹1.13.
    const s = splitTax(6.25, 18);
    expect(toPaise(s.cgstAmount) + toPaise(s.sgstAmount)).toBe(toPaise(1.13));
    expect(s.total).toBe(7.38);
  });

  it("uses IGST alone for an inter-state supply, never both regimes", () => {
    const s = splitTax(200, 18, true);
    expect(s.igstAmount).toBe(36);
    expect(s.igstRate).toBe(18);
    expect(s.cgstAmount).toBe(0);
    expect(s.sgstAmount).toBe(0);
    // The DB constraint enforces the same thing; this pins the code side.
    expect(s.cgstAmount + s.sgstAmount).toBe(0);
  });

  it("always reconciles: taxable + all tax === total", () => {
    for (const [fee, rate, inter] of [
      [200, 18, false], [6.25, 18, false], [4999, 18, true], [0.01, 18, false],
      [1500, 5, false], [750, 12, true],
    ] as const) {
      const s = splitTax(fee, rate, inter);
      expect(toPaise(s.taxableValue) + toPaise(s.cgstAmount) + toPaise(s.sgstAmount)
        + toPaise(s.igstAmount)).toBe(toPaise(s.total));
    }
  });
});
