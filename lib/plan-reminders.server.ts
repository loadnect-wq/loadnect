// ─────────────────────────────────────────────────────────────────────────────
// lib/plan-reminders.server.ts — event plan reminders, the server half.
// SERVER-ONLY. Rules and wording are lib/plan-reminders.ts; the table is 0116.
//
//   savePlanReminder / removePlanReminder   the plan page's server actions
//   processPlanReminders                    the morning cron
//
// ACCESS IS CHECKED TWICE. When a phone is turned on, the caller's OWN session
// must be able to read the plan (RLS, plan_access). Every morning, the sender
// re-checks that the person still owns or belongs to the plan and that their
// account is active: a family member who was removed, or an account that was
// suspended, stops hearing about the plan the next morning.
//
// PUSH ERRORS as in date alerts: 404/410 means the phone unsubscribed and the
// row is deleted; anything else is transient, so the day's claim is released
// and the second morning run retries. A row that keeps failing is dropped.
//
// Reuses the date-alert VAPID pair and push helpers: one key pair, one service
// worker, one set of allowed push hosts.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import webpush from "web-push";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { addDaysToIsoDate, todayInBusinessTz } from "@/lib/dates";
import { hasValidPushKeys, pushConfig, pushOptions, type PushSender } from "@/lib/date-alerts.server";
import { MAX_REMINDER_PLANS_PER_DEVICE, planReminders, reminderMessage } from "@/lib/plan-reminders";

const MAX_FAILURES = 5;
/** Subscriptions looked at per run; real use is far below it. */
const SUBS_PER_RUN = 2000;
/** A plan's reminders are deleted this many days after its function. */
const KEEP_AFTER_EVENT_DAYS = 7;
/** Plans per .in() read, so the request URL stays short. */
const CHUNK = 100;

const TABLE = "event_plan_reminder_subscriptions";

type Result = { ok: true } | { ok: false; error: string };

// ── Turning reminders on and off ─────────────────────────────────────────────

/**
 * `sessionDb` is the caller's own session client: if it cannot read the plan,
 * the caller has no access and nothing is written. The row is then written with
 * the service role, because the table has no client grants at all.
 */
export async function savePlanReminder(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionDb: any;
  userId: string;
  planId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<Result> {
  if (!hasValidPushKeys(input.p256dh, input.auth)) {
    return { ok: false, error: "This browser's notification service isn't supported." };
  }

  const { data: plan, error: planErr } = await input.sessionDb
    .from("event_plans").select("id").eq("id", input.planId).maybeSingle();
  if (planErr) {
    console.error("[plan-reminders] access check failed:", planErr.code, planErr.message);
    return { ok: false, error: "Could not turn reminders on. Please try again." };
  }
  if (!plan) return { ok: false, error: "This plan is no longer shared with you." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;

  const { data: existing, error: findErr } = await db
    .from(TABLE).select("id")
    .eq("plan_id", input.planId).eq("user_id", input.userId).eq("endpoint", input.endpoint)
    .maybeSingle();
  if (findErr) {
    console.error("[plan-reminders] lookup failed:", findErr.code, findErr.message);
    return { ok: false, error: "Could not turn reminders on. Please try again." };
  }
  // Already on for this phone: refresh its keys (a browser can rotate them).
  if (existing) {
    const { error } = await db.from(TABLE)
      .update({ p256dh: input.p256dh, auth: input.auth, failure_count: 0 }).eq("id", existing.id);
    if (error) {
      console.error("[plan-reminders] refresh failed:", error.code, error.message);
      return { ok: false, error: "Could not turn reminders on. Please try again." };
    }
    return { ok: true };
  }

  const { count, error: countErr } = await db
    .from(TABLE).select("id", { count: "exact", head: true }).eq("endpoint", input.endpoint);
  if (countErr) {
    console.error("[plan-reminders] count failed:", countErr.code, countErr.message);
    return { ok: false, error: "Could not turn reminders on. Please try again." };
  }
  if ((count ?? 0) >= MAX_REMINDER_PLANS_PER_DEVICE) {
    return { ok: false, error: `This phone already has reminders for ${MAX_REMINDER_PLANS_PER_DEVICE} plans. Turn one off first.` };
  }

  const { error } = await db.from(TABLE).insert({
    plan_id: input.planId,
    user_id: input.userId,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
  });
  // 23505: a double tap raced the lookup. Reminders are on, which is the goal.
  if (error && error.code !== "23505") {
    console.error("[plan-reminders] insert failed:", error.code, error.message);
    return { ok: false, error: "Could not turn reminders on. Please try again." };
  }
  return { ok: true };
}

/** Only the caller's own row for this plan and this phone. */
export async function removePlanReminder(input: { userId: string; planId: string; endpoint: string }): Promise<{ ok: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;
  const { error } = await db.from(TABLE).delete()
    .eq("plan_id", input.planId).eq("user_id", input.userId).eq("endpoint", input.endpoint);
  if (error) {
    console.error("[plan-reminders] delete failed:", error.code, error.message);
    return { ok: false };
  }
  return { ok: true };
}

// ── The morning sender ───────────────────────────────────────────────────────

export type PlanReminderSummary = {
  configured: boolean;
  /** Subscriptions looked at. */
  checked: number;
  sent: number;
  /** Nothing due today for that plan. */
  quiet: number;
  /** Removed: plan gone, access lost, function long over, or the phone unsubscribed. */
  removed: number;
  /** Transient push failures, retried by the next run. */
  failed: number;
  errors: number;
};

type Sub = {
  id: string; plan_id: string; user_id: string; endpoint: string; p256dh: string; auth: string;
  failure_count: number; last_sent_on: string | null;
};
type PlanRow = { id: string; title: string; owner_id: string; event_date: string | null };
type ItemRow = { plan_id: string; category: string; status: string; next_due_date: string | null; next_due_amount: number | string | null };
type TaskRow = { plan_id: string; title: string; due_date: string | null; offset_days: number | null; done_at: string | null };

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

/** Reads `columns` of `table` for every id in `ids`, in chunks. Null on any error. */
async function readIn<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, table: string, columns: string, column: string, ids: readonly string[],
): Promise<T[] | null> {
  const rows: T[] = [];
  for (const part of chunks(ids)) {
    const { data, error } = await db.from(table).select(columns).in(column, part);
    if (error) {
      console.error(`[plan-reminders] ${table} read failed:`, error.code, error.message);
      return null;
    }
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
}

function statusOf(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "statusCode" in err
    ? Number((err as { statusCode: unknown }).statusCode)
    : undefined;
}

export async function processPlanReminders(deps: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any;
  send?: PushSender;
  today?: string;
} = {}): Promise<PlanReminderSummary> {
  const summary: PlanReminderSummary = {
    configured: false, checked: 0, sent: 0, quiet: 0, removed: 0, failed: 0, errors: 0,
  };
  const db = deps.db ?? getSupabaseAdminClient();
  const today = deps.today ?? todayInBusinessTz();

  const cfg = pushConfig();
  const send: PushSender | null =
    deps.send ?? (cfg ? (target, payload) => webpush.sendNotification(target, payload, pushOptions(cfg)) : null);
  if (!send) return summary;
  summary.configured = true;

  const { data: subsRaw, error: subErr } = await db
    .from(TABLE)
    .select("id, plan_id, user_id, endpoint, p256dh, auth, failure_count, last_sent_on")
    .limit(SUBS_PER_RUN);
  if (subErr) {
    console.error("[plan-reminders] subscriptions read failed:", subErr.code, subErr.message);
    summary.errors++;
    return summary;
  }
  // Already sent today: the second morning run only retries what failed.
  const subs = ((subsRaw ?? []) as Sub[]).filter((s) => s.last_sent_on !== today);
  if (subs.length === 0) return summary;

  const planIds = [...new Set(subs.map((s) => s.plan_id))];
  const userIds = [...new Set(subs.map((s) => s.user_id))];
  const [plans, items, tasks, members, profiles] = await Promise.all([
    readIn<PlanRow>(db, "event_plans", "id, title, owner_id, event_date", "id", planIds),
    readIn<ItemRow>(db, "event_plan_items", "plan_id, category, status, next_due_date, next_due_amount", "plan_id", planIds),
    readIn<TaskRow>(db, "event_plan_tasks", "plan_id, title, due_date, offset_days, done_at", "plan_id", planIds),
    readIn<{ plan_id: string; user_id: string }>(db, "event_plan_members", "plan_id, user_id", "plan_id", planIds),
    readIn<{ id: string; is_active: boolean }>(db, "profiles", "id, is_active", "id", userIds),
  ]);
  // Fail closed: deciding who may hear about a plan from a partial read could
  // send a removed member a reminder, or delete a valid subscription.
  if (!plans || !items || !tasks || !members || !profiles) {
    summary.errors++;
    return summary;
  }

  const planById = new Map(plans.map((p) => [p.id, p]));
  const memberKey = new Set(members.map((m) => `${m.plan_id}:${m.user_id}`));
  const active = new Set(profiles.filter((p) => p.is_active).map((p) => p.id));
  const keepAfter = addDaysToIsoDate(today, -KEEP_AFTER_EVENT_DAYS);

  const remove = async (id: string) => {
    const { error } = await db.from(TABLE).delete().eq("id", id);
    if (error) summary.errors++;
    else summary.removed++;
  };

  for (const sub of subs) {
    summary.checked++;
    const plan = planById.get(sub.plan_id);
    const hasAccess = plan && (plan.owner_id === sub.user_id || memberKey.has(`${sub.plan_id}:${sub.user_id}`));
    if (!plan || !hasAccess || (plan.event_date && plan.event_date < keepAfter)) {
      await remove(sub.id);
      continue;
    }
    // A suspended account keeps its row (it may be restored) but hears nothing.
    if (!active.has(sub.user_id)) continue;

    const reminders = planReminders({
      eventDate: plan.event_date,
      items: items.filter((i) => i.plan_id === plan.id).map((i) => ({
        category: i.category,
        status: i.status,
        nextDueDate: i.next_due_date,
        nextDueAmount: i.next_due_amount == null ? null : Number(i.next_due_amount),
      })),
      tasks: tasks.filter((t) => t.plan_id === plan.id).map((t) => ({
        title: t.title, dueDate: t.due_date, offsetDays: t.offset_days, doneAt: t.done_at,
      })),
      today,
    });
    const message = reminderMessage({ id: plan.id, title: plan.title }, reminders, today);
    if (!message) { summary.quiet++; continue; }

    // Claim today's send. Vercel can deliver a cron twice; only one run wins.
    const { data: claimed, error: claimErr } = await db
      .from(TABLE)
      .update({ last_sent_on: today })
      .eq("id", sub.id)
      .or(`last_sent_on.is.null,last_sent_on.neq.${today}`)
      .select("id");
    if (claimErr) { summary.errors++; continue; }
    if (!claimed || claimed.length === 0) continue;

    try {
      await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(message));
      summary.sent++;
      if (sub.failure_count > 0) await db.from(TABLE).update({ failure_count: 0 }).eq("id", sub.id);
    } catch (err) {
      const status = statusOf(err);
      if (status === 404 || status === 410) {
        await remove(sub.id);
        continue;
      }
      summary.failed++;
      if (sub.failure_count + 1 >= MAX_FAILURES) {
        await remove(sub.id);
      } else {
        // Release the claim so the later run this morning tries again.
        await db.from(TABLE).update({ last_sent_on: null, failure_count: sub.failure_count + 1 }).eq("id", sub.id);
      }
    }
  }
  return summary;
}
