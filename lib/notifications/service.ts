// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications/service.ts — notification dispatch core (SERVER-ONLY).
//
// The ONLY path that writes the notifications outbox and calls the WhatsApp
// transport. WhatsApp is the sole channel: there is no SMS path and no
// fallback to one. Invariants:
//
//   • RECIPIENTS AND CONTENT ARE SERVER-DECIDED. No function here accepts a
//     client-supplied phone+message pair. Callers pass entity ids and a
//     TEMPLATE KEY; the event layer (events.ts) resolves who gets what from the
//     database, and the template registry decides the wording. A client can
//     never choose the recipient, the sender, or the template.
//   • NEVER FAILS THE BUSINESS ACTION. A booking must succeed even if every
//     message fails — all errors are recorded on the outbox row and swallowed.
//   • IDEMPOTENT. dedupe_key is UNIQUE in the DB; a webhook redelivery or
//     double-run inserts nothing and sends nothing (23505 → no-op).
//   • OBSERVABLE WHEN DISABLED. With TWILIO_WHATSAPP_ENABLED=false, or with no
//     Content SID approved yet, the row is written with status 'skipped' and a
//     precise reason. The whole pipeline is testable before credentials exist
//     and nothing ever pretends to have sent.
//   • Writes use the service-role client: business events fire under customer
//     or owner sessions, and RLS (correctly) forbids those sessions from
//     inserting notification rows. The service role is the trusted backend.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizePhoneE164 } from "@/lib/notifications/phone";
import {
  isWhatsAppEnabled,
  isWhatsAppConfigured,
  isWhatsAppTestMode,
  isPermanentWhatsAppError,
  sendWhatsAppTemplate,
} from "@/lib/twilio/whatsapp";
import {
  contentSidFor,
  resolveTemplate,
  hasMalformedSid,
  renderTemplate,
  WHATSAPP_TEMPLATES,
  type WhatsAppTemplateKey,
} from "@/lib/notifications/whatsapp-templates";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { CONTACT } from "@/lib/constants";

export type RecipientType = "customer" | "owner" | "admin";

export type NotificationRequest = {
  /** Idempotency key WITHOUT recipient suffix, e.g. "booking.requested:<id>". */
  eventKey: string;
  eventType: string;
  recipientType: RecipientType;
  recipientUserId?: string | null;
  /** Raw phone; normalized here. null/invalid → recorded as failed, never thrown. */
  phone: string | null | undefined;
  /** Which approved WhatsApp template carries this event. */
  templateKey: WhatsAppTemplateKey;
  /** Values for the template's positional variables, in declaration order. */
  templateVariables: readonly (string | number | null | undefined)[];
  bookingId?: string | null;
  hallId?: string | null;
  /** Non-critical messages respect the recipient's notification preference. */
  critical?: boolean;
  /** From profiles.whatsapp_notifications_enabled, resolved by the event layer. */
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
//     more than this many messages in a day without an admin noticing.
// Counts include 'processing' (in-flight, claimed) rows so concurrent
// dispatches see each other — pure status='sent' counting was a race.
const MAX_PER_PHONE_PER_HOUR  = 15;
const MAX_PER_ACCOUNT_PER_DAY = 30;
const MAX_GLOBAL_PER_DAY      = 500;
export const MAX_SEND_ATTEMPTS = 5;

/** Where Twilio posts delivery receipts for the messages we send. */
export function whatsappStatusCallbackUrl(): string {
  return `${getCanonicalAppUrl()}/api/webhooks/twilio-whatsapp`;
}

/**
 * Resolves the platform's admin alert number, in priority order:
 *   1. platform_settings.admin_whatsapp_phone — editable by an admin in the UI
 *   2. ADMIN_WHATSAPP_NUMBER env
 *   3. CONTACT.phone from lib/constants
 * Always normalized to E.164; null when none yields a valid number.
 *
 * Async because the authoritative source is now the admin settings row. The
 * env var remains as a deployment-level override for an environment whose
 * database has not been configured yet.
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
      .select("admin_whatsapp_phone")
      .eq("id", true)
      .maybeSingle();
    const fromDb = data?.admin_whatsapp_phone?.trim();
    if (fromDb) {
      const normalized = normalizePhoneE164(fromDb);
      if (normalized) return { phone: normalized, source: "settings" };
      console.error("[notifications] platform_settings.admin_whatsapp_phone is not a valid number");
    }
  } catch {
    // Column or table missing (un-migrated environment) — fall through to env.
  }

  const fromEnv = process.env.ADMIN_WHATSAPP_NUMBER?.trim();
  if (fromEnv) {
    const normalized = normalizePhoneE164(fromEnv);
    if (normalized) return { phone: normalized, source: "env" };
    console.error("[notifications] ADMIN_WHATSAPP_NUMBER is not a valid phone number");
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
    // free-text string — so the stored message is exactly what the approved
    // template renders.
    // The EFFECTIVE template, not the requested one: resolveTemplate may fall
    // back to a superseded template whose SID is configured, and it reshapes
    // the values to that template's positional contract when it does. Storing
    // the effective key/sid/variables together is what keeps the send path, the
    // stored message and the admin dashboard describing the same message.
    const resolved = resolveTemplate(req.templateKey, req.templateVariables);
    const variables = resolved.variables;
    const message = renderTemplate(resolved.key, variables);
    const contentSid = resolved.sid;
    if (resolved.usedFallback) {
      console.warn(
        `[notifications] ${req.templateKey} is not configured — sent via ${resolved.key} instead. ` +
        `Set ${WHATSAPP_TEMPLATES[req.templateKey].envVar} once Meta approves it.`,
      );
    }

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
      channel: "whatsapp",
      provider: "twilio",
      template_key: resolved.key,
      template_sid: contentSid,
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

  const templateKey = current.template_key as WhatsAppTemplateKey | null;
  if (!templateKey || !(templateKey in WHATSAPP_TEMPLATES)) {
    await db.from("notifications")
      .update({
        status: "failed",
        permanent_failure: true,
        error_message: "No WhatsApp template is associated with this notification",
        failed_at: now(),
      })
      .eq("id", notificationId);
    return { sent: false, error: "no template" };
  }

  // ── Not-configured modes: record precisely why, keep the app working ───────
  const contentSid = contentSidFor(templateKey);
  const skip = async (reason: string) => {
    console.log(`[whatsapp] ${reason} — notification recorded, not sent`);
    await db.from("notifications")
      .update({ status: "skipped", error_message: reason, template_sid: contentSid })
      .eq("id", notificationId);
    return { sent: false, error: reason };
  };

  if (!isWhatsAppEnabled()) {
    return skip("WhatsApp is disabled (TWILIO_WHATSAPP_ENABLED != true)");
  }
  if (!isWhatsAppConfigured()) {
    return skip("Twilio WhatsApp credentials or sender not configured");
  }
  if (!contentSid) {
    return skip(
      hasMalformedSid(templateKey)
        ? `${WHATSAPP_TEMPLATES[templateKey].envVar} is not a valid Content SID (expected HX + 32 hex characters)`
        : `No approved WhatsApp template configured — set ${WHATSAPP_TEMPLATES[templateKey].envVar}`,
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

    const inFlight = ["processing", "sent"];
    const { count: perPhone } = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_phone", phone)
      .in("status", inFlight)
      .gte("created_at", hourAgo);
    if ((perPhone ?? 0) > MAX_PER_PHONE_PER_HOUR) {
      return failRate("Rate limit: too many messages to this number in the last hour");
    }

    if (current.recipient_user_id) {
      const { count: perAccount } = await db
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_user_id", current.recipient_user_id)
        .in("status", inFlight)
        .gte("created_at", dayAgo);
      if ((perAccount ?? 0) > MAX_PER_ACCOUNT_PER_DAY) {
        return failRate("Rate limit: too many messages for this account in 24 hours");
      }
    }

    const { count: globalCount } = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .in("status", inFlight)
      .gte("created_at", dayAgo);
    if ((globalCount ?? 0) > MAX_GLOBAL_PER_DAY) {
      return failRate("Rate limit: platform-wide daily message ceiling reached");
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const variables: string[] = Array.isArray(current.template_variables)
    ? (current.template_variables as unknown[]).map((v) => String(v ?? ""))
    : [];

  const result = await sendWhatsAppTemplate({
    toE164: phone,
    contentSid,
    variables,
    statusCallbackUrl: whatsappStatusCallbackUrl(),
  });

  if (result.ok) {
    await db.from("notifications")
      .update({
        status: "sent",
        provider_message_id: result.providerMessageId,
        delivery_status: result.providerStatus,
        delivery_updated_at: now(),
        template_sid: contentSid,
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
  const permanent = isPermanentWhatsAppError(result.kind);
  await db.from("notifications")
    .update({
      status: "failed",
      error_message: result.detail,
      error_code: result.errorCode,
      permanent_failure: permanent,
      template_sid: contentSid,
      test_mode: isWhatsAppTestMode(),
      failed_at: now(),
    })
    .eq("id", notificationId);

  return { sent: false, error: result.detail };
}
