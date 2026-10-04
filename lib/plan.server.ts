// ─────────────────────────────────────────────────────────────────────────────
// lib/plan.server.ts — reading and writing the family's event plans.
// SERVER-ONLY.
//
// EVERYTHING GOES THROUGH THE SESSION CLIENT. The plan is the family's own data
// and nobody else is party to it, so RLS (0110) is the authority: a plan id
// from the URL or a form is safe to pass through, because a plan the caller
// does not own reads as absent and updates nothing. No service role here.
//
// THREE-STATE READS. A failed read is reported as failed, so a page can say
// "couldn't load your plan" instead of showing an empty board — an empty
// board would invite the family to fill in again what they already entered.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  DEFAULT_CATEGORIES,
  MAX_PLANS,
  MAX_TASKS,
  PLAN_CATEGORY_KEYS,
  TEMPLATE_TASKS,
  templateFor,
  type ItemStatus,
  type PlanCategory,
} from "@/lib/plan";

export type Plan = {
  id: string;
  title: string;
  occasion: string;
  eventDate: string | null;
  city: string | null;
  guests: number | null;
  budget: number | null;
  createdAt: string;
};

export type PlanItem = {
  id: string;
  category: PlanCategory;
  status: ItemStatus;
  hallId: string | null;
  vendorName: string | null;
  vendorPhone: string | null;
  notes: string | null;
  plannedAmount: number | null;
  quotedAmount: number | null;
  paidAmount: number | null;
  nextDueDate: string | null;
  nextDueAmount: number | null;
};

export type PlanTask = {
  id: string;
  title: string;
  category: PlanCategory | null;
  offsetDays: number | null;
  dueDate: string | null;
  doneAt: string | null;
  templateKey: string | null;
  sortOrder: number;
};

export type PlanDetailsInput = {
  title: string;
  occasion: string;
  eventDate: string | null;
  city: string | null;
  guests: number | null;
  budget: number | null;
};

export type PlanItemInput = {
  status: ItemStatus;
  hallId: string | null;
  vendorName: string | null;
  vendorPhone: string | null;
  notes: string | null;
  plannedAmount: number | null;
  quotedAmount: number | null;
  paidAmount: number | null;
  nextDueDate: string | null;
  nextDueAmount: number | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function db(): Promise<any> {
  return getSupabaseServerClient();
}

const num = (v: unknown) => (v == null ? null : Number(v));

function toPlan(r: Record<string, unknown>): Plan {
  return {
    id: String(r.id),
    title: String(r.title),
    occasion: String(r.occasion),
    eventDate: (r.event_date as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    guests: num(r.guests),
    budget: num(r.budget),
    createdAt: String(r.created_at),
  };
}

function toItem(r: Record<string, unknown>): PlanItem {
  return {
    id: String(r.id),
    category: r.category as PlanCategory,
    status: r.status as ItemStatus,
    hallId: (r.hall_id as string | null) ?? null,
    vendorName: (r.vendor_name as string | null) ?? null,
    vendorPhone: (r.vendor_phone as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    plannedAmount: num(r.planned_amount),
    quotedAmount: num(r.quoted_amount),
    paidAmount: num(r.paid_amount),
    nextDueDate: (r.next_due_date as string | null) ?? null,
    nextDueAmount: num(r.next_due_amount),
  };
}

function toTask(r: Record<string, unknown>): PlanTask {
  return {
    id: String(r.id),
    title: String(r.title),
    category: (r.category as PlanCategory | null) ?? null,
    offsetDays: r.offset_days == null ? null : Number(r.offset_days),
    dueDate: (r.due_date as string | null) ?? null,
    doneAt: (r.done_at as string | null) ?? null,
    templateKey: (r.template_key as string | null) ?? null,
    sortOrder: Number(r.sort_order ?? 0),
  };
}

const PLAN_COLUMNS = "id, title, occasion, event_date, city, guests, budget, created_at";
const ITEM_COLUMNS =
  "id, plan_id, category, status, hall_id, vendor_name, vendor_phone, notes, planned_amount, quoted_amount, " +
  "paid_amount, next_due_date, next_due_amount";
const TASK_COLUMNS = "id, title, category, offset_days, due_date, done_at, template_key, sort_order";

// ── Reads ────────────────────────────────────────────────────────────────────

export type PlanListEntry = Plan & { activeCount: number; bookedCount: number };

export async function fetchMyPlans(): Promise<{ ok: true; plans: PlanListEntry[] } | { ok: false }> {
  const client = await db();
  const { data: plans, error } = await client
    .from("event_plans").select(PLAN_COLUMNS).order("created_at", { ascending: false }).limit(MAX_PLANS + 5);
  if (error) {
    console.error("[plan] list failed", error.code, error.message);
    return { ok: false };
  }
  const ids = ((plans ?? []) as { id: string }[]).map((p) => p.id);
  if (ids.length === 0) return { ok: true, plans: [] };
  const { data: items, error: itemErr } = await client
    .from("event_plan_items").select("plan_id, status").in("plan_id", ids);
  if (itemErr) {
    console.error("[plan] list items failed", itemErr.code, itemErr.message);
    return { ok: false };
  }
  const rows = (items ?? []) as { plan_id: string; status: string }[];
  return {
    ok: true,
    plans: (plans as Record<string, unknown>[]).map((r) => {
      const mine = rows.filter((i) => i.plan_id === r.id && i.status !== "not_needed");
      return { ...toPlan(r), activeCount: mine.length, bookedCount: mine.filter((i) => i.status === "booked").length };
    }),
  };
}

export type LoadedPlan =
  | { ok: true; plan: Plan; items: PlanItem[]; tasks: PlanTask[] }
  | { ok: false; reason: "not_found" | "failed" };

export async function fetchPlan(planId: string): Promise<LoadedPlan> {
  const client = await db();
  const [planRes, itemRes, taskRes] = await Promise.all([
    client.from("event_plans").select(PLAN_COLUMNS).eq("id", planId).maybeSingle(),
    client.from("event_plan_items").select(ITEM_COLUMNS).eq("plan_id", planId),
    client.from("event_plan_tasks").select(TASK_COLUMNS).eq("plan_id", planId).order("sort_order", { ascending: true }),
  ]);
  if (planRes.error || itemRes.error || taskRes.error) {
    const e = planRes.error ?? itemRes.error ?? taskRes.error;
    console.error("[plan] read failed", e.code, e.message);
    return { ok: false, reason: "failed" };
  }
  if (!planRes.data) return { ok: false, reason: "not_found" };
  const items = ((itemRes.data ?? []) as Record<string, unknown>[]).map(toItem);
  items.sort((a, b) => PLAN_CATEGORY_KEYS.indexOf(a.category) - PLAN_CATEGORY_KEYS.indexOf(b.category));
  return {
    ok: true,
    plan: toPlan(planRes.data),
    items,
    tasks: ((taskRes.data ?? []) as Record<string, unknown>[]).map(toTask),
  };
}

// ── Writes ───────────────────────────────────────────────────────────────────

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const TRY_AGAIN = "Could not save. Please try again.";

function planRow(d: PlanDetailsInput) {
  return { title: d.title, occasion: d.occasion, event_date: d.eventDate, city: d.city, guests: d.guests, budget: d.budget };
}

/**
 * A new plan with its whole board and the occasion's checklist. The board is
 * every category, the occasion's defaults switched on and the rest marked
 * "not needed", so switching one on later is an update, never an insert.
 * If the board or checklist cannot be written, the half-made plan is removed
 * rather than left without them.
 */
export async function createPlan(ownerId: string, d: PlanDetailsInput): Promise<Result<{ id: string }>> {
  const client = await db();
  const { count, error: countErr } = await client
    .from("event_plans").select("id", { count: "exact", head: true }).eq("owner_id", ownerId);
  if (countErr) {
    console.error("[plan] count failed", countErr.code, countErr.message);
    return { ok: false, error: TRY_AGAIN };
  }
  if ((count ?? 0) >= MAX_PLANS) {
    return { ok: false, error: `You have ${MAX_PLANS} plans already. Delete one you no longer need to start another.` };
  }

  const { data: plan, error } = await client
    .from("event_plans").insert({ owner_id: ownerId, ...planRow(d) }).select("id").single();
  if (error || !plan) {
    console.error("[plan] create failed", error?.code, error?.message);
    return { ok: false, error: TRY_AGAIN };
  }

  const template = templateFor(d.occasion);
  const on = new Set<PlanCategory>(DEFAULT_CATEGORIES[template]);
  const items = PLAN_CATEGORY_KEYS.map((category) => ({
    plan_id: plan.id,
    category,
    status: on.has(category) ? "todo" : "not_needed",
  }));
  const tasks = TEMPLATE_TASKS[template].map((t, i) => ({
    plan_id: plan.id,
    title: t.title,
    category: t.category,
    offset_days: t.offsetDays,
    template_key: t.key,
    sort_order: i,
  }));
  const [itemRes, taskRes] = await Promise.all([
    client.from("event_plan_items").insert(items),
    client.from("event_plan_tasks").insert(tasks),
  ]);
  if (itemRes.error || taskRes.error) {
    const e = itemRes.error ?? taskRes.error;
    console.error("[plan] board/checklist failed", e.code, e.message);
    await client.from("event_plans").delete().eq("id", plan.id);
    return { ok: false, error: TRY_AGAIN };
  }
  return { ok: true, id: plan.id };
}

export async function updatePlan(planId: string, d: PlanDetailsInput): Promise<Result> {
  const { data, error } = await (await db())
    .from("event_plans").update(planRow(d)).eq("id", planId).select("id");
  if (error) {
    console.error("[plan] update failed", error.code, error.message);
    return { ok: false, error: TRY_AGAIN };
  }
  return data?.length ? { ok: true } : { ok: false, error: "Plan not found." };
}

export async function deletePlan(planId: string): Promise<Result> {
  const { data, error } = await (await db()).from("event_plans").delete().eq("id", planId).select("id");
  if (error) {
    console.error("[plan] delete failed", error.code, error.message);
    return { ok: false, error: "Could not delete the plan. Please try again." };
  }
  return data?.length ? { ok: true } : { ok: false, error: "Plan not found." };
}

export async function updateItem(planId: string, category: PlanCategory, f: PlanItemInput): Promise<Result> {
  const { data, error } = await (await db())
    .from("event_plan_items")
    .update({
      status: f.status,
      hall_id: category === "hall" ? f.hallId : null,
      vendor_name: f.vendorName,
      vendor_phone: f.vendorPhone,
      notes: f.notes,
      planned_amount: f.plannedAmount,
      quoted_amount: f.quotedAmount,
      paid_amount: f.paidAmount,
      next_due_date: f.nextDueDate,
      next_due_amount: f.nextDueAmount,
    })
    .eq("plan_id", planId)
    .eq("category", category)
    .select("id");
  if (error) {
    console.error("[plan] item update failed", error.code, error.message);
    return { ok: false, error: TRY_AGAIN };
  }
  return data?.length ? { ok: true } : { ok: false, error: "Plan not found." };
}

/** Switches one category on or off from the board, leaving its details as they are. */
export async function setItemNeeded(planId: string, category: PlanCategory, needed: boolean): Promise<Result> {
  const client = await db();
  let q = client.from("event_plan_items").update({ status: needed ? "todo" : "not_needed" })
    .eq("plan_id", planId).eq("category", category);
  // Switching on only revives a category that was off; it never resets progress.
  q = needed ? q.eq("status", "not_needed") : q;
  const { error } = await q.select("id");
  if (error) {
    console.error("[plan] item toggle failed", error.code, error.message);
    return { ok: false, error: TRY_AGAIN };
  }
  return { ok: true };
}

export async function addTask(
  planId: string,
  t: { title: string; dueDate: string | null; category: PlanCategory | null },
): Promise<Result> {
  const client = await db();
  const { count, error: countErr } = await client
    .from("event_plan_tasks").select("id", { count: "exact", head: true }).eq("plan_id", planId);
  if (countErr) return { ok: false, error: TRY_AGAIN };
  if ((count ?? 0) >= MAX_TASKS) return { ok: false, error: `A plan can hold ${MAX_TASKS} tasks.` };
  const { error } = await client.from("event_plan_tasks").insert({
    plan_id: planId,
    title: t.title,
    due_date: t.dueDate,
    category: t.category,
    sort_order: 1000 + (count ?? 0),
  });
  if (error) {
    console.error("[plan] task add failed", error.code, error.message);
    // RLS refuses a plan the caller cannot write, which is "not found" to them.
    return { ok: false, error: error.code === "42501" ? "Plan not found." : TRY_AGAIN };
  }
  return { ok: true };
}

export async function setTaskDone(planId: string, taskId: string, done: boolean): Promise<Result> {
  const { error } = await (await db())
    .from("event_plan_tasks")
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq("id", taskId)
    .eq("plan_id", planId)
    .select("id");
  if (error) {
    console.error("[plan] task toggle failed", error.code, error.message);
    return { ok: false, error: TRY_AGAIN };
  }
  return { ok: true };
}

export async function deleteTask(planId: string, taskId: string): Promise<Result> {
  const { error } = await (await db()).from("event_plan_tasks").delete().eq("id", taskId).eq("plan_id", planId);
  if (error) {
    console.error("[plan] task delete failed", error.code, error.message);
    return { ok: false, error: TRY_AGAIN };
  }
  return { ok: true };
}
