// ─────────────────────────────────────────────────────────────────────────────
// lib/audit.ts — admin audit trail writer (server-only).
//
// SECURITY: the actor is ALWAYS taken from the authenticated session. There is
// deliberately no parameter for it, so a caller cannot attribute an action to
// someone else. The table is append-only (no UPDATE/DELETE policy, plus a guard
// trigger that also stops the service role) — verified against the live DB.
//
// Audit writes must never break the action they record: a logging failure is
// reported to the server console and swallowed, so a successful approval is not
// rolled back because the trail write hiccuped.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export type AuditEntry = {
  action:          string;              // 'hall.approve', 'user.suspend', …
  entityType:      string;              // 'hall' | 'user' | 'advertisement' | …
  entityId?:       string | null;
  previousStatus?: string | null;
  newStatus?:      string | null;
  reason?:         string | null;
  metadata?:       Record<string, unknown> | null;
};

/**
 * Appends one entry to the admin audit log. Fire-and-forget by design:
 * callers `await` it but never branch on it.
 */
export async function recordAdminAction(entry: AuditEntry): Promise<void> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // not authenticated → nothing legitimate to record

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { error } = await db.from("admin_audit_log").insert({
      actor_id:        user.id,
      actor_email:     user.email ?? null,
      action:          entry.action.slice(0, 64),
      entity_type:     entry.entityType.slice(0, 64),
      entity_id:       entry.entityId ?? null,
      previous_status: entry.previousStatus ?? null,
      new_status:      entry.newStatus ?? null,
      reason:          entry.reason ? entry.reason.slice(0, 1000) : null,
      metadata:        entry.metadata ?? null,
    });

    // 42P01 = table not provisioned yet (pre-migration 0025) — not an error worth shouting about.
    if (error && error.code !== "42P01" && error.code !== "PGRST205") {
      console.error("[audit] failed to record", entry.action, error.message);
    }
  } catch (e) {
    console.error("[audit] unexpected failure", e instanceof Error ? e.message : e);
  }
}
