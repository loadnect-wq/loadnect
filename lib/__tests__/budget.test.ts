import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HALL_GST_PERCENT, budget, budgetSummary, hallTotals, toAmount } from "../budget";
import { BudgetEstimate } from "@/components/budget/BudgetEstimate";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const none = { hallRent: null, guests: null, perPlate: null, meals: 1, decoration: null, other: null, addGst: false };

describe("reading what was typed", () => {
  it("accepts Indian grouping, the rupee sign and spaces; refuses the rest", () => {
    expect(toAmount("1,60,000")).toBe(160000);
    expect(toAmount("₹ 350")).toBe(350);
    expect(toAmount("12.6")).toBe(13);
    for (const bad of ["", "0", "-5", "abc", "1e9", "3 4 5x"]) expect(toAmount(bad), bad).toBeNull();
    expect(toAmount("10001", 10000)).toBeNull();
  });
});

describe("the budget", () => {
  it("adds the hall, catering for every meal, and the family's other costs", () => {
    const b = budget({ ...none, hallRent: 160000, guests: 400, perPlate: 350, meals: 2, decoration: 50000, other: 25000 });
    expect(b.lines.map((l) => [l.key, l.amount])).toEqual([
      ["hall", 160000], ["catering", 280000], ["decoration", 50000], ["other", 25000],
    ]);
    expect(b.lines[1].detail).toBe("400 guests × ₹350 × 2 meals");
    expect(b.total).toBe(515000);
    expect(b.perGuest).toBe(1288);
    expect(b.complete).toBe(true);
  });

  it(`adds ${HALL_GST_PERCENT}% GST to the hall only when the family says its price is before GST`, () => {
    expect(budget({ ...none, hallRent: 160000 }).lines.map((l) => l.key)).toEqual(["hall"]);
    const withGst = budget({ ...none, hallRent: 160000, addGst: true });
    expect(withGst.lines[1]).toMatchObject({ key: "gst", amount: 28800 });
    // No hall price, no GST line, even when ticked.
    expect(budget({ ...none, addGst: true }).lines).toEqual([]);
  });

  it("says 'so far' until both the hall and the food are known", () => {
    expect(budget({ ...none, hallRent: 160000 }).complete).toBe(false);
    expect(budget({ ...none, guests: 400, perPlate: 350 }).complete).toBe(false);
    expect(budget({ ...none, guests: 400 }).lines).toEqual([]); // guests alone count nothing
    expect(budget({ ...none, guests: 400 }).perGuest).toBeNull();
  });

  it("keeps meals between 1 and 3", () => {
    expect(budget({ ...none, guests: 10, perPlate: 100, meals: 9 }).total).toBe(3000);
    expect(budget({ ...none, guests: 10, perPlate: 100, meals: 0 }).total).toBe(1000);
  });

  it("writes the WhatsApp summary line by line, ending with the hall's page", () => {
    const b = budget({ ...none, hallRent: 160000, guests: 400, perPlate: 350, meals: 1 });
    expect(budgetSummary("NS KHALYAANA MAHAL", "full_day", b, "https://hallnect.com/halls/x")).toBe(
      [
        "My budget estimate for NS KHALYAANA MAHAL:",
        "Hall (full day): ₹1,60,000",
        "Catering: ₹1,40,000 (400 guests × ₹350)",
        "Estimated total: ₹3,00,000 (about ₹750 a guest)",
        "https://hallnect.com/halls/x",
      ].join("\n"),
    );
  });
});

describe("comparing totals", () => {
  it("crowns the lowest total among priced halls, never an unpriced one, never a tie", () => {
    expect(hallTotals([160000, 120000, null], 140000)).toEqual({ totals: [300000, 260000, null], lowest: 260000 });
    expect(hallTotals([100000, 100000], 50000).lowest).toBeNull();
    expect(hallTotals([100000, null], 50000).lowest).toBeNull();
    expect(hallTotals([100000, 90000], null)).toEqual({ totals: [null, null], lowest: null });
  });
});

describe("the card", () => {
  it("starts empty: no invented per-plate rate, no total, no share link", () => {
    const html = renderToStaticMarkup(createElement(BudgetEstimate, {
      hallName: "NS KHALYAANA MAHAL", hallSlug: "x", capacityMax: 450, inHouseCatering: true,
      prices: { full_day: 160000, morning: 90000, evening: null },
    }));
    expect(html).toContain("Plan your budget");
    expect(html).toContain("Full day · ₹1,60,000");
    expect(html).toContain("Morning · ₹90,000");
    expect(html).not.toContain("Evening ·");
    expect(html).toContain("This hall lists in-house catering. Ask it for its per-plate rate.");
    expect(html).toContain("Hall (full day)");
    expect(html).toContain("Total so far");
    expect(html).not.toContain("wa.me");
    expect(html).toMatch(/value=""[^>]*placeholder="Ask for a rate"|placeholder="Ask for a rate"[^>]*value=""/);
  });

  it("asks for the quote when the hall publishes no price", () => {
    const html = renderToStaticMarkup(createElement(BudgetEstimate, {
      hallName: "H", hallSlug: "h", capacityMax: 300, inHouseCatering: false,
      prices: { full_day: null, morning: null, evening: null },
    }));
    expect(html).toContain("The hall&#x27;s quote (₹)");
    expect(html).toContain("Ask the hall or your caterer for a per-plate rate.");
    expect(html).toContain("Add guests and a per-plate rate to see the full picture.");
  });

  it("is on the venue page after Pricing, and on the compare page", () => {
    const venue = read("app/halls/[slug]/_components/HallDetailView.tsx");
    expect(venue.indexOf("<BudgetEstimate")).toBeGreaterThan(venue.indexOf(">Pricing</h2>"));
    expect(venue).toContain('inHouseCatering={hall.amenities.some((a) => a.slug === "in-house-catering")}');
    expect(read("app/compare/[code]/page.tsx")).toContain("<CompareBudget");
    expect(read("components/budget/BudgetEstimate.tsx")).toContain("not a quote");
    expect(read("components/compare/CompareBudget.tsx")).toContain("not a quote");
  });
});
