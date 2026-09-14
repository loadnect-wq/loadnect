// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications/admin-webhook.ts — a second transport for ADMIN alerts.
// SERVER-ONLY.
//
// WHY THIS EXISTS. The app already decides carefully what deserves a human — a
// payout that did not confirm, refunds past SLA, a reconcile that failed — and
// then hands every one of them to exactly one transport: MSG91 SMS. Every MSG91
// template is DLT-gated, so until DLT approval lands, an operational alert is
// composed, recorded in the outbox, and reaches nobody. "We have alerting" and
// "an alert can leave the building" were two different claims, and only the
// first was true.
//
// This is deliberately the dumbest possible transport: one POST, no SDK, no
// vendor. A Slack incoming webhook, a Discord webhook, an ntfy.sh topic and a
// self-hosted endpoint all accept it, so the operator picks whichever they will
// actually see on their phone and pastes the URL into ADMIN_ALERT_WEBHOOK_URL.
//
// The body carries BOTH `text` (Slack) and `content` (Discord) with the same
// string, plus `title`/`message` for ntfy and the structured fields. Each
// service renders the keys it knows and ignores the rest, so one payload works
// everywhere without asking the operator which vendor they chose.
//
// ════════════════════════════════════════════════════════════════════════════
// THE ntfy SPECIAL CASE, AND WHY IT IS NOT OPTIONAL
// ════════════════════════════════════════════════════════════════════════════
// An earlier version of this file claimed ntfy "accepts it" and posted the JSON
// body straight to https://ntfy.sh/<topic>. ntfy returned 200, this function
// returned true, and the operator's phone showed:
//
//     "You received a file: attachment.json"
//
// — because ntfy treats a POST to a topic URL whose content-type is not
// text/plain as a FILE UPLOAD, not a message. Every guard in here was working
// and the alert still said nothing. That is the fail-open shape this codebase
// keeps finding: a success return standing in for a delivery that did not
// happen, and it was only caught by actually sending one and reading what came
// back.
//
// ntfy's JSON publishing lives at the ROOT of the server with the topic INSIDE
// the body, so an ntfy URL is rewritten to that form. Slack, Discord and any
// self-hosted endpoint are posted exactly as before — the rewrite is keyed on
// the hostname and touches nothing else. Verified against the live service:
// root + {topic,title,message} renders the message as the notification text,
// with the extra Slack/Discord keys tolerated and ignored.
//
// UNSET IS A VALID STATE, not an error. With no URL configured this is a no-op
// and the SMS path is unchanged — the app must not start logging failures
// because a feature nobody enabled is not enabled.
//
// NEVER THROWS. A notification transport that can throw would take down the
// booking or payout it was reporting on, which is the rule this whole subsystem
// is built around: core transactions must not fail because a message did not.
//
// IDEMPOTENCY IS INHERITED, NOT REIMPLEMENTED. The only caller fires this on
// the path where the outbox INSERT succeeded — the dedupe_key unique index has
// already rejected a repeat by then. That matters concretely: the overdue-refund
// alert now runs three times a day against one daily dedupe key, and this must
// not turn one SMS into three pings.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

/** Kept short: an alert that has not left in five seconds is not an alert. */
const TIMEOUT_MS = 5_000;

export type AdminWebhookAlert = {
  eventKey: string;
  eventType: string;
  message: string;
};

export function isAdminWebhookConfigured(): boolean {
  const url = process.env.ADMIN_ALERT_WEBHOOK_URL?.trim();
  return !!url && /^https:\/\//i.test(url);
}

/** ntfy.sh and any subdomain of it. A self-hosted instance on another hostname
 *  is posted the generic way; see the note in buildAdminWebhookRequest. */
function isNtfyHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "ntfy.sh" || h.endsWith(".ntfy.sh");
}

export type AdminWebhookRequest =
  | { ok: true; endpoint: string; body: Record<string, string> }
  | { ok: false; reason: string };

/**
 * Decides where to POST and what to send. Pure, and exported so the ntfy
 * rewrite is covered by tests rather than by a comment claiming it works.
 */
export function buildAdminWebhookRequest(
  rawUrl: string,
  alert: AdminWebhookAlert,
): AdminWebhookRequest {
  // https only. A webhook URL is a bearer credential in disguise — anyone
  // holding it can post as us — so it must not travel in clear text.
  if (!/^https:\/\//i.test(rawUrl)) {
    return { ok: false, reason: "ADMIN_ALERT_WEBHOOK_URL must be https" };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "ADMIN_ALERT_WEBHOOK_URL is not a valid URL" };
  }

  const text = `Hallnect: ${alert.message}`;
  const body: Record<string, string> = {
    text,                       // Slack
    content: text,              // Discord
    title: "Hallnect",          // ntfy
    message: alert.message,     // ntfy — the title already carries the brand
    event_key: alert.eventKey,  // so a human can correlate with the outbox
    event_type: alert.eventType,
  };

  if (!isNtfyHost(parsed.hostname)) {
    return { ok: true, endpoint: rawUrl, body };
  }

  // ntfy: the topic moves out of the path and into the payload, and the POST
  // goes to the server root. A topic is a single path segment.
  const topic = parsed.pathname.split("/").filter(Boolean)[0];
  if (!topic) {
    return {
      ok: false,
      reason: "ADMIN_ALERT_WEBHOOK_URL points at ntfy with no topic in the path",
    };
  }
  return { ok: true, endpoint: `${parsed.origin}/`, body: { ...body, topic } };
}

type MinimalResponse = { ok: boolean; status: number };
type FetchLike = (url: string, init: RequestInit) => Promise<MinimalResponse>;

/**
 * Posts one admin alert. Returns whether it was delivered — for logging only;
 * no caller changes behaviour on the result.
 */
export async function postAdminWebhook(
  alert: AdminWebhookAlert,
  fetchImpl?: FetchLike,
): Promise<boolean> {
  const url = process.env.ADMIN_ALERT_WEBHOOK_URL?.trim();
  if (!url) return false;

  const req = buildAdminWebhookRequest(url, alert);
  if (!req.ok) {
    // The REASON only, never the URL — it is a credential.
    console.error("[admin-webhook]", req.reason, "; refusing to send");
    return false;
  }

  const doFetch = fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!doFetch) return false;

  try {
    const res = await doFetch(req.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      // The STATUS only. The URL is a credential and must never reach a log.
      console.error("[admin-webhook] delivery failed with status", res.status);
      return false;
    }
    return true;
  } catch (e) {
    console.error(
      "[admin-webhook] delivery threw:",
      e instanceof Error ? e.message : "unknown",
    );
    return false;
  }
}
