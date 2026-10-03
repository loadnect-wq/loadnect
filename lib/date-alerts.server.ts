// ─────────────────────────────────────────────────────────────────────────────
// lib/date-alerts.server.ts — the server half of date alerts. SERVER-ONLY.
//
// Three jobs:
//   * saveDateAlert / removeDateAlert   the search page's server actions call these
//   * countBookedHalls                  how many halls a date search is hiding
//   * processDateAlerts                 the cron: turn freed dates into notifications
//
// THE TRIGGER ONLY SAYS "SOMETHING CHANGED". enqueue_date_alert (0108) records
// a (hall, date) when its last full-day block is removed, and nothing more. Everything
// that decides whether a family is told is re-checked HERE, at send time:
//   * the hall still exists and is approved — a withdrawn listing is not news;
//   * the date is STILL not blocked — an owner who deletes an entry and
//     re-adds it a minute later (or edits it as delete + insert) freed nothing;
//   * the browser was not already told about this hall.
// The cron runs every ten minutes, which also gives a quick undo time to land
// before anyone is alerted.
//
// PUSH ERRORS. 404/410 from a push service means the browser unsubscribed or
// the subscription expired: the row is deleted. Anything else is transient —
// the delivery is forgotten, the event reopened, and the next run tries again;
// a subscription that keeps failing is dropped after MAX_FAILURES.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { createECDH } from "node:crypto";
import webpush from "web-push";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicClient } from "@/lib/supabase/public";
import { FULL_BLOCK_STATUSES } from "@/lib/availability-status";
import { addDaysToIsoDate, todayInBusinessTz } from "@/lib/dates";
import { CONTACT } from "@/lib/constants";
import { ALERT_HORIZON_DAYS, MAX_ALERTS_PER_BROWSER, alertMessage } from "@/lib/date-alerts";

const MAX_FAILURES = 5;
const EVENTS_PER_RUN = 50;

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * The VAPID key pair, or null when it is not configured — in which case the
 * search page shows no alert button and the cron sends nothing. The public key
 * is handed to the page at request time rather than baked in as NEXT_PUBLIC_*,
 * so setting it in Vercel needs a redeploy of nothing but the env.
 */
export function pushConfig(): { publicKey: string; privateKey: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey };
}

// ── Saving and removing an alert ─────────────────────────────────────────────

export type AlertInput = { endpoint: string; p256dh: string; auth: string; date: string; city: string | null };

/** Whether `date` is one an alert may watch: today (in India) up to the horizon. */
export function isAlertableDate(date: string, today = todayInBusinessTz()): boolean {
  return date >= today && date <= addDaysToIsoDate(today, ALERT_HORIZON_DAYS);
}

/**
 * The keys a real browser sends: p256dh is an uncompressed P-256 point (65
 * bytes, leading 0x04) and auth a 16-byte secret. Checked here so a junk row
 * cannot reach web-push, which throws on malformed keys. The length and prefix
 * are not enough on their own — "BBBB…" decodes to a buffer starting 0x04 — so
 * the point is put through an ECDH computation, which refuses anything that
 * is not on the curve.
 */
export function hasValidPushKeys(p256dh: string, auth: string): boolean {
  try {
    const point = Buffer.from(p256dh, "base64url");
    const secret = Buffer.from(auth, "base64url");
    if (point.length !== 65 || point[0] !== 0x04 || secret.length !== 16) return false;
    const probe = createECDH("prime256v1");
    probe.generateKeys();
    probe.computeSecret(point);
    return true;
  } catch {
    return false;
  }
}

/**
 * A ceiling on the whole table. The action is a public endpoint and the
 * per-browser cap counts per endpoint, so a script inventing endpoints is
 * bounded only by this. Real use is orders of magnitude below it.
 */
const MAX_SUBSCRIPTIONS_TOTAL = 20_000;

export async function saveDateAlert(input: AlertInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isAlertableDate(input.date)) return { ok: false, error: "Choose a date from today onwards." };
  if (!hasValidPushKeys(input.p256dh, input.auth)) {
    return { ok: false, error: "This browser's alert service isn't supported." };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;

  const { count: total, error: totalErr } = await db
    .from("date_alert_subscriptions")
    .select("id", { count: "exact", head: true });
  if (totalErr || (total ?? 0) >= MAX_SUBSCRIPTIONS_TOTAL) {
    if (totalErr) console.error("[date-alerts] total count failed:", totalErr.code, totalErr.message);
    else console.error("[date-alerts] subscription ceiling reached:", total);
    return { ok: false, error: "Could not set the alert. Please try again later." };
  }

  const { count, error: countErr } = await db
    .from("date_alert_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("endpoint", input.endpoint)
    .gte("date", todayInBusinessTz());
  if (countErr) {
    console.error("[date-alerts] count failed:", countErr.code, countErr.message);
    return { ok: false, error: "Could not set the alert. Please try again." };
  }

  // The same browser, date and city again is not a new alert: refresh its keys
  // (a browser can rotate them) and report success.
  let existing = db.from("date_alert_subscriptions").select("id")
    .eq("endpoint", input.endpoint).eq("date", input.date);
  existing = input.city ? existing.eq("city", input.city) : existing.is("city", null);
  const { data: found, error: findErr } = await existing.maybeSingle();
  if (findErr) {
    console.error("[date-alerts] lookup failed:", findErr.code, findErr.message);
    return { ok: false, error: "Could not set the alert. Please try again." };
  }
  if (found) {
    const { error } = await db.from("date_alert_subscriptions")
      .update({ p256dh: input.p256dh, auth: input.auth, failure_count: 0 }).eq("id", found.id);
    if (error) {
      console.error("[date-alerts] refresh failed:", error.code, error.message);
      return { ok: false, error: "Could not set the alert. Please try again." };
    }
    return { ok: true };
  }

  if ((count ?? 0) >= MAX_ALERTS_PER_BROWSER) {
    return { ok: false, error: `This browser already has ${MAX_ALERTS_PER_BROWSER} date alerts. Turn one off first.` };
  }

  const { error } = await db.from("date_alert_subscriptions").insert({
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    date: input.date,
    city: input.city,
  });
  // 23505: a double tap raced the lookup. The alert exists, which is the goal.
  if (error && error.code !== "23505") {
    console.error("[date-alerts] insert failed:", error.code, error.message);
    return { ok: false, error: "Could not set the alert. Please try again." };
  }
  return { ok: true };
}

/** The endpoint is the bearer: only the browser holding it can name it. */
export async function removeDateAlert(input: { endpoint: string; date: string; city: string | null }): Promise<{ ok: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;
  let q = db.from("date_alert_subscriptions").delete().eq("endpoint", input.endpoint).eq("date", input.date);
  q = input.city ? q.eq("city", input.city) : q.is("city", null);
  const { error } = await q;
  if (error) {
    console.error("[date-alerts] delete failed:", error.code, error.message);
    return { ok: false };
  }
  return { ok: true };
}

// ── What the search page shows ───────────────────────────────────────────────

/**
 * How many listed halls have a full-day booking on `date` (in `city`, when
 * given) — exactly the halls the date search hides. Null when the read
 * failed, so the page shows no alert offer rather than a wrong count.
 *
 * Through the anon client, so RLS gives the same answer the search got:
 * approved halls and their public availability rows (0062).
 */
export async function countBookedHalls(
  date: string,
  city: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any = getSupabasePublicClient(),
): Promise<number | null> {
  // Two plain reads rather than an embedded join: the same shape the date
  // search itself uses (lib/halls.ts), so the two cannot disagree about which
  // halls a date hides.
  const { data: blocks, error: blockErr } = await db
    .from("availability")
    .select("hall_id")
    .eq("date", date)
    .in("status", FULL_BLOCK_STATUSES);
  if (blockErr) {
    console.error("[date-alerts] booked count failed:", blockErr.code, blockErr.message);
    return null;
  }
  const ids = [...new Set(((blocks ?? []) as { hall_id: string }[]).map((r) => r.hall_id))];
  if (ids.length === 0) return 0;

  let q = db.from("halls").select("id", { count: "exact", head: true }).in("id", ids).eq("status", "approved");
  if (city) q = q.eq("city", city);
  const { count, error } = await q;
  if (error) {
    console.error("[date-alerts] booked count failed:", error.code, error.message);
    return null;
  }
  return count ?? 0;
}

// ── The sender ───────────────────────────────────────────────────────────────

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
/** Sends one push; resolves on success, rejects with an object carrying `statusCode` on failure. */
export type PushSender = (target: PushTarget, payload: string) => Promise<unknown>;

export type DateAlertSummary = {
  configured: boolean;
  events: number;
  sent: number;
  /** Events dropped at the re-check: hall gone or withdrawn, or the date booked again. */
  skipped: number;
  /** Subscriptions the push service says no longer exist. */
  expired: number;
  /** Transient push failures, retried next run. */
  failed: number;
  /** Subscriptions removed because their date has passed. */
  cleaned: number;
  errors: number;
};

/** The options every push is sent with. Exported so a test can encrypt with exactly these. */
export function pushOptions(cfg: { publicKey: string; privateKey: string }): webpush.RequestOptions {
  return {
    vapidDetails: { subject: `mailto:${CONTACT.email}`, publicKey: cfg.publicKey, privateKey: cfg.privateKey },
    // A freed date is worth hearing about for a day; after that the family
    // has either searched again or moved on.
    TTL: 24 * 60 * 60,
    urgency: "normal",
  };
}

function defaultSender(cfg: { publicKey: string; privateKey: string }): PushSender {
  return (target, payload) => webpush.sendNotification(target, payload, pushOptions(cfg));
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; city: string | null; failure_count: number };

export async function processDateAlerts(deps: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any;
  send?: PushSender;
  today?: string;
} = {}): Promise<DateAlertSummary> {
  const summary: DateAlertSummary = {
    configured: false, events: 0, sent: 0, skipped: 0, expired: 0, failed: 0, cleaned: 0, errors: 0,
  };
  const db = deps.db ?? getSupabaseAdminClient();
  const today = deps.today ?? todayInBusinessTz();

  // Housekeeping first, configured or not: a passed date is no one's business.
  const cleanup = await db.from("date_alert_subscriptions").delete({ count: "exact" }).lt("date", today);
  if (cleanup.error) summary.errors++;
  else summary.cleaned = cleanup.count ?? 0;
  const old = addDaysToIsoDate(today, -30);
  const purge = await db.from("date_alert_events").delete().not("processed_at", "is", null).lt("created_at", `${old}T00:00:00Z`);
  if (purge.error) summary.errors++;

  const cfg = pushConfig();
  const send = deps.send ?? (cfg ? defaultSender(cfg) : null);
  if (!send) return summary;
  summary.configured = true;

  const { data: events, error: evErr } = await db
    .from("date_alert_events")
    .select("id, hall_id, date")
    .is("processed_at", null)
    .order("created_at", { ascending: true })
    .limit(EVENTS_PER_RUN);
  if (evErr) {
    console.error("[date-alerts] events read failed:", evErr.code, evErr.message);
    summary.errors++;
    return summary;
  }

  for (const ev of (events ?? []) as { id: string; hall_id: string; date: string }[]) {
    // Claim it. Vercel can deliver a cron twice; only one run gets the row.
    const { data: claimed, error: claimErr } = await db
      .from("date_alert_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", ev.id)
      .is("processed_at", null)
      .select("id");
    if (claimErr) { summary.errors++; continue; }
    if (!claimed || claimed.length === 0) continue;
    summary.events++;

    if (ev.date < today) { summary.skipped++; continue; }

    const { data: hall, error: hallErr } = await db
      .from("halls").select("id, name, slug, city, status").eq("id", ev.hall_id).maybeSingle();
    if (hallErr) { summary.errors++; await reopen(db, ev.id); continue; }
    if (!hall || hall.status !== "approved") { summary.skipped++; continue; }

    const { count: stillBlocked, error: blockErr } = await db
      .from("availability")
      .select("id", { count: "exact", head: true })
      .eq("hall_id", ev.hall_id)
      .eq("date", ev.date)
      .in("status", FULL_BLOCK_STATUSES);
    if (blockErr) { summary.errors++; await reopen(db, ev.id); continue; }
    if ((stillBlocked ?? 0) > 0) { summary.skipped++; continue; }

    const { data: subsRaw, error: subErr } = await db
      .from("date_alert_subscriptions")
      .select("id, endpoint, p256dh, auth, city, failure_count")
      .eq("date", ev.date);
    if (subErr) { summary.errors++; await reopen(db, ev.id); continue; }
    // City in code, not in an .or() filter: a city name is free text, and
    // PostgREST's filter grammar treats commas and dots as syntax.
    const subs = ((subsRaw ?? []) as Sub[]).filter((s) => s.city === null || s.city === hall.city);
    if (subs.length === 0) continue;

    const { data: done, error: doneErr } = await db
      .from("date_alert_deliveries")
      .select("subscription_id")
      .eq("hall_id", hall.id)
      .in("subscription_id", subs.map((s) => s.id));
    if (doneErr) { summary.errors++; await reopen(db, ev.id); continue; }
    const already = new Set(((done ?? []) as { subscription_id: string }[]).map((d) => d.subscription_id));

    const payload = JSON.stringify(alertMessage(hall, ev.date));
    let retry = false;

    for (const sub of subs) {
      if (already.has(sub.id)) continue;
      // Record first: a crash after the push but before the record would
      // otherwise tell this browser twice.
      const { error: recErr } = await db.from("date_alert_deliveries").insert({ subscription_id: sub.id, hall_id: hall.id });
      if (recErr) {
        if (recErr.code !== "23505") summary.errors++;
        continue;
      }
      try {
        await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        summary.sent++;
        await db.from("date_alert_subscriptions")
          .update({ last_notified_at: new Date().toISOString(), failure_count: 0 }).eq("id", sub.id);
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          summary.expired++;
          await db.from("date_alert_subscriptions").delete().eq("id", sub.id);
          continue;
        }
        summary.failed++;
        console.error("[date-alerts] push failed:", status ?? "", (err as Error)?.message?.slice(0, 200));
        await db.from("date_alert_deliveries").delete().eq("subscription_id", sub.id).eq("hall_id", hall.id);
        if (sub.failure_count + 1 >= MAX_FAILURES) {
          await db.from("date_alert_subscriptions").delete().eq("id", sub.id);
        } else {
          await db.from("date_alert_subscriptions").update({ failure_count: sub.failure_count + 1 }).eq("id", sub.id);
          retry = true;
        }
      }
    }
    if (retry) await reopen(db, ev.id);
  }
  return summary;
}

/**
 * Put an event back for the next run. Best effort: if a newer open event for
 * the same hall and date exists, the unique index refuses this one, and the
 * newer event carries the retry instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function reopen(db: any, id: string): Promise<void> {
  await db.from("date_alert_events").update({ processed_at: null }).eq("id", id);
}
