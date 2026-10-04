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
