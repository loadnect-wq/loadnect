"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Server actions for sharing a plan and for the family's votes (0111). The
// session is the actor; RLS decides what it may do. Ids and the invite token
// are validated here, and a hall offered as an option is read from the live
// listing rather than trusted from the form.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { fetchHallsResult } from "@/lib/halls";
import {
  parseSafe,
  planInviteTokenSchema,
  planMemberRoleSchema,
  planOptionSchema,
  planVoteSchema,
  uuidSchema,
} from "@/lib/validation/schemas";
import {
  addOption,
  castVote,
  chooseOption,
  createInvite,
  joinPlan,
  removeMember,
  removeOption,
  setMemberRole,
  turnOffInvite,
  withdrawVote,
} from "@/lib/plan-family.server";
import { PLAN_CATEGORY_KEYS, type PlanCategory } from "@/lib/plan";

type ActionResult = { ok: true } | { ok: false; error: string };

const SIGN_IN = "Please sign in again.";

function refresh(planId: string, category?: string) {
  revalidatePath(`/plan/${planId}`);
  if (category) revalidatePath(`/plan/${planId}/${category}`);
}

// ── Invite link and people ───────────────────────────────────────────────────

export async function createInviteAction(planId: unknown): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const id = uuidSchema.safeParse(planId);
  if (!id.success) return { ok: false, error: "Plan not found." };
  if (!(await getSession())) return { ok: false, error: SIGN_IN };
  const result = await createInvite(id.data);
  if (result.ok) refresh(id.data);
  return result;
}

export async function turnOffInviteAction(planId: unknown): Promise<ActionResult> {
  const id = uuidSchema.safeParse(planId);
  if (!id.success) return { ok: false, error: "Plan not found." };
  if (!(await getSession())) return { ok: false, error: SIGN_IN };
  const result = await turnOffInvite(id.data);
  if (result.ok) refresh(id.data);
  return result;
}

export async function setMemberRoleAction(planId: unknown, userId: unknown, role: unknown): Promise<ActionResult> {
  const p = uuidSchema.safeParse(planId);
  const u = uuidSchema.safeParse(userId);
  const r = planMemberRoleSchema.safeParse(role);
  if (!p.success || !u.success || !r.success) return { ok: false, error: "Could not change that." };
  if (!(await getSession())) return { ok: false, error: SIGN_IN };
  const result = await setMemberRole(p.data, u.data, r.data);
  if (result.ok) refresh(p.data);
  return result;
}

export async function removeMemberAction(planId: unknown, userId: unknown): Promise<ActionResult> {
  const p = uuidSchema.safeParse(planId);
  const u = uuidSchema.safeParse(userId);
  if (!p.success || !u.success) return { ok: false, error: "Could not remove them." };
  if (!(await getSession())) return { ok: false, error: SIGN_IN };
  const result = await removeMember(p.data, u.data);
  if (result.ok) refresh(p.data);
  return result;
}

/** Leaves a plan someone shared with you, and goes back to your plans. */
export async function leavePlanAction(planId: unknown): Promise<ActionResult> {
  const p = uuidSchema.safeParse(planId);
  if (!p.success) return { ok: false, error: "Plan not found." };
  const user = await getSession();
  if (!user) return { ok: false, error: SIGN_IN };
  const result = await removeMember(p.data, user.id);
  if (!result.ok) return result;
  revalidatePath("/plan");
  redirect("/plan");
}

export async function joinPlanAction(token: unknown): Promise<ActionResult> {
  const t = planInviteTokenSchema.safeParse(token);
  if (!t.success) return { ok: false, error: "This invite link is not valid." };
  if (!(await getSession())) return { ok: false, error: SIGN_IN };
  const result = await joinPlan(t.data);
  if (!result.ok) return result;
  revalidatePath("/plan");
  redirect(`/plan/${result.planId}`);
}

// ── Options and votes ────────────────────────────────────────────────────────

export async function addOptionAction(input: unknown): Promise<ActionResult> {
  if (!(await getSession())) return { ok: false, error: SIGN_IN };
  const parsed = parseSafe(planOptionSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.data;
  let name = v.name;
  if (v.hallId) {
    const read = await fetchHallsResult({ ids: [v.hallId] });
    if (read.failed) return { ok: false, error: "Could not check that hall. Please try again." };
    const hall = read.halls[0];
    if (!hall) return { ok: false, error: "That hall is not listed on Hallnect any more." };
    name = hall.name;
  }
  const result = await addOption(v.planId, {
    category: v.category,
    hallId: v.hallId ?? null,
    name,
    price: v.price ?? null,
    note: v.note || null,
  });
  if (result.ok) refresh(v.planId, v.category);
  return result;
}

export async function removeOptionAction(planId: unknown, category: unknown, optionId: unknown): Promise<ActionResult> {
  const p = uuidSchema.safeParse(planId);
  const o = uuidSchema.safeParse(optionId);
  if (!p.success || !o.success || !PLAN_CATEGORY_KEYS.includes(category as PlanCategory)) {
    return { ok: false, error: "Option not found." };
  }
  if (!(await getSession())) return { ok: false, error: SIGN_IN };
  const result = await removeOption(p.data, o.data);
  if (result.ok) refresh(p.data, String(category));
  return result;
}

export async function voteAction(input: unknown): Promise<ActionResult> {
  const user = await getSession();
  if (!user) return { ok: false, error: SIGN_IN };
  const parsed = parseSafe(planVoteSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.data;
  const result = v.optionId
    ? await castVote(v.planId, v.category, v.optionId, user.id)
    : await withdrawVote(v.planId, v.category, user.id);
  if (result.ok) refresh(v.planId, v.category);
  return result;
}

export async function chooseOptionAction(planId: unknown, category: unknown, optionId: unknown): Promise<ActionResult> {
  const p = uuidSchema.safeParse(planId);
  const o = uuidSchema.safeParse(optionId);
  if (!p.success || !o.success || !PLAN_CATEGORY_KEYS.includes(category as PlanCategory)) {
    return { ok: false, error: "Option not found." };
  }
  if (!(await getSession())) return { ok: false, error: SIGN_IN };
  const result = await chooseOption(p.data, o.data);
  if (result.ok) refresh(p.data, String(category));
  return result;
}
