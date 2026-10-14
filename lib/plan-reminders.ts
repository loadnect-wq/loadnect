// ─────────────────────────────────────────────────────────────────────────────
// lib/plan-reminders.ts — what an event plan's morning reminder says, and when
// there is one. Pure and safe for the client; the sender is
// lib/plan-reminders.server.ts and the table is migration 0116.
//
// MILESTONES, NOT A DAILY LIST. A reminder goes out only on a day something
// reaches a milestone:
//   * a vendor payment is due TODAY,
//   * a vendor payment is due in REMINDER_LEAD_DAYS days (time to arrange it),
//   * a checklist task is due TODAY.
// An overdue item is NOT repeated every morning. A family that ignored a
// reminder does not want the same one daily, and the plan page already shows
// what is overdue. A quiet day sends nothing at all.
//
// THE MESSAGE NAMES THE CATEGORY, NEVER THE VENDOR. "Catering ₹20,000 due" and
// not the caterer's name or number: a notification can show on a locked
// screen, and the plan's details belong on the plan page.
// ─────────────────────────────────────────────────────────────────────────────

import { addDaysToIsoDate } from "@/lib/dates";
import { formatDiaryDay } from "@/lib/diary";
import { categoryLabel, taskDueDate } from "@/lib/plan";

/** How many days ahead of a payment the early reminder goes out. */
export const REMINDER_LEAD_DAYS = 3;

/** One phone may take reminders for this many plans. */
export const MAX_REMINDER_PLANS_PER_DEVICE = 10;

export type ReminderItem = {
  category: string;
  status: string;
  nextDueDate: string | null;
  nextDueAmount: number | null;
};

export type ReminderTask = {
  title: string;
  dueDate: string | null;
  offsetDays: number | null;
  doneAt: string | null;
};

export type Reminder = { kind: "payment-today" | "task-today" | "payment-soon"; text: string };

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Today's reminders for one plan, most urgent first. Empty on a quiet day. */
export function planReminders(input: {
  eventDate: string | null;
  items: readonly ReminderItem[];
  tasks: readonly ReminderTask[];
  today: string;
}): Reminder[] {
  const { eventDate, items, tasks, today } = input;
  // The function is over: nothing left to remind anyone about.
  if (eventDate && eventDate < today) return [];
  const soon = addDaysToIsoDate(today, REMINDER_LEAD_DAYS);

  const out: Reminder[] = [];
  for (const i of items) {
    if (i.status === "not_needed" || !i.nextDueDate) continue;
    const what = categoryLabel(i.category);
    const amount = i.nextDueAmount != null && i.nextDueAmount > 0 ? ` ${inr(i.nextDueAmount)}` : "";
    if (i.nextDueDate === today) {
      out.push({ kind: "payment-today", text: amount ? `Pay ${what}${amount} today` : `${what} payment due today` });
    } else if (i.nextDueDate === soon) {
      out.push({ kind: "payment-soon", text: `${what}${amount || " payment"} due ${formatDiaryDay("en", soon)}` });
    }
  }
  for (const t of tasks) {
    if (t.doneAt) continue;
    if (taskDueDate({ dueDate: t.dueDate, offsetDays: t.offsetDays }, eventDate) === today) {
      out.push({ kind: "task-today", text: `Today: ${t.title}` });
    }
  }

  const rank: Record<Reminder["kind"], number> = { "payment-today": 0, "task-today": 1, "payment-soon": 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/**
 * The notification, or null when there is nothing to say. Kept short: Android
 * shows about two lines of body, so two reminders are named and the rest
 * counted. Tapping it opens the plan.
 */
export function reminderMessage(plan: { id: string; title: string }, reminders: readonly Reminder[], today: string) {
  if (reminders.length === 0) return null;
  const named = reminders.slice(0, 2).map((r) => r.text);
  const more = reminders.length - named.length;
  return {
    title: plan.title,
    body: named.join(" · ") + (more > 0 ? ` · and ${more} more` : ""),
    url: `/plan/${plan.id}`,
    // One notification per plan per day: a resend replaces it rather than stacking.
    tag: `plan-reminder-${plan.id}-${today}`,
  };
}

/** Which plans this browser turned reminders on for, for the card's state only. */
export const REMINDERS_STORAGE_KEY = "hallnect:plan-reminders";
