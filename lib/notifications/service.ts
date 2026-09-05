// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications/service.ts — notification dispatch core (SERVER-ONLY).
//
// The ONLY path that writes the notifications outbox and calls the MSG91 SMS
// transport. SMS over MSG91 is the sole channel: there is no second provider
// and no fallback to one. Invariants:
//
//   • RECIPIENTS AND CONTENT ARE SERVER-DECIDED. No function here accepts a
//     client-supplied phone+message pair. Callers pass entity ids and a
//     TEMPLATE KEY; the event layer (events.ts) resolves who gets what from the
//     database, and the template registry decides the wording. A client can
//     never choose the recipient, the sender, or the template.
//   • NEVER FAILS THE BUSINESS ACTION. A booking must succeed even if every
//     message fails — all errors are recorded on the outbox row and swallowed.
//   • IDEMPOTENT. dedupe_key is UNIQUE in the DB; a webhook redelivery or
//     double-run inserts nothing and sends nothing (23505 -> no-op).
//   • OBSERVABLE WHEN DISABLED. With MSG91_SMS_ENABLED=false, or with no DLT
//     template id yet, the row is written with status 'skipped' and a precise
//     reason. The whole pipeline is testable before credentials exist and
//     nothing ever pretends to have sent.
//   • Writes use the service-role client: business events fire under customer
//     or owner sessions, and RLS (correctly) forbids those sessions from
//     inserting notification rows. The service role is the trusted backend.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizePhoneE164 } from "@/lib/notifications/phone";
import {
  isSmsEnabled,
  isMsg91Configured,
  isSmsTestMode,
  sendTemplatedSms,
} from "@/lib/msg91";
import {
  templateIdFor,
  hasMalformedTemplateId,
  coerceVariables,
  renderTemplate,
  SMS_TEMPLATES,
  type SmsTemplateKey,
} from "@/lib/notifications/sms-templates";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { CONTACT } from "@/lib/constants";

export type RecipientType = "customer" | "owner" | "admin";

export type NotificationRequest = {
  /** Idempotency key WITHOUT recipient suffix, e.g. "booking.requested:<id>". */
  eventKey: string;
  eventType: string;
  recipientType: RecipientType;
  recipientUserId?: string | null;
  /** Raw phone; normalized here. null/invalid -> recorded as failed, never thrown. */
  phone: string | null | undefined;
  /** Which registered SMS template carries this event. */
  templateKey: SmsTemplateKey;
  /** Values for the template's positional variables, in declaration order. */
  templateVariables: readonly (string | number | null | undefined)[];
  bookingId?: string | null;
  hallId?: string | null;
  /** Non-critical messages respect the recipient's notification preference. */
  critical?: boolean;
  /** From profiles.notifications_enabled, resolved by the event layer. */
  optedIn?: boolean;
};

// Anti-abuse ceilings (automatic sends; manual admin retries are exempt —
// they go through requireAdminActor + the attempt cap):
//   • per PHONE/hour   — stops hammering one recipient
//   • per ACCOUNT/day  — stops one account rotating VICTIM numbers: the
//     customer recipient can be a client-supplied booking contact number, so
//     capping only by phone would let an attacker spam a fresh victim per
//     booking. Keyed by recipient_user_id.
//   • GLOBAL/day       — a cost fuse: even a novel abuse pattern cannot spend
//     more than this many messages in a day without an admin noticing. Each
//     one is a billed SMS, so this is a real rupee ceiling, not a soft limit.
// Counts include 'processing' (in-flight, claimed) rows so concurrent
// dispatches see each other — pure status='sent' counting was a race — and are
// keyed on provider_message_id rather than on the current status, so a
// delivery report arriving later cannot refund an already-billed message.
const MAX_PER_PHONE_PER_HOUR  = 15;
const MAX_PER_ACCOUNT_PER_DAY = 30;
const MAX_GLOBAL_PER_DAY      = 500;
export const MAX_SEND_ATTEMPTS = 5;

/** Where MSG91 posts delivery reports for the messages we send. */
export function smsDeliveryWebhookUrl(): string {
  return `${getCanonicalAppUrl()}/api/webhooks/msg91`;
}

/**
 * Resolves the platform's admin alert number, in priority order:
 *   1. platform_settings.admin_alert_phone — editable by an admin in the UI
 *   2. ADMIN_ALERT_PHONE env
 *   3. CONTACT.phone from lib/constants
 * Always normalized to E.164; null when none yields a valid number.
 *
 * Async because the authoritative source is the admin settings row. The env
 * var remains a deployment-level override for an environment whose database
 * has not been configured yet.
 */
export async function getAdminNotificationPhone(): Promise<string | null> {
  return (await resolveAdminNotificationPhone()).phone;
}

/** Where the admin alert number in effect actually came from. */
export type AdminPhoneSource = "settings" | "env" | "constant" | "none";

/**
 * Same resolution as getAdminNotificationPhone, but also reports WHICH source
 * won. The admin dashboard shows this so it is obvious whether the number can
 * be changed in the UI or is pinned by an environment variable.
 */
export async function resolveAdminNotificationPhone(): Promise<{
  phone: string | null;
  source: AdminPhoneSource;
}> {
  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;
    const { data } = await db
      .from("platform_settings")
      .select("admin_alert_phone")
      .eq("id", true)
      .maybeSingle();
    const fromDb = data?.admin_alert_phone?.trim();
    if (fromDb) {
      const normalized = normalizePhoneE164(fromDb);
      if (normalized) return { phone: normalized, source: "settings" };
      console.error("[notifications] platform_settings.admin_alert_phone is not a valid number");
    }
  } catch {
    // Column or table missing (un-migrated environment) — fall through to env.
  }

  // ADMIN_WHATSAPP_NUMBER is read as a LEGACY name so a deployment mid-rename
  // keeps alerting instead of going silent. Remove it once the hosting
  // environment has been switched to ADMIN_ALERT_PHONE.
  const fromEnv =
    process.env.ADMIN_ALERT_PHONE?.trim() || process.env.ADMIN_WHATSAPP_NUMBER?.trim();
  if (fromEnv) {
    const normalized = normalizePhoneE164(fromEnv);
    if (normalized) return { phone: normalized, source: "env" };
    console.error("[notifications] ADMIN_ALERT_PHONE is not a valid phone number");
  }

  const fallback = normalizePhoneE164(CONTACT.phone);
  return fallback
    ? { phone: fallback, source: "constant" }
    : { phone: null, source: "none" };
}

/**
 * Records one notification in the outbox and attempts delivery.
 * Never throws; every outcome lands on the row's status.
 */
export async function dispatchNotification(req: NotificationRequest): Promise<void> {
  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;

    const dedupeKey = `${req.eventKey}:${req.recipientType}`.slice(0, 200);
    const phone = req.phone ? normalizePhoneE164(req.phone) : null;

    // Content is derived from the template registry, never from a caller's
    // free-text string — so the stored message is exactly what the registered
    // template renders, with the SAME GSM-7-sanitised values that go on the
    // wire. Storing the variables alongside the key is what lets an admin
    // retry reproduce the message without re-deriving it.
    const variables = coerceVariables(req.templateKey, req.templateVariables);
    const message = renderTemplate(req.templateKey, variables);
    const templateId = templateIdFor(req.templateKey);

    // Preference gate — non-critical only. Recorded (not silently dropped) so
    // the admin center shows WHY nothing was sent.
    const optedOut = req.critical === false && req.optedIn === false;

    const base = {
      dedupe_key: dedupeKey,
      event_type: req.eventType.slice(0, 64),
      recipient_type: req.recipientType,
      recipient_user_id: req.recipientUserId ?? null,
      recipient_phone: phone,
      booking_id: req.bookingId ?? null,
      hall_id: req.hallId ?? null,
      message: message.slice(0, 800),
      channel: "sms",
      provider: "msg91",
      template_key: req.templateKey,
      provider_template_id: templateId,
      template_variables: variables,
    };

    let insert: Record<string, unknown>;
    if (optedOut) {
      insert = {
        ...base,
        status: "cancelled",
        error_message: "Recipient has disabled non-critical notifications",
      };
    } else if (!phone) {
      // A missing owner/customer phone must not fail the business action —
      // record the gap so an admin can see and fix it.
      insert = {
        ...base,
        status: "failed",
        permanent_failure: true,
        error_message: "Recipient phone number missing or invalid",
        failed_at: new Date().toISOString(),
      };
    } else {
      insert = { ...base, status: "pending" };
    }

    const { data: row, error: insErr } = await db
      .from("notifications")
      .insert(insert)
      .select("id, status")
      .single();

    if (insErr) {
      // 23505 = this exact event+recipient was already processed. The core
      // idempotency guarantee: retries and webhook redeliveries stop here.
      if (insErr.code !== "23505") {
        console.error("[notifications] outbox insert failed:", insErr.code, insErr.message);
      }
      return;
    }

    if (row.status !== "pending") return; // cancelled / failed-at-insert — done.

    await attemptSend(db, row.id, /* isRetry */ false);
  } catch (e) {
    console.error("[notifications] dispatch error:", e instanceof Error ? e.message : e);
  }
}

/** Convenience: dispatch several notifications; failures are independent. */
export async function dispatchAll(requests: NotificationRequest[]): Promise<void> {
  for (const req of requests) {
    await dispatchNotification(req);
  }
}

export type AttemptResult = { sent: boolean; error?: string };

/**
 * Shared send path for first attempts and admin retries.
 *
 * Reads everything it needs from the outbox row rather than taking a phone and
 * a body as arguments. That is deliberate: an admin retry re-reads the stored
 * recipient and template, so a retry cannot be talked into delivering the same
 * message somewhere else.
 *
 * Exported for the admin retry action ONLY — callers must authorize first.
 */
export async function attemptSend(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  notificationId: string,
  isRetry: boolean,
): Promise<AttemptResult> {
  const now = () => new Date().toISOString();

  const { data: current } = await db
    .from("notifications")
    .select(
      "id, status, attempt_count, recipient_phone, recipient_user_id, template_key, template_variables",
    )
    .eq("id", notificationId)
    .maybeSingle();

  if (!current) return { sent: false, error: "notification not found" };
  if (current.status === "sent") return { sent: false, error: "already sent" };

  const phone: string | null = current.recipient_phone;
  if (!phone) {
    await db.from("notifications")
      .update({
        status: "failed",
        permanent_failure: true,
        error_message: "Recipient phone number missing or invalid",
        failed_at: now(),
      })
      .eq("id", notificationId);
    return { sent: false, error: "no recipient phone" };
  }

  const templateKey = current.template_key as SmsTemplateKey | null;
  if (!templateKey || !(templateKey in SMS_TEMPLATES)) {
    await db.from("notifications")
      .update({
        status: "failed",
        permanent_failure: true,
        error_message: "No SMS template is associated with this notification",
        failed_at: now(),
      })
      .eq("id", notificationId);
    return { sent: false, error: "no template" };
  }

  // ── Not-configured modes: record precisely why, keep the app working ───────
  const templateId = templateIdFor(templateKey);
  const skip = async (reason: string) => {
    console.log(`[sms] ${reason} — notification recorded, not sent`);
    await db.from("notifications")
      .update({ status: "skipped", error_message: reason, provider_template_id: templateId })
      .eq("id", notificationId);
    return { sent: false, error: reason };
  };

  if (!isSmsEnabled()) {
    return skip("SMS is disabled (MSG91_SMS_ENABLED != true)");
  }
  if (!isMsg91Configured()) {
    return skip("MSG91 auth key or DLT sender ID is not configured");
  }
  if (!templateId) {
    return skip(
      hasMalformedTemplateId(templateKey)
        ? `${SMS_TEMPLATES[templateKey].envVar} is not a valid MSG91 template id (expected 24 hex characters)`
        : `No DLT-approved SMS template configured — set ${SMS_TEMPLATES[templateKey].envVar}`,
    );
  }

  // ── Atomic claim (CAS) ────────────────────────────────────────────────────
  // Read current state, then transition to 'processing' ONLY IF status and
  // attempt_count still match what we read. A concurrent duplicate (two admins
  // clicking retry, a webhook redelivery racing the first run) matches 0 rows
  // and bails instead of double-sending.
  const attempts = (current.attempt_count ?? 0) + 1;
  if (attempts > MAX_SEND_ATTEMPTS) {
    await db.from("notifications")
      .update({
        status: "failed",
        permanent_failure: true,
        error_message: `Maximum of ${MAX_SEND_ATTEMPTS} attempts reached`,
        failed_at: now(),
      })
      .eq("id", notificationId);
    return { sent: false, error: "max attempts reached" };
  }

  const { count: claimed } = await db
    .from("notifications")
    .update({ status: "processing", attempt_count: attempts }, { count: "exact" })
    .eq("id", notificationId)
    .eq("status", current.status)
    .eq("attempt_count", current.attempt_count);
  if ((claimed ?? 0) === 0) {
    return { sent: false, error: "another process is already sending this notification" };
  }

  // ── Rate ceilings (automatic sends only; the claim row counts as in-flight) ─
  if (!isRetry) {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const dayAgo  = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const failRate = async (msg: string) => {
      await db.from("notifications")
        .update({ status: "failed", error_message: msg, failed_at: now() })
        .eq("id", notificationId);
      return { sent: false, error: msg };
    };

    // WHAT THESE CEILINGS COUNT: MONEY ALREADY SPENT, NOT ROWS STILL LOOKING
    // HOPEFUL. Counting status in ('processing','sent') was a hole, because a
    // row does not stay 'sent': /api/webhooks/msg91 flips it to 'failed' the
    // moment the operator reports a DND block or a rejection. That message was
    // BILLED — MSG91 accepted it and charged for it — yet the status change
    // handed its slot back, so a number that cannot receive anything (a DND
    // handset, a dead operator route) would refill the allowance and let the
    // platform keep paying to text it.
    //
    // provider_message_id is set only when MSG91 accepted a send, and is never
    // cleared, so "ever reached the provider" is exactly the billed set. Plus
    // 'processing': a claim in flight that we may be about to be billed for,
    // which is what makes concurrent dispatches see each other.
    // DO NOT narrow this back to status alone without changing the webhook too.
    const billed = "status.eq.processing,provider_message_id.not.is.null";

    // The two RECIPIENT-scoped ceilings FAIL OPEN on a read error, deliberately:
    // an unreadable notifications table must not stop every booking
    // confirmation on the platform. The global fuse below does the opposite,
    // for the reason written out there.
    const { count: perPhone, error: perPhoneErr } = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_phone", phone)
      .or(billed)
      .gte("created_at", hourAgo);
    if (perPhoneErr) {
      console.error("[notifications] per-phone ceiling unreadable:",
        perPhoneErr.code, perPhoneErr.message);
    } else if ((perPhone ?? 0) > MAX_PER_PHONE_PER_HOUR) {
      return failRate("Rate limit: too many messages to this number in the last hour");
    }

    if (current.recipient_user_id) {
      const { count: perAccount, error: perAccountErr } = await db
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_user_id", current.recipient_user_id)
        .or(billed)
        .gte("created_at", dayAgo);
      if (perAccountErr) {
        console.error("[notifications] per-account ceiling unreadable:",
          perAccountErr.code, perAccountErr.message);
      } else if ((perAccount ?? 0) > MAX_PER_ACCOUNT_PER_DAY) {
        return failRate("Rate limit: too many messages for this account in 24 hours");
      }
    }

    // THE COST FUSE FAILS CLOSED, unlike its two siblings above. Supabase
    // returns count === null on a query error, which is indistinguishable from
    // a genuine zero — so reading `count ?? 0` let the send proceed precisely
    // when nothing was counting it. That is the same argument
    // app/verify-phone/actions.ts writes out for its own global fuse: an
    // unreadable counter means the guard rails are down, not that the platform
    // is quiet, and every send below is real money out of a prepaid wallet.
    //
    // Recorded as 'failed' WITHOUT permanent_failure, so the row stays
    // retryable: this is our outage, not the recipient's, and an admin can
    // resend once the table reads again.
    const { count: globalCount, error: globalErr } = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .or(billed)
      .gte("created_at", dayAgo);
    if (globalErr) {
      console.error("[notifications] global cost fuse unreadable:",
        globalErr.code, globalErr.message);
      return failRate(
        "Could not read the platform-wide message ceiling — not sent. Retry once it reads again.",
      );
    }
    if ((globalCount ?? 0) > MAX_GLOBAL_PER_DAY) {
      return failRate("Rate limit: platform-wide daily message ceiling reached");
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const variables: string[] = Array.isArray(current.template_variables)
    ? (current.template_variables as unknown[]).map((v) => String(v ?? ""))
    : [];

  const result = await sendTemplatedSms({ toE164: phone, templateId, variables });

  if (result.ok) {
    await db.from("notifications")
      .update({
        status: "sent",
        provider_message_id: result.providerMessageId,
        // MSG91 accepts the request and reports delivery later on the webhook.
        // 'accepted' says exactly that, and is not upgraded until a delivery
        // report actually arrives.
        delivery_status: "accepted",
        delivery_updated_at: now(),
        provider_template_id: templateId,
        test_mode: result.redirectedTo !== null,
        sent_at: now(),
        error_message: result.redirectedTo
          ? "TEST MODE — delivered to the configured test number, not the real recipient"
          : null,
        error_code: null,
        permanent_failure: false,
      })
      .eq("id", notificationId);
    return { sent: true };
  }

  // A permanent failure is marked so the admin UI does not offer a retry that
  // is guaranteed to fail the same way. Transient failures stay retryable.
  await db.from("notifications")
    .update({
      status: "failed",
      error_message: result.detail,
      error_code: result.kind,
      permanent_failure: result.permanent,
      provider_template_id: templateId,
      test_mode: isSmsTestMode(),
      failed_at: now(),
    })
    .eq("id", notificationId);

  return { sent: false, error: result.detail };
}
