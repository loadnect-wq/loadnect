// ─────────────────────────────────────────────────────────────────────────────
// app/api/webhooks/twilio-whatsapp/route.ts
//
// Receives Twilio's asynchronous DELIVERY STATUS callbacks for the WhatsApp
// messages we send. Twilio POSTs here each time a message changes state:
//   queued → sent → delivered → read     (or → undelivered / failed)
// so the admin dashboard can show what actually reached the recipient rather
// than only what we handed to Twilio.
//
// SECURITY
//   • The raw body is read FIRST, before any parsing, and used verbatim for
//     signature verification. Calling request.formData() first would consume
//     the stream and destroy the exact bytes the HMAC covers.
//   • An invalid or missing signature → 403, and the body is neither parsed
//     nor logged. Without this, anyone who guessed a Message SID could mark
//     another customer's notification "delivered", or flood the table.
//   • Status callbacks are application/x-www-form-urlencoded, so the form
//     branch of the verifier applies (no bodySHA256 involved).
//   • Writes go through the SERVICE-ROLE client: RLS on public.notifications
//     correctly forbids anonymous writes, and this request carries no session.
//   • The row is located by provider_message_id — a value Twilio itself
//     generated and we stored at send time. A forged SID that matches nothing
//     updates nothing.
//   • Only the delivery fields are written. A status callback can never change
//     a recipient, a message, or a booking.
//
// Responds 200 quickly and unconditionally once verified, per Twilio's webhook
// guidance — a slow or erroring response causes retries and back-off.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { verifyTwilioWebhookSignature, twilioCandidateOrigins } from "@/lib/twilio/signature";
import { parseDeliveryStatus, isFailedDelivery } from "@/lib/twilio/whatsapp";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCanonicalAppUrl } from "@/lib/app-url";

export const runtime = "nodejs";        // crypto for signature verification
export const dynamic = "force-dynamic"; // never cache a webhook

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-twilio-signature");
  const contentType = request.headers.get("content-type");

  const result = verifyTwilioWebhookSignature({
    requestUrl: request.url,
    candidateOrigins: twilioCandidateOrigins(getCanonicalAppUrl()),
    signature,
    rawBody,
    contentType,
  });

  if (!result.ok) {
    // Distinguish "no credentials yet" from a genuine mismatch — before
    // TWILIO_AUTH_TOKEN is set this endpoint cannot verify anything, and a
    // 403 then is expected rather than a sign of an attack.
    console.error(`[twilio-whatsapp] rejected: ${result.reason}`);
    return NextResponse.json({ ok: false, error: result.reason }, { status: 403 });
  }

  const params = new URLSearchParams(rawBody);
  const messageSid = params.get("MessageSid") ?? params.get("SmsSid");
  const rawStatus = params.get("MessageStatus") ?? params.get("SmsStatus");
  const errorCode = params.get("ErrorCode");
  const channelError = params.get("ChannelStatusMessage");
  // WhatsApp read receipts arrive as EventType=READ rather than a status of
  // "read", so both spellings have to be honoured.
  const isReadReceipt = (params.get("EventType") ?? "").toUpperCase() === "READ";

  const status = isReadReceipt ? "read" : parseDeliveryStatus(rawStatus);

  if (!messageSid || !status) {
    // Genuinely from Twilio but not a shape we act on (an inbound message, a
    // status we do not track). Acknowledge so Twilio stops retrying.
    console.log(`[twilio-whatsapp] ignored callback — sid=${messageSid ?? "none"} status=${rawStatus ?? "none"}`);
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;

    const update: Record<string, unknown> = {
      delivery_status: status,
      delivery_updated_at: new Date().toISOString(),
    };

    if (isFailedDelivery(status)) {
      // WhatsApp gave up after we successfully handed the message over. Mark
      // the outbox row failed so it surfaces in the admin "Failed" filter —
      // otherwise a message that was accepted but never delivered would sit
      // in the dashboard looking like a success.
      update.status = "failed";
      update.failed_at = new Date().toISOString();
      update.error_code = errorCode || null;
      update.error_message =
        channelError?.slice(0, 300) ||
        (errorCode ? `WhatsApp could not deliver this message (code ${errorCode})` : "WhatsApp could not deliver this message");
      // 63003 / 63024 mean the recipient or the template is the problem, and a
      // retry repeats it verbatim. Anything else stays retryable.
      update.permanent_failure = errorCode === "63003" || errorCode === "63024";
    }

    const { count } = await db
      .from("notifications")
      .update(update, { count: "exact" })
      .eq("provider_message_id", messageSid);

    console.log(
      `[twilio-whatsapp] ${messageSid} → ${status}` +
      (errorCode ? ` (error ${errorCode})` : "") +
      ((count ?? 0) === 0 ? " — no matching notification" : ""),
    );
  } catch (e) {
    // Never 500 at Twilio: it would retry this callback for hours. The status
    // is informational; the send already happened.
    console.error("[twilio-whatsapp] status update failed:", e instanceof Error ? e.message : "unknown");
  }

  return NextResponse.json({ ok: true });
}

// GET probe so the URL can be sanity-checked before it is pasted into the
// Twilio console. It reveals nothing and performs no signature check.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "twilio-whatsapp-status-callback" });
}
