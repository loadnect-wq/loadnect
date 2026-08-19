// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications/service.ts — notification dispatch core (SERVER-ONLY).
//
// The ONLY path that writes the notifications outbox and calls the SMS
// transport. Invariants:
//
//   • RECIPIENTS AND CONTENT ARE SERVER-DECIDED. No function here accepts a
//     client-supplied phone+message pair; callers pass entity ids and the
//     event layer (events.ts) resolves who gets what from the database.
//   • NEVER FAILS THE BUSINESS ACTION. A booking must succeed even if every
//     SMS fails — all errors are recorded on the outbox row and swallowed.
//   • IDEMPOTENT. dedupe_key is UNIQUE in the DB; a webhook redelivery or
//     double-run inserts nothing and sends nothing (23505 → no-op).
//   • OBSERVABLE WHEN DISABLED. With TWILIO_ENABLED=false the row is written
//     with status 'skipped', so the entire pipeline is testable before
//     credentials exist and nothing pretends to have sent.
//   • Writes use the service-role client: business events fire under customer
//     or owner sessions, and RLS (correctly) forbids those sessions from
//     inserting notification rows. The service role is the trusted backend.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizePhoneE164 } from "@/lib/notifications/phone";
import { isTwilioSmsEnabled, isTwilioSmsConfigured, sendSms } from "@/lib/twilio";
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
  message: string;
  bookingId?: string | null;
  hallId?: string | null;
  /** Non-critical messages respect the recipient's SMS preference. */
  critical?: boolean;
  /** From profiles.sms_notifications_enabled, resolved by the event layer. */
  smsOptedIn?: boolean;
};

// Anti-abuse ceilings (automatic sends; manual admin retries are exempt —
// they go through requireAdminActor + the attempt cap):
//   • per PHONE/hour   — stops hammering one recipient
//   • per ACCOUNT/day  — stops one account rotating VICTIM numbers: the
//     customer-SMS recipient can be a client-supplied booking contact number,
//     so capping only by phone would let an attacker spam a fresh victim per
//     booking. Keyed by recipient_user_id.
//   • GLOBAL/day       — a cost fuse: even a novel abuse pattern cannot spend
//     more than this many SMS in a day without an admin noticing.
// Counts include 'processing' (in-flight, claimed) rows so concurrent
// dispatches see each other — pure status='sent' counting was a race.
const MAX_SMS_PER_PHONE_PER_HOUR   = 15;
const MAX_SMS_PER_ACCOUNT_PER_DAY  = 30;
const MAX_SMS_GLOBAL_PER_DAY       = 500;
export const MAX_SEND_ATTEMPTS = 5;

/**
 * Resolves the platform's admin alert number.
 * Priority: ADMIN_NOTIFICATION_PHONE env → CONTACT.phone from lib/constants.
 * Always normalized to E.164; null when neither yields a valid number.
 */
export function getAdminNotificationPhone(): string | null {
  const fromEnv = process.env.ADMIN_NOTIFICATION_PHONE?.trim();
  if (fromEnv) {
    const normalized = normalizePhoneE164(fromEnv);
    if (normalized) return normalized;
    console.error("[notifications] ADMIN_NOTIFICATION_PHONE is not a valid phone number");
  }
  return normalizePhoneE164(CONTACT.phone);
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

    // Preference gate — non-critical only. Recorded (not silently dropped) so
    // the admin center shows WHY nothing was sent.
    const optedOut = req.critical === false && req.smsOptedIn === false;

    const base = {
      dedupe_key: dedupeKey,
      event_type: req.eventType.slice(0, 64),
      recipient_type: req.recipientType,
      recipient_user_id: req.recipientUserId ?? null,
      recipient_phone: phone,
      booking_id: req.bookingId ?? null,
      hall_id: req.hallId ?? null,
      message: req.message.slice(0, 800),
      channel: "sms",
      provider: "twilio",
    };

    let insert: Record<string, unknown>;
    if (optedOut) {
      insert = { ...base, status: "cancelled", error_message: "Recipient has disabled non-critical SMS" };
    } else if (!phone) {
      // §6: a missing owner/customer phone must not fail the business action —
      // record the gap so the admin can see and fix it.
      insert = { ...base, status: "failed", error_message: "Recipient phone number missing or invalid", failed_at: new Date().toISOString() };
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

    await attemptSend(db, row.id, phone as string, base.message, /* isRetry */ false, req.recipientUserId ?? null);
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

/**
 * Shared send path for first attempts and admin retries.
 * Exported for the admin retry action ONLY — callers must authorize first.
 */
export async function attemptSend(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  notificationId: string,
  phone: string,
  message: string,
  isRetry: boolean,
  recipientUserId?: string | null,
): Promise<{ sent: boolean; error?: string }> {
  const now = () => new Date().toISOString();

  // Disabled mode (§17): record 'skipped', keep the app fully working.
  if (!isTwilioSmsEnabled() || !isTwilioSmsConfigured()) {
    const reason = !isTwilioSmsEnabled()
      ? "Twilio is disabled (TWILIO_ENABLED != true)"
      : "Twilio credentials not configured";
    console.log(`[notifications] ${reason} — SMS recorded, not sent`);
    await db.from("notifications")
      .update({ status: "skipped", error_message: reason })
      .eq("id", notificationId);
    return { sent: false, error: reason };
  }

  // ── Atomic claim (CAS) ──────────────────────────────────────────────────────
  // Read current state, then transition to 'processing' ONLY IF status and
  // attempt_count still match what we read. A concurrent duplicate (two admins
  // clicking retry, a webhook redelivery racing the first run) matches 0 rows
  // and bails instead of double-sending.
  const { data: current } = await db
    .from("notifications")
    .select("status, attempt_count")
    .eq("id", notificationId)
    .maybeSingle();
  if (!current) return { sent: false, error: "notification not found" };
  if (current.status === "sent") return { sent: false, error: "already sent" };

  const attempts = (current.attempt_count ?? 0) + 1;
  if (attempts > MAX_SEND_ATTEMPTS) {
    await db.from("notifications")
      .update({ status: "failed", error_message: `Maximum of ${MAX_SEND_ATTEMPTS} attempts reached`, failed_at: now() })
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
    if ((perPhone ?? 0) > MAX_SMS_PER_PHONE_PER_HOUR) {
      return failRate("Rate limit: too many SMS to this number in the last hour");
    }

    if (recipientUserId) {
      const { count: perAccount } = await db
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_user_id", recipientUserId)
        .in("status", inFlight)
        .gte("created_at", dayAgo);
      if ((perAccount ?? 0) > MAX_SMS_PER_ACCOUNT_PER_DAY) {
        return failRate("Rate limit: too many SMS for this account in 24 hours");
      }
    }

    const { count: globalCount } = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .in("status", inFlight)
      .gte("created_at", dayAgo);
    if ((globalCount ?? 0) > MAX_SMS_GLOBAL_PER_DAY) {
      return failRate("Rate limit: platform-wide daily SMS ceiling reached");
    }
  }

  const result = await sendSms(phone, message);

  if (result.ok) {
    await db.from("notifications")
      .update({ status: "sent", provider_message_id: result.providerMessageId, sent_at: now(), error_message: null })
      .eq("id", notificationId);
    return { sent: true };
  }

  const errorMessage =
    result.error === "invalid_phone" ? "Provider rejected the phone number"
    : result.error === "rate_limited" ? "Provider rate limit hit"
    : result.error === "disabled" ? "Twilio is disabled"
    : result.error === "not_configured" ? "Twilio credentials not configured"
    : `Provider error${result.detail ? `: ${result.detail}` : ""}`;

  await db.from("notifications")
    .update({ status: "failed", error_message: errorMessage, failed_at: now() })
    .eq("id", notificationId);
  return { sent: false, error: errorMessage };
}
