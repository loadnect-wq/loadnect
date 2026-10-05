// ─────────────────────────────────────────────────────────────────────────────
// lib/error-alerts.ts — tells the admin when a page, route or action breaks.
// SERVER-ONLY. Called from instrumentation.ts onRequestError.
//
// WHY. Until now an error that reached a customer was written to the runtime
// log and nothing else: nobody was told, and Vercel keeps those logs briefly.
// The launch audit called it out ("no error monitoring or alerting at all").
// This needs no new service and no new spend: it goes through the admin alert
// path that already exists — the notifications outbox, the admin webhook
// (ADMIN_ALERT_WEBHOOK_URL) and the approved ADMIN_ALERT SMS.
//
// NOT A FLOOD. One alert per distinct error per day (the outbox dedupe key
// carries a fingerprint and the date), and at most DAILY_CAP alerts a day in
// all — a bot hammering a broken route, or one bad deploy breaking ten pages,
// produces a handful of messages, not hundreds of paid SMS. The log line in
// instrumentation.ts still records every occurrence.
//
// NO PERSONAL DATA. The route PATTERN (/plan/[id], never the id), the kind of
// work and the error's name go out; the message is cut short with emails and
// digit runs masked, because a database error can quote a value such as a
// phone number, and an ntfy topic is readable by anyone who knows its name.
//
// NEVER THROWS. An alert that could fail would add a second error to the
// first.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { createHash } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { todayInBusinessTz } from "@/lib/dates";
import { notifyAdminOperational } from "@/lib/notifications/events";

export const DAILY_CAP = 10;
export const ERROR_EVENT_TYPE = "app.error";

export type ServerErrorReport = {
  /** Route pattern, e.g. "/plan/[id]/[category]". */
  routePath: string;
  /** "render", "route", "action", "proxy". */
  routeType: string;
  name: string;
  message: string;
};

/** Noise, not breakage: a stale tab calling a server action from an old
 *  deployment, and requests the visitor abandoned. */
export function isIgnorable(name: string, message: string): boolean {
  if (name === "AbortError" || name === "ResponseAborted") return true;
  return /Failed to find Server Action/i.test(message);
}

/** The message with anything that could identify a person masked, cut short. */
export function maskMessage(message: string, max = 70): string {
  const masked = message
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]")
    .replace(/\+?\d[\d\s-]{3,}\d/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  return masked.length <= max ? masked : `${masked.slice(0, max - 3).trimEnd()}...`;
}

/** Same error, same day → same key; the outbox's unique index does the rest. */
export function errorFingerprint(r: Pick<ServerErrorReport, "routePath" | "routeType" | "name" | "message">): string {
  const shape = `${r.routePath}|${r.routeType}|${r.name}|${maskMessage(r.message, 120)}`;
  return createHash("sha256").update(shape).digest("hex").slice(0, 12);
}

export async function alertServerError(r: ServerErrorReport): Promise<void> {
  try {
    if (isIgnorable(r.name, r.message)) return;

    // The daily cap, counted from the outbox itself, so it holds across every
    // server instance. A failed count fails CLOSED (no alert): this path runs
    // while something is already broken, and the log line keeps the record.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("event_type", ERROR_EVENT_TYPE)
      .gte("created_at", since);
    if (error || (count ?? 0) >= DAILY_CAP) return;

    // Each template variable is clamped to 60 characters downstream, so each
    // one is built to fit: WHERE in details, WHAT in reference. The runtime
    // log line (instrumentation.ts) has the full message and the digest.
    await notifyAdminOperational(alertFor(r, todayInBusinessTz()));
  } catch {
    // Nothing here is worth a second failure.
  }
}

/** The admin alert for one error. Pure, so its shape and its masking are tested. */
export function alertFor(r: ServerErrorReport, day: string) {
  const name = r.name.slice(0, 24) || "Error";
  return {
    key: `${ERROR_EVENT_TYPE}:${errorFingerprint(r)}:${day}`,
    eventType: ERROR_EVENT_TYPE,
    event: "Site error",
    details: `${r.routePath} (${r.routeType})`.slice(0, 58),
    reference: `${name}: ${maskMessage(r.message, 56 - name.length)}`,
    immediate: true,
  };
}
