// ─────────────────────────────────────────────────────────────────────────────
// app/api/webhooks/cashfree/route.ts
// Canonical Cashfree webhook (notify_url) receiver.
//
// Handles: PAYMENT_SUCCESS, PAYMENT_FAILED, USER_DROPPED (and refund events are
// acknowledged but not acted on here).
//
// SECURITY:
//   • The RAW request body is read FIRST and used verbatim for signature
//     verification — we never JSON.parse before verifying.
//   • Signature is HMAC-SHA256 over `${timestamp}${rawBody}` with the Cashfree
//     secret, compared in constant time. An invalid/absent signature → 401.
//   • The secret never leaves the server; we log only non-sensitive event
//     metadata (event type, order id, resulting state) — never headers, bodies,
//     or keys.
//   • We do NOT trust the webhook body's amounts/status. We extract the order_id
//     and re-verify against Cashfree's order API inside verifyAndApplyPayment(),
//     which is the single source of truth and is fully idempotent.
//
// IDEMPOTENCY (handled in lib/payments.ts):
//   • Payment update is status-guarded → a repeat success is a no-op.
//   • Booking transition is guarded on the old status → repeats match 0 rows.
//   • Availability is an upsert keyed on (hall_id,date,slot).
//   • Commission insert ignores duplicates (booking_id is UNIQUE).
//   So redelivery of the same event never double-writes anything.
//
// LOCAL DEV: Cashfree cannot reach http://localhost, so this won't fire locally
// unless you expose the app via a tunnel (e.g. ngrok). The return_url status
// page performs the same server-side verification, so bookings still confirm in
// dev without the webhook.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { verifyCashfreeWebhookSignature } from "@/lib/cashfree";
import { verifyAndApplyPayment } from "@/lib/payments";

export const runtime = "nodejs";       // crypto + raw body
export const dynamic = "force-dynamic"; // never cache a webhook

export async function POST(request: Request) {
  // 1. Read the RAW body exactly as sent (signature is computed over these bytes).
  //    Must happen before any parsing.
  const rawBody = await request.text();

  const signature = request.headers.get("x-webhook-signature");
  const timestamp = request.headers.get("x-webhook-timestamp");

  // 2. Verify the signature BEFORE trusting any content. Fail closed.
  let verified = false;
  try {
    verified = verifyCashfreeWebhookSignature(rawBody, signature, timestamp);
  } catch (e) {
    console.error("[cashfree-webhook] signature verification error:", e instanceof Error ? e.message : e);
  }
  if (!verified) {
    // Do not reveal why; just reject.
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }

  // 3. Now it is safe to parse.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const eventType: string = payload?.type ?? payload?.event ?? "UNKNOWN";

  // Extract the order id from the documented webhook shapes.
  const orderId: string | undefined =
    payload?.data?.order?.order_id ??
    payload?.data?.order_id ??
    payload?.order?.order_id ??
    payload?.order_id;

  // Safe log: event type + order id only. No secrets, headers, or PII.
  console.info(`[cashfree-webhook] event=${eventType} order=${orderId ?? "n/a"}`);

  if (!orderId) {
    // Acknowledge events without an order (e.g. some refund/settlement events)
    // so Cashfree stops retrying.
    return NextResponse.json({ ok: true, ignored: true, event: eventType });
  }

  // 4. Re-verify against Cashfree + apply idempotently. This single call covers
  //    PAYMENT_SUCCESS (→ booking_requested, block availability, commission),
  //    PAYMENT_FAILED and USER_DROPPED (→ payment_failed), because it reads the
  //    authoritative order status rather than trusting the event name.
  try {
    const result = await verifyAndApplyPayment(orderId);
    console.info(`[cashfree-webhook] order=${orderId} applied state=${result.state}`);
    // Always 200 on a handled event — even "pending"/"failed" are successfully
    // processed outcomes and should not trigger Cashfree retries.
    return NextResponse.json({ ok: true, state: result.state });
  } catch (e) {
    console.error("[cashfree-webhook] apply failed:", e instanceof Error ? e.message : e);
    // 500 → Cashfree will retry later, which is what we want on a transient
    // database/server error.
    return NextResponse.json({ ok: false, error: "processing error" }, { status: 500 });
  }
}

// Cashfree may probe the endpoint with a GET when you save the webhook URL in
// the dashboard. Respond 200 so the URL validates.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "cashfree-webhook" });
}
