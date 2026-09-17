// ─────────────────────────────────────────────────────────────────────────────
// lib/ai/quota.server.ts — who may spend AI tokens right now. SERVER-ONLY.
//
// Every /api/chat request costs money at the AI Gateway, and the endpoint is
// open to guests, so it is metered before the model is called:
//
//   guest (per pseudonymous caller key)   6 / minute   30 / hour    80 / day
//   signed in (per user id)               10 / minute  60 / hour   200 / day
//   everyone together                                              4000 / day
//
// FAILS CLOSED. If the quota cannot be checked (database down, migration 0101
// missing) the request is refused. The OTP guard fails open because locking
// people out of sign-in is worse than a few extra SMS; here the trade is the
// other way round — a chatbot being briefly unavailable costs nothing, an
// unmetered public endpoint in front of a paid model does.
//
// The caller key is an HMAC of the client address with a purpose-specific
// pepper (never the address itself), built the same way as lib/auth/actor-key.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { createHash, createHmac } from "node:crypto";
import { headers } from "next/headers";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const GUEST_LIMITS  = { perMinute: 6,  perHour: 30, perDay: 80 } as const;
export const MEMBER_LIMITS = { perMinute: 10, perHour: 60, perDay: 200 } as const;
export const GLOBAL_DAILY_LIMIT = 4000;

export type QuotaResult = { ok: true } | { ok: false; reason: "limited" | "unavailable" };

/** A different pepper from the OTP and contact-form keys, so buckets cannot be correlated. */
function pepper(): string {
  const explicit = (process.env.CHAT_ACTOR_SALT ?? "").trim();
  if (explicit) return explicit;
  const derived = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  return derived ? createHmac("sha256", derived).update("hallnect:chat-actor:v1").digest("hex") : "";
}

/** All callers without a usable address (or without a pepper) share one crowded bucket. */
const SHARED_UNKNOWN = "unknown-client";

export async function chatActorKey(): Promise<string> {
  const key = pepper();
  let ip = "";
  try {
    const h = await headers();
    // x-vercel-forwarded-for is set by the platform and cannot be forged by a
    // client; x-forwarded-for is client-appendable and only a fallback.
    ip = (h.get("x-vercel-forwarded-for") ?? h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "")
      .split(",")[0]?.trim() ?? "";
  } catch {
    ip = "";
  }
  if (!ip || !key) return SHARED_UNKNOWN;
  return createHash("sha256").update(`${key}|${ip}`).digest("hex").slice(0, 32);
}

export async function consumeChatQuota(userId: string | null): Promise<QuotaResult> {
  const limits = userId ? MEMBER_LIMITS : GUEST_LIMITS;
  try {
    const actorKey = await chatActorKey();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase client (no generated Database types in this project)
    const db = getSupabaseAdminClient() as any;
    const { data, error } = await db.rpc("consume_chat_quota", {
      _actor_key:  actorKey,
      _user_id:    userId,
      _per_minute: limits.perMinute,
      _per_hour:   limits.perHour,
      _per_day:    limits.perDay,
      _global_day: GLOBAL_DAILY_LIMIT,
    });
    if (error) {
      console.error("[chat-quota] check failed:", error.code, error.message);
      return { ok: false, reason: "unavailable" };
    }
    if (data === "ok") return { ok: true };
    if (data === "global_day") console.warn("[chat-quota] global daily limit reached");
    return { ok: false, reason: "limited" };
  } catch (e) {
    console.error("[chat-quota] check threw:", e instanceof Error ? e.message : e);
    return { ok: false, reason: "unavailable" };
  }
}
