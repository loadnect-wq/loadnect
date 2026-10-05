// ─────────────────────────────────────────────────────────────────────────────
// lib/family-tools.ts — the free planning tools Hallnect offers families, in
// the order a family needs them. Pure data, safe on the client and the server.
//
// ONE LIST, SO EVERY ENTRY POINT AGREES. The homepage section, /tools, the
// Profile tab, the desktop header and the footer all read this, so a tool can
// never be called one thing in one place and something else in another, or be
// added to one surface and forgotten on the rest.
//
// WHY IT EXISTS (2026-10-05). Each tool was built, shipped, and then linked
// only from somewhere a family would already have to know about:
//   * muhurtham dates — the footer, and a link inside the date picker;
//   * the budget planner — the middle of each hall's page, so there was no way
//     to use it before choosing a hall;
//   * the planner — behind sign-in, from the Profile tab and the dashboard;
//   * the saved list — a phone-only tab, so on a computer a family could save
//     a hall and never find it again.
// ─────────────────────────────────────────────────────────────────────────────

export type FamilyToolKey = "muhurtham" | "budget" | "shortlist" | "planner";

export type FamilyTool = {
  key: FamilyToolKey;
  /** The step of planning this tool is for. */
  step: string;
  title: string;
  href: string;
  /** One line on what it does for the family. Every word must be true of the tool today. */
  blurb: string;
  /** The button on a card. */
  cta: string;
  /** Usable without an account. Only the planner needs one: it is shared with the family. */
  noSignIn: boolean;
};

export const TOOLS_PATH = "/tools";
export const BUDGET_PATH = "/budget";

export const FAMILY_TOOLS: readonly FamilyTool[] = [
  {
    key: "muhurtham",
    step: "Fix the date",
    title: "Muhurtham dates",
    href: "/muhurtham-dates",
    blurb: "Tamil wedding muhurtham days for the year ahead, with how many halls are already booked on each.",
    cta: "See the dates",
    noSignIn: true,
  },
  {
    key: "budget",
    step: "Set the budget",
    title: "Budget calculator",
    href: BUDGET_PATH,
    blurb: "Hall rent, food per plate for your guests, decoration and GST: what the whole function will cost.",
    cta: "Work out my budget",
    noSignIn: true,
  },
  {
    key: "shortlist",
    step: "Shortlist halls",
    title: "Shortlist & compare",
    href: "/saved",
    blurb: "Save halls with the heart, compare up to three side by side, and send the list to the family on WhatsApp.",
    cta: "Open my shortlist",
    noSignIn: true,
  },
  {
    key: "planner",
    step: "Plan the rest",
    title: "Function planner",
    href: "/plan",
    blurb: "Caterer, decoration, photos and every payment on one board, with a checklist and family votes.",
    cta: "Start a plan",
    noSignIn: false,
  },
];

export function familyTool(key: FamilyToolKey): FamilyTool {
  return FAMILY_TOOLS.find((t) => t.key === key)!;
}

/** "today", "tomorrow", "in 20 days" — how far off a date is, for the muhurtham card. */
export function daysAway(todayIso: string, iso: string): string {
  const utc = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  const n = Math.round((utc(iso) - utc(todayIso)) / 86_400_000);
  return n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
}
