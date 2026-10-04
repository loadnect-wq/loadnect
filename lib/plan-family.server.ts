// ─────────────────────────────────────────────────────────────────────────────
// lib/plan-family.server.ts — sharing a plan with the family, and the family's
// votes (0111). SERVER-ONLY.
//
// SESSION CLIENT ONLY, like lib/plan.server.ts. Who may invite, change a role,
// add an option or vote is decided by RLS from the session; this module never
// takes an actor as a parameter except the voter, and RLS refuses any voter
// who is not the caller. Joining goes through join_event_plan(), because a
// joiner cannot read the invite they are using.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { randomBytes } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { MAX_OPTIONS, type PlanCategory, type PlanRole } from "@/lib/plan";

export type PlanPerson = { userId: string; name: string | null; role: PlanRole; joinedAt: string };

export type PlanOption = {
  id: string;
  category: PlanCategory;
  hallId: string | null;
  name: string;
  price: number | null;
  note: string | null;
};

export type PlanVote = { category: PlanCategory; userId: string; optionId: string };

export type InvitePreview = {
  planId: string;
  title: string;
  occasion: string;
  eventDate: string | null;
  ownerName: string | null;
  people: number;
  /** The caller's role if they are in the plan already. */
  myRole: PlanRole | null;
};

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const TRY_AGAIN = "Could not save. Please try again.";
const OWNER_ONLY = "Only the person who started the plan can do that.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function db(): Promise<any> {
  return getSupabaseServerClient();
}

// ── People ───────────────────────────────────────────────────────────────────

export async function fetchPeople(planId: string): Promise<{ ok: true; people: PlanPerson[] } | { ok: false }> {
  const { data, error } = await (await db()).rpc("event_plan_people", { _plan: planId });
  if (error) {
    console.error("[plan-family] people failed", error.code, error.message);
    return { ok: false };
  }
  return {
    ok: true,
    people: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      userId: String(r.user_id),
      name: (r.name as string | null) ?? null,
      role: r.role as PlanRole,
      joinedAt: String(r.joined_at),
    })),
  };
}

/** Owner only: makes a member an editor, or back to a viewer. */
export async function setMemberRole(planId: string, userId: string, role: "editor" | "viewer"): Promise<Result> {
  const { data, error } = await (await db())
    .from("event_plan_members").update({ role }).eq("plan_id", planId).eq("user_id", userId).select("user_id");
  if (error) {
    console.error("[plan-family] role failed", error.code, error.message);
    return { ok: false, error: TRY_AGAIN };
  }
  return data?.length ? { ok: true } : { ok: false, error: OWNER_ONLY };
}

/** The owner removing someone, or someone leaving (userId is then their own). */
export async function removeMember(planId: string, userId: string): Promise<Result> {
  const { data, error } = await (await db())
    .from("event_plan_members").delete().eq("plan_id", planId).eq("user_id", userId).select("user_id");
  if (error) {
    console.error("[plan-family] remove failed", error.code, error.message);
    return { ok: false, error: TRY_AGAIN };
  }
  return data?.length ? { ok: true } : { ok: false, error: "They are not in this plan any more." };
}

// ── The invite link ──────────────────────────────────────────────────────────

/** The plan's live invite token, for its owner; null for anyone else, or when the link is off. */
export async function fetchInviteToken(planId: string): Promise<{ ok: true; token: string | null } | { ok: false }> {
  const { data, error } = await (await db())
    .from("event_plan_invites").select("token").eq("plan_id", planId).maybeSingle();
  if (error) {
    console.error("[plan-family] invite read failed", error.code, error.message);
    return { ok: false };
  }
  return { ok: true, token: (data?.token as string | undefined) ?? null };
}

/**
 * Turns the link on. Idempotent: a second tap returns the link already made,
 * so a link someone has just copied never changes under them.
 */
export async function createInvite(planId: string): Promise<Result<{ token: string }>> {
  const client = await db();
  const { error } = await client
    .from("event_plan_invites")
    .upsert({ plan_id: planId, token: randomBytes(16).toString("base64url") }, { onConflict: "plan_id", ignoreDuplicates: true });
  if (error) {
    console.error("[plan-family] invite failed", error.code, error.message);
    return { ok: false, error: error.code === "42501" ? OWNER_ONLY : TRY_AGAIN };
  }
  const read = await fetchInviteToken(planId);
  if (!read.ok || !read.token) return { ok: false, error: read.ok ? OWNER_ONLY : TRY_AGAIN };
  return { ok: true, token: read.token };
}

/** Turns the link off. People who already joined stay. */
export async function turnOffInvite(planId: string): Promise<Result> {
  const { error } = await (await db()).from("event_plan_invites").delete().eq("plan_id", planId);
  if (error) {
    console.error("[plan-family] invite off failed", error.code, error.message);
    return { ok: false, error: TRY_AGAIN };
  }
  return { ok: true };
}

export async function previewInvite(token: string): Promise<{ ok: true; invite: InvitePreview | null } | { ok: false }> {
  const { data, error } = await (await db()).rpc("event_plan_invite_preview", { _token: token });
  if (error) {
    console.error("[plan-family] preview failed", error.code, error.message);
    return { ok: false };
  }
  if (!data) return { ok: true, invite: null };
  const r = data as Record<string, unknown>;
  return {
    ok: true,
    invite: {
      planId: String(r.plan),
      title: String(r.title),
      occasion: String(r.occasion),
      eventDate: (r.event_date as string | null) ?? null,
      ownerName: (r.owner_name as string | null) ?? null,
      people: Number(r.people ?? 1),
      myRole: (r.my_role as PlanRole | null) ?? null,
    },
  };
}

const JOIN_ERRORS: Record<string, string> = {
  invalid: "This invite link has been turned off. Ask for a new one.",
  full: "This plan already has as many people as it can hold.",
  suspended: "This account cannot join plans right now.",
  signed_out: "Please sign in again.",
};

export async function joinPlan(token: string): Promise<Result<{ planId: string }>> {
  const { data, error } = await (await db()).rpc("join_event_plan", { _token: token });
  if (error) {
    console.error("[plan-family] join failed", error.code, error.message);
    return { ok: false, error: "Could not join. Please try again." };
  }
  const r = (data ?? {}) as { outcome?: string; plan?: string };
  if (r.plan && (r.outcome === "joined" || r.outcome === "member" || r.outcome === "owner")) {
    return { ok: true, planId: r.plan };
  }
  return { ok: false, error: JOIN_ERRORS[r.outcome ?? ""] ?? "Could not join. Please try again." };
}

// ── Options and votes ────────────────────────────────────────────────────────

const OPTION_COLUMNS = "id, category, hall_id, name, price, note";

function toOption(r: Record<string, unknown>): PlanOption {
  return {
    id: String(r.id),
    category: r.category as PlanCategory,
    hallId: (r.hall_id as string | null) ?? null,
    name: String(r.name),
    price: r.price == null ? null : Number(r.price),
    note: (r.note as string | null) ?? null,
  };
}

/** A plan's options and votes, for one category or all of them. */
export async function fetchOptions(
  planId: string,
  category?: PlanCategory,
): Promise<{ ok: true; options: PlanOption[]; votes: PlanVote[] } | { ok: false }> {
  const client = await db();
  let oq = client.from("event_plan_options").select(OPTION_COLUMNS).eq("plan_id", planId);
  let vq = client.from("event_plan_votes").select("category, user_id, option_id").eq("plan_id", planId);
  if (category) {
    oq = oq.eq("category", category);
    vq = vq.eq("category", category);
  }
  const [o, v] = await Promise.all([oq.order("created_at", { ascending: true }), vq]);
  if (o.error || v.error) {
    const e = o.error ?? v.error;
    console.error("[plan-family] options failed", e.code, e.message);
    return { ok: false };
  }
  return {
    ok: true,
    options: ((o.data ?? []) as Record<string, unknown>[]).map(toOption),
    votes: ((v.data ?? []) as Record<string, unknown>[]).map((r) => ({
      category: r.category as PlanCategory,
      userId: String(r.user_id),
      optionId: String(r.option_id),
    })),
  };
}

export async function addOption(
  planId: string,
  o: { category: PlanCategory; hallId: string | null; name: string; price: number | null; note: string | null },
): Promise<Result> {
  const client = await db();
  const { count, error: countErr } = await client
    .from("event_plan_options").select("id", { count: "exact", head: true }).eq("plan_id", planId).eq("category", o.category);
  if (countErr) return { ok: false, error: TRY_AGAIN };
  if ((count ?? 0) >= MAX_OPTIONS) {
    return { ok: false, error: `A category can hold ${MAX_OPTIONS} options. Remove one you have ruled out first.` };
  }
  const { error } = await client.from("event_plan_options").insert({
    plan_id: planId,
    category: o.category,
    hall_id: o.category === "hall" ? o.hallId : null,
    name: o.name,
    price: o.price,
    note: o.note,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That hall is already on the list." };
    if (error.code === "42501") return { ok: false, error: "Only people who can edit the plan can add options." };
    console.error("[plan-family] option add failed", error.code, error.message);
    return { ok: false, error: TRY_AGAIN };
  }
  return { ok: true };
}

export async function removeOption(planId: string, optionId: string): Promise<Result> {
  const { data, error } = await (await db())
    .from("event_plan_options").delete().eq("id", optionId).eq("plan_id", planId).select("id");
  if (error) {
    console.error("[plan-family] option remove failed", error.code, error.message);
    return { ok: false, error: TRY_AGAIN };
  }
  return data?.length ? { ok: true } : { ok: false, error: "Only people who can edit the plan can remove options." };
}

/** One vote per person per category: voting again moves it. */
export async function castVote(planId: string, category: PlanCategory, optionId: string, voterId: string): Promise<Result> {
  const { error } = await (await db()).from("event_plan_votes").upsert(
    { plan_id: planId, category, user_id: voterId, option_id: optionId, voted_at: new Date().toISOString() },
    { onConflict: "plan_id,category,user_id" },
  );
  if (error) {
    // 23503: the option was removed (or never belonged to this category).
    if (error.code === "23503") return { ok: false, error: "That option is not on the list any more." };
    if (error.code === "42501") return { ok: false, error: "You are not in this plan any more." };
    console.error("[plan-family] vote failed", error.code, error.message);
    return { ok: false, error: TRY_AGAIN };
  }
  return { ok: true };
}

export async function withdrawVote(planId: string, category: PlanCategory, voterId: string): Promise<Result> {
  const { error } = await (await db())
    .from("event_plan_votes").delete().eq("plan_id", planId).eq("category", category).eq("user_id", voterId);
  if (error) {
    console.error("[plan-family] unvote failed", error.code, error.message);
    return { ok: false, error: TRY_AGAIN };
  }
  return { ok: true };
}

/**
 * Makes an option the category's choice on the board: the hall (or the
 * vendor's name) and the price it came with. Progress only moves forward — a
 * category still "to do" becomes "shortlisted"; anything further on keeps its
 * status. A different vendor's phone number is cleared rather than left
 * against the wrong name.
 */
export async function chooseOption(planId: string, optionId: string): Promise<Result> {
  const client = await db();
  const { data: opt, error: optErr } = await client
    .from("event_plan_options").select(OPTION_COLUMNS).eq("id", optionId).eq("plan_id", planId).maybeSingle();
  if (optErr) return { ok: false, error: TRY_AGAIN };
  if (!opt) return { ok: false, error: "That option is not on the list any more." };
  const option = toOption(opt);

  const { data: item, error: itemErr } = await client
    .from("event_plan_items").select("status, hall_id, vendor_name").eq("plan_id", planId).eq("category", option.category).maybeSingle();
  if (itemErr) return { ok: false, error: TRY_AGAIN };
  if (!item) return { ok: false, error: "Plan not found." };

  const patch: Record<string, unknown> = {};
  if (option.hallId) {
    patch.hall_id = option.hallId;
    patch.vendor_name = null;
    if (item.hall_id !== option.hallId) patch.vendor_phone = null;
  } else {
    if (option.category === "hall") patch.hall_id = null;
    patch.vendor_name = option.name;
    if (item.vendor_name !== option.name) patch.vendor_phone = null;
  }
  if (option.price != null) patch.quoted_amount = option.price;
  if (item.status === "todo" || item.status === "not_needed") patch.status = "shortlisted";

  const { data, error } = await client
    .from("event_plan_items").update(patch).eq("plan_id", planId).eq("category", option.category).select("id");
  if (error) {
    console.error("[plan-family] choose failed", error.code, error.message);
    return { ok: false, error: TRY_AGAIN };
  }
  return data?.length ? { ok: true } : { ok: false, error: "Only people who can edit the plan can choose." };
}
