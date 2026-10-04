// ─────────────────────────────────────────────────────────────────────────────
// lib/plan.ts — the family's event plan (Event Platform, phase 1). Shared
// rules, labels, templates and arithmetic; safe for the client. Data access
// is lib/plan.server.ts; the tables are supabase/migrations/0110_event_plans.sql.
//
// One plan per function. A board with one item per category (hall, catering,
// decoration, …), each moving from "to do" to "booked", with the family's own
// planned, quoted and paid amounts, and a checklist made from a template for
// the occasion. Every amount here is the family's own number; the only figure
// Hallnect supplies is a hall's listed price, offered as a starting point.
// ─────────────────────────────────────────────────────────────────────────────

export const PLAN_CATEGORIES = [
  { key: "hall",         label: "Hall",                hint: "The venue, and the date it holds" },
  { key: "catering",     label: "Catering",            hint: "Food for every meal" },
  { key: "decoration",   label: "Decoration",          hint: "Stage, entrance and flowers" },
  { key: "photo_video",  label: "Photo and video",     hint: "Photographer, videographer and album" },
  { key: "makeup",       label: "Makeup and mehendi",  hint: "For the bride, the groom and the family" },
  { key: "music",        label: "Music",               hint: "Nadaswaram and melam, a band or a DJ" },
  { key: "invitations",  label: "Invitations",         hint: "Printing, and giving them out" },
  { key: "return_gifts", label: "Return gifts",        hint: "Thamboolam bags and gifts for guests" },
  { key: "priest",       label: "Priest and rituals",  hint: "The priest and what the rituals need" },
  { key: "transport",    label: "Cars and transport",  hint: "Cars for the families and guests" },
  { key: "other",        label: "Other",               hint: "Clothes, jewellery and anything else" },
] as const;

export type PlanCategory = (typeof PLAN_CATEGORIES)[number]["key"];
export const PLAN_CATEGORY_KEYS = PLAN_CATEGORIES.map((c) => c.key) as PlanCategory[];

export function categoryLabel(key: string): string {
  return PLAN_CATEGORIES.find((c) => c.key === key)?.label ?? "Other";
}

export const ITEM_STATUSES = ["todo", "shortlisted", "asked", "visited", "booked", "not_needed"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const STATUS_LABEL: Record<ItemStatus, string> = {
  todo: "To do",
  shortlisted: "Shortlisted",
  asked: "Asked for a quote",
  visited: "Visited or tasted",
  booked: "Booked",
  not_needed: "Not needed",
};

// ── Templates ────────────────────────────────────────────────────────────────

export type PlanTemplate = "wedding" | "celebration" | "work";

const CELEBRATIONS = new Set([
  "reception", "engagement", "birthday-party", "party", "baby-shower", "banquet", "anniversary",
  "naming-ceremony", "family-function", "private-event", "religious-function", "cultural-event",
  "community-event",
]);

/** Which checklist and which categories an occasion starts with. Unknown occasions get the shortest. */
export function templateFor(occasion: string): PlanTemplate {
  if (occasion === "wedding") return "wedding";
  return CELEBRATIONS.has(occasion) ? "celebration" : "work";
}

/** Categories a new plan starts with; the rest start as "not needed" and can be switched on. */
export const DEFAULT_CATEGORIES: Record<PlanTemplate, readonly PlanCategory[]> = {
  wedding: PLAN_CATEGORY_KEYS,
  celebration: ["hall", "catering", "decoration", "photo_video", "invitations", "return_gifts", "other"],
  work: ["hall", "catering", "other"],
};

export type TemplateTask = { key: string; title: string; category: PlanCategory | null; offsetDays: number };

/**
 * Starting checklists, due a number of days before the function. A starting
 * point the family edits, not a ritual calendar: worded so that it fits
 * families of any community, and to be checked by a local planner before it
 * is promoted. Keys are permanent — the database keeps one row per key per
 * plan.
 */
export const TEMPLATE_TASKS: Record<PlanTemplate, readonly TemplateTask[]> = {
  wedding: [
    { key: "w-halls-visit",     title: "Visit halls and shortlist two or three",       category: "hall",         offsetDays: 270 },
    { key: "w-hall-book",       title: "Book the hall",                                category: "hall",         offsetDays: 240 },
    { key: "w-caterer-book",    title: "Book the caterer and fix the menu",            category: "catering",     offsetDays: 210 },
    { key: "w-photo-book",      title: "Book the photographer and videographer",       category: "photo_video",  offsetDays: 180 },
    { key: "w-decor-book",      title: "Book the decorator",                           category: "decoration",   offsetDays: 150 },
    { key: "w-music-book",      title: "Book the music: nadaswaram and melam, or a band", category: "music",     offsetDays: 120 },
    { key: "w-priest-book",     title: "Book the priest for the rituals",              category: "priest",       offsetDays: 120 },
    { key: "w-makeup-book",     title: "Book makeup and mehendi",                      category: "makeup",       offsetDays: 90 },
    { key: "w-invites-order",   title: "Order the invitations",                        category: "invitations",  offsetDays: 90 },
    { key: "w-clothes",         title: "Shop for wedding clothes and jewellery",       category: "other",        offsetDays: 60 },
    { key: "w-invites-give",    title: "Start giving invitations",                     category: "invitations",  offsetDays: 45 },
    { key: "w-gifts-order",     title: "Order return gifts",                           category: "return_gifts", offsetDays: 45 },
    { key: "w-cars-book",       title: "Book cars for the families",                   category: "transport",    offsetDays: 30 },
    { key: "w-final-count",     title: "Give the caterer the final guest count",       category: "catering",     offsetDays: 21 },
    { key: "w-balances",        title: "Check what is still due to each vendor",       category: null,           offsetDays: 14 },
    { key: "w-confirm-times",   title: "Confirm timings with every vendor",            category: null,           offsetDays: 7 },
    { key: "w-payments-ready",  title: "Keep balance payments and receipts ready",     category: null,           offsetDays: 1 },
  ],
  celebration: [
    { key: "c-hall-book",       title: "Book the hall",                                category: "hall",         offsetDays: 60 },
    { key: "c-caterer-book",    title: "Book the caterer and fix the menu",            category: "catering",     offsetDays: 45 },
    { key: "c-decor-book",      title: "Book the decorator",                           category: "decoration",   offsetDays: 30 },
    { key: "c-photo-book",      title: "Book the photographer",                        category: "photo_video",  offsetDays: 30 },
    { key: "c-invites",         title: "Send the invitations",                         category: "invitations",  offsetDays: 30 },
    { key: "c-gifts-order",     title: "Order return gifts",                           category: "return_gifts", offsetDays: 21 },
    { key: "c-final-count",     title: "Give the caterer the final guest count",       category: "catering",     offsetDays: 7 },
    { key: "c-confirm-times",   title: "Confirm timings with every vendor",            category: null,           offsetDays: 2 },
  ],
  work: [
    { key: "k-hall-book",       title: "Book the hall",                                category: "hall",         offsetDays: 45 },
    { key: "k-caterer-book",    title: "Book the catering",                            category: "catering",     offsetDays: 30 },
    { key: "k-attendees",       title: "Confirm the number of attendees",              category: null,           offsetDays: 14 },
    { key: "k-final-count",     title: "Give the caterer the final count",             category: "catering",     offsetDays: 7 },
    { key: "k-setup",           title: "Confirm the setup and timings with the hall",  category: "hall",         offsetDays: 2 },
  ],
};

// ── Dates ────────────────────────────────────────────────────────────────────

function isoMinusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - days));
  return t.toISOString().slice(0, 10);
}

/** A task's due date: its own date, or so many days before the function, or null while the date is not fixed. */
export function taskDueDate(task: { dueDate: string | null; offsetDays: number | null }, eventDate: string | null): string | null {
  if (task.dueDate) return task.dueDate;
  if (eventDate && task.offsetDays != null) return isoMinusDays(eventDate, task.offsetDays);
  return null;
}

/** "9 months before", "3 weeks before", "1 day before". */
export function offsetLabel(days: number): string {
  if (days >= 60) {
    const months = Math.round(days / 30);
    return `${months} months before`;
  }
  if (days >= 14) return `${Math.round(days / 7)} weeks before`;
  return days === 1 ? "1 day before" : `${days} days before`;
}

/** Whole days from today to the function; negative once it has passed. */
export function daysUntil(eventDate: string, today: string): number {
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(eventDate) - toUtc(today)) / 86_400_000);
}

export function countdownLabel(eventDate: string | null, today: string): string {
  if (!eventDate) return "Date not fixed yet";
  const n = daysUntil(eventDate, today);
  if (n > 1) return `in ${n.toLocaleString("en-IN")} days`;
  if (n === 1) return "tomorrow";
  if (n === 0) return "today";
  return "already held";
}

// ── Money ────────────────────────────────────────────────────────────────────

export type PlanItemAmounts = {
  status: ItemStatus;
  plannedAmount: number | null;
  quotedAmount: number | null;
  paidAmount: number | null;
};

export type PlanTotals = {
  /** Agreed prices of booked items (their quote, or the planned figure if no quote was entered). */
  booked: number;
  /** Planned figures for items still to book. */
  toBook: number;
  /** What the function is expected to cost: booked plus still to book. */
  expected: number;
  paid: number;
  /** What booked vendors are still owed. */
  stillToPay: number;
  /** Budget minus expected; negative when over. Null without a budget. */
  left: number | null;
  /** Items in play (not "not needed"), and how many of them are booked. */
  activeCount: number;
  bookedCount: number;
};

export function planTotals(items: readonly PlanItemAmounts[], budget: number | null): PlanTotals {
  const active = items.filter((i) => i.status !== "not_needed");
  const bookedItems = active.filter((i) => i.status === "booked");
  const agreed = (i: PlanItemAmounts) => i.quotedAmount ?? i.plannedAmount ?? 0;
  const booked = bookedItems.reduce((s, i) => s + agreed(i), 0);
  const toBook = active.filter((i) => i.status !== "booked").reduce((s, i) => s + (i.plannedAmount ?? i.quotedAmount ?? 0), 0);
  const paid = active.reduce((s, i) => s + (i.paidAmount ?? 0), 0);
  const stillToPay = bookedItems.reduce((s, i) => s + Math.max(agreed(i) - (i.paidAmount ?? 0), 0), 0);
  const expected = booked + toBook;
  return {
    booked,
    toBook,
    expected,
    paid,
    stillToPay,
    left: budget != null ? budget - expected : null,
    activeCount: active.length,
    bookedCount: bookedItems.length,
  };
}

/** Paid in full: booked, with an agreed price, and that price paid. */
export function paidInFull(i: PlanItemAmounts): boolean {
  const agreed = i.quotedAmount ?? i.plannedAmount;
  return i.status === "booked" && agreed != null && agreed > 0 && (i.paidAmount ?? 0) >= agreed;
}

/** Limits that keep one account's plans a family's, not a database. */
export const MAX_PLANS = 10;
export const MAX_TASKS = 120;

// ── Sharing and votes (0111) ─────────────────────────────────────────────────
//
// The owner shares a plan through a link. Everyone who joins can see it and
// vote; the owner makes some of them editors. Each category can hold a few
// options (three halls, two caterers), and each person has one vote per
// category, so the family's favourite is a count, not a guess.

export type PlanRole = "owner" | "editor" | "viewer";

/** People besides the owner. join_event_plan() refuses the twenty-first. */
export const MAX_MEMBERS = 20;
/** Options per category: enough to compare, few enough to decide. */
export const MAX_OPTIONS = 8;

export function canEdit(role: PlanRole | null | undefined): boolean {
  return role === "owner" || role === "editor";
}

export const ROLE_LABEL: Record<PlanRole, string> = {
  owner: "Started the plan",
  editor: "Can edit",
  viewer: "Can view and vote",
};

/** The token in an invite link: 16 random bytes, base64url. Matches 0111's check. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

export function invitePath(token: string): string {
  return `/plan/join/${token}`;
}

/** A name as the plan shows it; a profile without one is still somebody. */
export function personName(name: string | null | undefined): string {
  return name?.trim() || "A family member";
}

export type VoteRow = { optionId: string; userId: string };

/** Who voted for each option. */
export function votersByOption(votes: readonly VoteRow[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const v of votes) out.set(v.optionId, [...(out.get(v.optionId) ?? []), v.userId]);
  return out;
}

/** The option with the most votes, or null when nobody has voted or the top is a tie. */
export function leadingOption<T extends { id: string }>(
  options: readonly T[],
  votes: readonly VoteRow[],
): { option: T; votes: number } | null {
  const voters = votersByOption(votes);
  const ranked = options
    .map((option) => ({ option, votes: voters.get(option.id)?.length ?? 0 }))
    .sort((a, b) => b.votes - a.votes);
  if (!ranked[0] || ranked[0].votes === 0) return null;
  if (ranked[1] && ranked[1].votes === ranked[0].votes) return null;
  return ranked[0];
}

export type PlanSummaryInput = {
  title: string;
  occasionName: string;
  eventDate: string | null;
  today: string;
  city: string | null;
  guests: number | null;
  items: readonly { category: PlanCategory; status: ItemStatus; chosen: string | null }[];
  totals: PlanTotals;
  budget: number | null;
  tasksDone: number;
  tasksTotal: number;
  /** Categories where the family vote has a clear leader. */
  leaders: readonly { category: PlanCategory; name: string; votes: number }[];
};

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The plan as a WhatsApp message for the family group: what is booked, what
 * is left, how the votes stand and where the money is. The sender sees it in
 * WhatsApp before it goes, and it carries no link that grants access.
 */
export function planSummaryText(s: PlanSummaryInput): string {
  const lines: string[] = [`*${s.title}*`];
  const when = s.eventDate
    ? (() => {
        const [y, m, d] = s.eventDate.split("-").map(Number);
        return `${d} ${EN_MONTHS[m - 1]} ${y} (${countdownLabel(s.eventDate, s.today)})`;
      })()
    : "Date not fixed yet";
  lines.push(`${s.occasionName} · ${when}`);
  const where = [s.city, s.guests ? `${s.guests.toLocaleString("en-IN")} guests` : null].filter(Boolean).join(" · ");
  if (where) lines.push(where);

  const active = s.items.filter((i) => i.status !== "not_needed");
  const booked = active.filter((i) => i.status === "booked");
  const open = active.filter((i) => i.status !== "booked");
  lines.push("");
  if (booked.length) {
    lines.push(`Booked: ${booked.map((i) => (i.chosen ? `${categoryLabel(i.category)} (${i.chosen})` : categoryLabel(i.category))).join(", ")}`);
  }
  if (open.length) lines.push(`Still to arrange: ${open.map((i) => categoryLabel(i.category)).join(", ")}`);
  if (!booked.length && !open.length) lines.push("Nothing on the board yet.");
  for (const l of s.leaders) {
    lines.push(`Family vote, ${categoryLabel(l.category).toLowerCase()}: ${l.name} leads with ${l.votes} ${l.votes === 1 ? "vote" : "votes"}`);
  }

  const money: string[] = [];
  if (s.budget != null) money.push(`Budget ${rupees(s.budget)}`);
  if (s.totals.expected > 0) money.push(`expected ${rupees(s.totals.expected)}`);
  if (s.totals.paid > 0) money.push(`paid ${rupees(s.totals.paid)}`);
  if (money.length) {
    lines.push("");
    lines.push(`${money.join(", ").replace(/^./, (c) => c.toUpperCase())}.`);
  }
  if (s.tasksTotal > 0) lines.push(`Checklist: ${s.tasksDone} of ${s.tasksTotal} done.`);
  lines.push("");
  lines.push("The plan on Hallnect:");
  return lines.join("\n");
}
