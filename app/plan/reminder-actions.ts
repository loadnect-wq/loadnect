"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Server actions behind the plan page's "Reminders on this phone" card (0116).
// The session is the actor: signed in, and able to read the plan through its
// own session (RLS, plan_access), or nothing is written. The phone's push
// address is validated against the known push services.
// ─────────────────────────────────────────────────────────────────────────────

import { getSession } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { parseSafe, planReminderSubscribeSchema, planReminderUnsubscribeSchema } from "@/lib/validation/schemas";
import { pushConfig } from "@/lib/date-alerts.server";
import { removePlanReminder, savePlanReminder } from "@/lib/plan-reminders.server";

const SIGN_IN = "Please sign in again.";

export async function subscribePlanReminders(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pushConfig()) return { ok: false, error: "Reminders are not available right now." };
  const user = await getSession();
  if (!user) return { ok: false, error: SIGN_IN };
  const parsed = parseSafe(planReminderSubscribeSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.data;
  return savePlanReminder({
    sessionDb: await getSupabaseServerClient(),
    userId: user.id,
    planId: v.planId,
    endpoint: v.endpoint,
    p256dh: v.p256dh,
    auth: v.auth,
  });
}

export async function unsubscribePlanReminders(input: unknown): Promise<{ ok: boolean }> {
  const user = await getSession();
  if (!user) return { ok: false };
  const parsed = parseSafe(planReminderUnsubscribeSchema, input);
  if (!parsed.ok) return { ok: false };
  return removePlanReminder({ userId: user.id, planId: parsed.data.planId, endpoint: parsed.data.endpoint });
}
