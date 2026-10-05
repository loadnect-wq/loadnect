// ─────────────────────────────────────────────────────────────────────────────
// lib/budget.ts — "what will the whole function cost?" Safe for the client.
//
// The hall price alone is not the budget: catering per plate decides it. The
// venue page's "Plan your budget" card and the compare page's estimate row
// add the hall's listed price to the family's own numbers — guests, per-plate
// rate, meals, decoration — and show a total and a cost per guest.
//
// NOTHING HERE IS A QUOTE. The only number Hallnect supplies is the hall's
// listed price; every other figure is the family's. There is deliberately no
// default per-plate rate: a number we made up would read as a claim about
// what food costs at this hall. GST is added only when the family says the
// hall's price is before GST, because small halls are often not registered
// and quote a final figure.
// ─────────────────────────────────────────────────────────────────────────────

import { formatPrice } from "@/lib/mock-data";

/** GST on renting a hall for an event, for a hall that charges it. */
export const HALL_GST_PERCENT = 18;

export const MAX_GUESTS = 10_000;
export const MAX_MEALS = 3;

export type HallSlot = "full_day" | "morning" | "evening";

export const SLOT_LABEL: Record<HallSlot, string> = {
  full_day: "Full day",
  morning: "Morning",
  evening: "Evening",
};

/**
 * A positive whole rupee amount from what was typed ("1,60,000", "₹ 350"),
 * or null for blank, zero, negative or absurd input.
 */
export function toAmount(raw: string | null | undefined, max = 1_00_00_00_000): number | null {
  if (!raw) return null;
  const digits = raw.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const n = Math.round(Number(digits));
  return n > 0 && n <= max ? n : null;
}

export type BudgetInput = {
  /** The hall's price for the chosen slot, or the family's quote; null when neither is known. */
  hallRent: number | null;
  guests: number | null;
  perPlate: number | null;
  meals: number;
  decoration: number | null;
  other: number | null;
  /** Add GST to the hall rent: the family says the hall's price is before GST. */
  addGst: boolean;
};

export type BudgetLine = { key: string; label: string; amount: number; detail?: string };

export type Budget = {
  lines: BudgetLine[];
  total: number;
  /** Total ÷ guests, when guests are known and something is being counted. */
  perGuest: number | null;
  /** Hall rent and catering are both known — the two numbers that make a budget. */
  complete: boolean;
};

export function budget(input: BudgetInput): Budget {
  const lines: BudgetLine[] = [];
  const meals = Math.min(Math.max(Math.round(input.meals) || 1, 1), MAX_MEALS);

  if (input.hallRent != null) {
    lines.push({ key: "hall", label: "Hall", amount: input.hallRent });
    if (input.addGst) {
      lines.push({
        key: "gst",
        label: `GST on the hall (${HALL_GST_PERCENT}%)`,
        amount: Math.round((input.hallRent * HALL_GST_PERCENT) / 100),
      });
    }
  }

  const catering = input.guests != null && input.perPlate != null ? input.guests * input.perPlate * meals : null;
  if (catering != null) {
    lines.push({
      key: "catering",
      label: "Catering",
      amount: catering,
      detail: `${input.guests!.toLocaleString("en-IN")} guests × ${formatPrice(input.perPlate!)}${meals > 1 ? ` × ${meals} meals` : ""}`,
    });
  }
  if (input.decoration != null) lines.push({ key: "decoration", label: "Decoration", amount: input.decoration });
  if (input.other != null) lines.push({ key: "other", label: "Other costs", amount: input.other });

  const total = lines.reduce((s, l) => s + l.amount, 0);
  return {
    lines,
    total,
    perGuest: input.guests && total > 0 ? Math.round(total / input.guests) : null,
    complete: input.hallRent != null && catering != null,
  };
}

/**
 * The plain-text summary that goes to the family on WhatsApp, in the sender's
 * voice and with the hall's page at the end.
 */
export function budgetSummary(hallName: string, slot: HallSlot, b: Budget, url: string): string {
  return [`My budget estimate for ${hallName}:`, ...summaryRows(b, `Hall (${SLOT_LABEL[slot].toLowerCase()})`), url].join("\n");
}

/**
 * The same summary from the standalone calculator (/budget), where there is no
 * one hall yet: the family's own hall price, and a link for the relatives to
 * work out theirs.
 */
export function functionBudgetSummary(b: Budget, url: string): string {
  return ["Our function budget estimate:", ...summaryRows(b, "Hall"), `Work it out on Hallnect: ${url}`].join("\n");
}

function summaryRows(b: Budget, hallLabel: string): string[] {
  const rows = b.lines.map((l) => {
    const label = l.key === "hall" ? hallLabel : l.label;
    return `${label}: ${formatPrice(l.amount)}${l.detail ? ` (${l.detail})` : ""}`;
  });
  const total = `${b.complete ? "Estimated total" : "Total so far"}: ${formatPrice(b.total)}${
    b.perGuest ? ` (about ${formatPrice(b.perGuest)} a guest)` : ""
  }`;
  return [...rows, total];
}

/**
 * Each hall's full-day price plus the same catering, and the lowest of those
 * totals — only among halls with a published price, and only when they
 * differ (the comparison's rule for every badge).
 */
export function hallTotals(
  prices: readonly (number | null)[],
  catering: number | null,
): { totals: (number | null)[]; lowest: number | null } {
  const totals = prices.map((p) => (p != null && p > 0 && catering != null ? p + catering : null));
  const real = totals.filter((t): t is number => t != null);
  const min = real.length ? Math.min(...real) : null;
  const lowest = real.length >= 2 && min != null && !real.every((t) => t === min) ? min : null;
  return { totals, lowest };
}
