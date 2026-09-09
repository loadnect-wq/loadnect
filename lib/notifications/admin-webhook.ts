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
// The body carries BOTH `text` (Slack, ntfy) and `content` (Discord) with the
// same string, plus the structured fields. Each service renders the key it
// knows and ignores the other, so one payload works everywhere without asking
// the operator which vendor they chose.
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

/**
 * Posts one admin alert. Returns whether it was delivered — for logging only;
 * no caller changes behaviour on the result.
 */
export async function postAdminWebhook(alert: AdminWebhookAlert): Promise<boolean> {
  const url = process.env.ADMIN_ALERT_WEBHOOK_URL?.trim();
  if (!url) return false;

  // https only. A webhook URL is a bearer credential in disguise — anyone
  // holding it can post as us — so it must not travel in clear text.
  if (!/^https:\/\//i.test(url)) {
    console.error("[admin-webhook] ADMIN_ALERT_WEBHOOK_URL must be https; refusing to send");
    return false;
  }

  const text = `Hallnect: ${alert.message}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,                       // Slack, ntfy
        content: text,              // Discord
        event_key: alert.eventKey,  // so a human can correlate with the outbox
        event_type: alert.eventType,
      }),
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
