"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Server actions for the family's event plans. Identity is the session's; a
// plan id from the client is safe because RLS (0110) answers only for the
// plan's owner — anyone else's id updates nothing and reads as "not found".
// Inputs are validated here; the occasion is also checked against the live
// catalogue, so a plan cannot carry an occasion the site does not know.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { fetchVenueCategories } from "@/lib/venue-categories.server";
import {
  parseSafe,
  planDetailsSchema,
  planItemSchema,
  planTaskSchema,
  uuidSchema,
} from "@/lib/validation/schemas";
import {
  addTask,
  createPlan,
  deletePlan,
  deleteTask,
  setItemNeeded,
  setTaskDone,
  updateItem,
  updatePlan,
  type PlanDetailsInput,
} from "@/lib/plan.server";
import { PLAN_CATEGORY_KEYS, type PlanCategory } from "@/lib/plan";

type ActionResult = { ok: true } | { ok: false; error: string };

async function parseDetails(input: unknown): Promise<{ ok: true; d: PlanDetailsInput } | { ok: false; error: string }> {
  const parsed = parseSafe(planDetailsSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.data;
  const catalogue = await fetchVenueCategories();
  // An unreadable catalogue does not block planning: the slug already passed
  // the pattern check, and the plan keeps working with an unnamed occasion.
  if (catalogue.length > 0 && !catalogue.some((c) => c.slug === v.occasion)) {
    return { ok: false, error: "Choose an occasion from the list." };
  }
  return {
    ok: true,
    d: {
      title: v.title,
      occasion: v.occasion,
      eventDate: v.eventDate ?? null,
      city: v.city || null,
      guests: v.guests ?? null,
      budget: v.budget ?? null,
    },
  };
}

export async function createPlanAction(input: unknown): Promise<ActionResult> {
  const user = await getSession();
  if (!user) return { ok: false, error: "Please sign in to start a plan." };
  const details = await parseDetails(input);
  if (!details.ok) return details;
  const result = await createPlan(user.id, details.d);
  if (!result.ok) return result;
  revalidatePath("/plan");
  redirect(`/plan/${result.id}`);
}

export async function updatePlanAction(planId: unknown, input: unknown): Promise<ActionResult> {
  const id = uuidSchema.safeParse(planId);
  if (!id.success) return { ok: false, error: "Plan not found." };
  if (!(await getSession())) return { ok: false, error: "Please sign in again." };
  const details = await parseDetails(input);
  if (!details.ok) return details;
  const result = await updatePlan(id.data, details.d);
  if (result.ok) revalidatePath(`/plan/${id.data}`);
  return result;
}

export async function deletePlanAction(planId: unknown): Promise<ActionResult> {
  const id = uuidSchema.safeParse(planId);
  if (!id.success) return { ok: false, error: "Plan not found." };
  if (!(await getSession())) return { ok: false, error: "Please sign in again." };
  const result = await deletePlan(id.data);
  if (!result.ok) return result;
  revalidatePath("/plan");
  redirect("/plan");
}

export async function updateItemAction(input: unknown): Promise<ActionResult> {
  if (!(await getSession())) return { ok: false, error: "Please sign in again." };
  const parsed = parseSafe(planItemSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.data;
  // The form sends every field, so a blank one is a cleared one.
  const result = await updateItem(v.planId, v.category, {
    status: v.status,
    hallId: v.hallId ?? null,
    vendorName: v.vendorName || null,
    vendorPhone: v.vendorPhone || null,
    notes: v.notes || null,
    plannedAmount: v.plannedAmount ?? null,
    quotedAmount: v.quotedAmount ?? null,
    paidAmount: v.paidAmount ?? null,
    nextDueDate: v.nextDueDate ?? null,
    nextDueAmount: v.nextDueAmount ?? null,
  });
  if (result.ok) revalidatePath(`/plan/${v.planId}`);
  return result;
}

export async function setItemNeededAction(planId: unknown, category: unknown, needed: boolean): Promise<ActionResult> {
  const id = uuidSchema.safeParse(planId);
  if (!id.success || !PLAN_CATEGORY_KEYS.includes(category as PlanCategory)) return { ok: false, error: "Plan not found." };
  if (!(await getSession())) return { ok: false, error: "Please sign in again." };
  const result = await setItemNeeded(id.data, category as PlanCategory, Boolean(needed));
  if (result.ok) revalidatePath(`/plan/${id.data}`);
  return result;
}

export async function addTaskAction(input: unknown): Promise<ActionResult> {
  if (!(await getSession())) return { ok: false, error: "Please sign in again." };
  const parsed = parseSafe(planTaskSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.data;
  const result = await addTask(v.planId, { title: v.title, dueDate: v.dueDate ?? null, category: v.category ?? null });
  if (result.ok) revalidatePath(`/plan/${v.planId}`);
  return result;
}

export async function setTaskDoneAction(planId: unknown, taskId: unknown, done: boolean): Promise<ActionResult> {
  const p = uuidSchema.safeParse(planId);
  const t = uuidSchema.safeParse(taskId);
  if (!p.success || !t.success) return { ok: false, error: "Task not found." };
  if (!(await getSession())) return { ok: false, error: "Please sign in again." };
  const result = await setTaskDone(p.data, t.data, Boolean(done));
  if (result.ok) revalidatePath(`/plan/${p.data}`);
  return result;
}

export async function deleteTaskAction(planId: unknown, taskId: unknown): Promise<ActionResult> {
  const p = uuidSchema.safeParse(planId);
  const t = uuidSchema.safeParse(taskId);
  if (!p.success || !t.success) return { ok: false, error: "Task not found." };
  if (!(await getSession())) return { ok: false, error: "Please sign in again." };
  const result = await deleteTask(p.data, t.data);
  if (result.ok) revalidatePath(`/plan/${p.data}`);
  return result;
}
