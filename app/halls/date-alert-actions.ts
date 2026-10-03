"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Server actions behind the search page's "Tell me if one frees up" button.
// Anonymous by design: an alert needs no account, so these take no session
// and write nothing tied to a person. Everything is validated here; the
// browser's push address is the only key, and only that browser knows it.
// ─────────────────────────────────────────────────────────────────────────────

import { dateAlertSubscribeSchema, dateAlertUnsubscribeSchema, parseSafe } from "@/lib/validation/schemas";
import { pushConfig, removeDateAlert, saveDateAlert } from "@/lib/date-alerts.server";

export async function subscribeDateAlert(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pushConfig()) return { ok: false, error: "Date alerts are not available right now." };
  const parsed = parseSafe(dateAlertSubscribeSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.data;
  return saveDateAlert({ endpoint: v.endpoint, p256dh: v.p256dh, auth: v.auth, date: v.date, city: v.city ?? null });
}

export async function unsubscribeDateAlert(input: unknown): Promise<{ ok: boolean }> {
  const parsed = parseSafe(dateAlertUnsubscribeSchema, input);
  if (!parsed.ok) return { ok: false };
  const v = parsed.data;
  return removeDateAlert({ endpoint: v.endpoint, date: v.date, city: v.city ?? null });
}
