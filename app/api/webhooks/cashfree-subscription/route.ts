// ─────────────────────────────────────────────────────────────────────────────
// app/api/webhooks/cashfree-subscription/route.ts
// Cashfree SUBSCRIPTIONS webhook receiver — this is what makes auto-renewal
// actually reach the app.
//
// WHY A SEPARATE ENDPOINT FROM THE ORDER WEBHOOK. Cashfree configures
// subscription webhooks under their own tab, with their own event names and
// payload shapes, and delivers them independently of Payment Gateway events.
// Folding them into /api/webhooks/cashfree would mean one handler guessing
// which product a payload came from — and that handler already carries every
// customer booking. Keeping them apart means a change here can never break
// booking payments.
//
// SECURITY, identical to the order webhook:
//   • The RAW body is read FIRST and used verbatim for signature verification.
//   • HMAC-SHA256 over `${timestamp}${rawBody}`, compared in constant time.
//     Invalid or absent signature → 401, nothing applied.
//   • The body's CONTENT is never trusted. We take only the subscription id
//     from it and then re-read the authoritative state from Cashfree's API.
//     That is what makes the event names irrelevant: whether Cashfree calls it
//     SUBSCRIPTION_NEW_PAYMENT, SUBSCRIPTION_STATUS_CHANGE or something they
//     add next year, the handler does the same correct thing.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { verifyCashfreeWebhookSignature } from "@/lib/cashfree";
import { syncSubscription } from "@/lib/plan-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rawBody = await request.text();

  const signature = request.headers.get("x-webhook-signature");
  const timestamp = request.headers.get("x-webhook-timestamp");

  let verified = false;
  try {
    verified = verifyCashfreeWebhookSignature(rawBody, signature, timestamp);
  } catch (e) {
    console.error("[cf-subs-webhook] signature verification error:", e instanceof Error ? e.message : e);
  }
  if (!verified) {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const eventType: string = payload?.type ?? payload?.event ?? "UNKNOWN";

  // The documented shapes, plus the ones actually observed. Our own id is what
  // we look up by — never Cashfree's internal cf_subscription_id.
  const subscriptionId: string | undefined =
    payload?.data?.subscription_details?.subscription_id ??
    payload?.data?.subscription?.subscription_id ??
    payload?.data?.subscription_id ??
    payload?.subscription?.subscription_id ??
    payload?.subscription_id;

  console.info(`[cf-subs-webhook] event=${eventType} subscription=${subscriptionId ?? "n/a"}`);

  if (!subscriptionId) {
    // Acknowledge so Cashfree stops retrying something we cannot act on.
    return NextResponse.json({ ok: true, ignored: true, event: eventType });
  }

  try {
    // Authoritative: re-reads the subscription AND its charges, and grants a
    // month for any successful charge not yet applied. Idempotent.
    const result = await syncSubscription(subscriptionId);
    console.info(`[cf-subs-webhook] subscription=${subscriptionId} state=${result.state} charges=${result.chargesApplied ?? 0}`);

    // 'error' means we could not finish — a 200 would permanently cancel
    // Cashfree's retries on a renewal we have not recorded, which is how an
    // owner ends up paying for a month they never received.
    //
    // 'unactivated' means the money WAS taken but the boost could not be
    // granted. Same reasoning: keep retrying.
    if (result.state === "error" || result.unactivated) {
      console.error(`[cf-subs-webhook] subscription=${subscriptionId} not fully applied — asking Cashfree to retry`);
      return NextResponse.json({ ok: false, state: result.state }, { status: 503 });
    }

    return NextResponse.json({ ok: true, state: result.state });
  } catch (e) {
    console.error("[cf-subs-webhook] apply failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "processing error" }, { status: 500 });
  }
}

// Cashfree probes the endpoint when the URL is saved in the dashboard.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "cashfree-subscription-webhook" });
}
