// ─────────────────────────────────────────────────────────────────────────────
// app/api/webhooks/cashfree/route.ts
// Canonical Cashfree webhook (notify_url) receiver.
//
// Handles: PAYMENT_SUCCESS, PAYMENT_FAILED, USER_DROPPED (re-verified against
// the order API) and REFUND status events (re-verified against the refund API).
//
// SECURITY:
//   • The RAW request body is read FIRST and used verbatim for signature
//     verification — we never JSON.parse before verifying.
//   • Signature is HMAC-SHA256 over `${timestamp}${rawBody}` with the Cashfree
//     secret, compared in constant time. An invalid/absent signature → 401.
//   • The secret never leaves the server; we log only non-sensitive event
//     metadata (event type, order id, resulting state) — never headers, bodies,
//     or keys.
//   • We do NOT trust the webhook body's amounts/status. We extract the order id
//     (and, on a refund event, the refund id) and re-verify against Cashfree,
//     which is the single source of truth and whose apply paths are idempotent.
//
// IDEMPOTENCY (handled in lib/payments.ts):
//   • Payment update is status-guarded → a repeat success is a no-op.
//   • Booking transition is guarded on the old status → repeats match 0 rows.
//   • Availability is an upsert keyed on (hall_id,date,slot).
//   • Commission insert ignores duplicates (booking_id is UNIQUE).
//   So redelivery of the same event never double-writes anything.
//
// AUDIT TRAIL:
//   • Every VERIFIED event is written to payment_webhook_events before it is
//     applied and stamped with its outcome afterwards (lib/settlement.ts). That
//     table is the record of what the gateway said and when — the only evidence
//     a redelivery happened at all, and the first thing to read when a booking
//     and Cashfree disagree about money.
//   • The write is strictly best-effort and never changes the response. See
//     recordSafely() for why that direction is the safe one.
//
// LOCAL DEV: Cashfree cannot reach http://localhost, so this won't fire locally
// unless you expose the app via a tunnel (e.g. ngrok). The return_url status
// page performs the same server-side verification, so bookings still confirm in
// dev without the webhook.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import {
  verifyCashfreeWebhookSignature,
  getCashfreeRefund,
  classifyRefundStatus,
} from "@/lib/cashfree";
import { verifyAndApplyPayment } from "@/lib/payments";
import { isPlanOrderId, verifyAndApplyPlanPurchase } from "@/lib/plan-payments";
import { recordWebhookEvent, markWebhookProcessed } from "@/lib/settlement";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyAdminOperational } from "@/lib/notifications/events";

export const runtime = "nodejs";       // crypto + raw body
export const dynamic = "force-dynamic";

/**
 * WHY THIS IS DECLARED AT ALL.
 *
 * Nothing set maxDuration anywhere in this app, so every route ran on the
 * platform default. That was survivable while notification sends were the only
 * slow thing and nobody had measured them; it stopped being survivable when
 * MSG91 went live, because dispatch now makes a real provider round trip per
 * message and dispatchAll is sequential.
 *
 * Sends are deferred with after() (lib/notifications/service.ts), which does
 * NOT buy extra time — after() runs inside this route's max duration. So the
 * budget has to be stated rather than inherited: without it, deferring merely
 * moves the timeout from "the user waits" to "the send is killed silently
 * after the response looked fine".
 *
 * 60 is the ceiling on the Vercel Hobby plan this project is on. Asking for
 * more is a deployment error, not a slower function.
 */
export const maxDuration = 60;
 // never cache a webhook

// ── Audit trail ──────────────────────────────────────────────────────────────

/**
 * The idempotency key for one delivery.
 *
 * Cashfree's webhooks carry no event id of their own, so there is nothing to
 * quote. Deriving one from (type, order) would be worse than nothing: a refund
 * reports PENDING and later SUCCESS under the same type for the same order, so
 * the two would collapse onto one row and the trail would lose exactly the
 * transition it exists to show. A digest of the bytes we just verified is
 * unique per distinct event, and a redelivery of the same bytes lands on the
 * same row. If a retry ever arrived with the body altered it would simply
 * record a second row — the trail gains an entry rather than losing one, and
 * nothing below skips work on the strength of a duplicate.
 */
function webhookEventId(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

/**
 * The event body as stored, minus the customer's contact details.
 *
 * Cashfree echoes customer_name / customer_email / customer_phone back in
 * data.customer_details. All three are already on the booking, so copying them
 * into a second table spreads the same personal data further and buys no
 * evidence: what a dispute turns on is the ids, the amounts and the status, and
 * those all stay.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function auditablePayload(payload: any): any {
  const data = payload?.data;
  if (!payload || typeof payload !== "object" || !data || typeof data !== "object") {
    return payload ?? null;
  }
  const { customer_details: _contact, ...rest } = data;
  void _contact;
  return { ...payload, data: rest };
}

/**
 * Writes the audit row. NEVER throws, and NEVER influences the response.
 *
 * The direction matters. Cashfree retries on any non-200, so letting a failed
 * bookkeeping write fail the request would turn an event we DID apply into a
 * permanent redelivery loop — replaying the apply path against a booking that
 * is already correct, for as long as the table is unwritable. A missing audit
 * row is a gap in the evidence; a non-200 for applied money is an incident.
 *
 * A DUPLICATE IS LOGGED, NOT OBEYED. The obvious use of UNIQUE(provider,
 * event_id) — seen it before, return 200, do nothing — is the wrong one here:
 * the earlier delivery may have ended in the 503 below precisely because it
 * could NOT be applied, and swallowing its retry would strand a paid booking
 * with nobody told. Everything downstream is idempotent (see IDEMPOTENCY
 * above), so re-applying a genuine duplicate costs a Cashfree round trip and
 * changes nothing. Skipping a retry costs a customer their booking.
 */
async function recordSafely(input: {
  eventId: string;
  eventType: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}): Promise<void> {
  try {
    const res = await recordWebhookEvent({
      eventId:   input.eventId,
      eventType: input.eventType,
      payload:   auditablePayload(input.payload),
      // Only verified events reach here, and that is deliberate: anyone can
      // POST to this URL, so recording rejected requests would hand a stranger
      // an unbounded write into the audit table.
      signatureVerified: true,
    });
    if (!res.ok) {
      console.error(`[cashfree-webhook] audit write failed: ${res.error}`);
    } else if (res.duplicate) {
      console.info(`[cashfree-webhook] event=${input.eventType} seen before — redelivery, applying again`);
    }
  } catch (e) {
    console.error("[cashfree-webhook] audit write failed:", e instanceof Error ? e.message : e);
  }
}

/** Stamps the outcome onto the audit row. Same rule as recordSafely: silent. */
async function markSafely(
  eventId: string,
  status: "PROCESSED" | "FAILED" | "IGNORED",
  note?: string,
): Promise<void> {
  try {
    await markWebhookProcessed(eventId, status, note);
  } catch (e) {
    console.error("[cashfree-webhook] audit stamp failed:", e instanceof Error ? e.message : e);
  }
}

// ── Refund events ────────────────────────────────────────────────────────────

/** Refund identifiers, read defensively from the shapes a refund event uses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function refundIdsFrom(payload: any): { orderId?: string; refundId?: string } {
  const refund = payload?.data?.refund ?? payload?.refund ?? payload?.data;
  return {
    orderId:  refund?.order_id ?? undefined,
    refundId: refund?.refund_id ?? undefined,
  };
}

type RefundEventOutcome =
  | { state: "applied"; refundState: "completed" | "processing" | "failed" }
  | { state: "untracked"; reason: string }
  | { state: "error"; reason: string };

/**
 * Settles the stored refund state from a refund event.
 *
 * WHY THIS EXISTS. issueRefund() hands a refund to Cashfree at STANDARD speed,
 * writes refund_state='processing' and tells the customer the money is on its
 * way — which is only true once the bank confirms it later. Nothing watched
 * that state afterwards except an admin remembering to press Sync on
 * /admin/payments, so a refund Cashfree went on to FAIL sat 'processing'
 * forever: the customer waits on a promise, the queue shows it in flight, and
 * the one system that knew better was telling us and being ignored.
 *
 * The body is not trusted for the verdict. It NAMES the refund; the status is
 * re-read from Cashfree, exactly as the payment path re-reads the order.
 */
async function applyRefundStatusEvent(ids: {
  orderId?: string;
  refundId?: string;
}): Promise<RefundEventOutcome> {
  const { refundId } = ids;
  if (!refundId) return { state: "untracked", reason: "event carries no refund id" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;

  // Matched on OUR refund id, which is unique (0033), and never on the order.
  // A refund raised straight from the Cashfree dashboard carries an id we never
  // issued; matching that by order id would stamp a stranger's verdict onto our
  // row — including 'completed', which also sets payments.status='refunded' and
  // tells every screen the customer has been paid.
  const { data: payment, error } = await db
    .from("payments")
    .select("id, booking_id, refund_state, refund_amount, cashfree_order_id")
    .eq("cashfree_refund_id", refundId)
    .maybeSingle();

  if (error)    return { state: "error", reason: error.message ?? "payment lookup failed" };
  if (!payment) return { state: "untracked", reason: "no Hallnect refund with that id" };

  // Our stored order id, not the body's: the row already knows which order this
  // refund belongs to, and that is one fewer field taken on the sender's word.
  const orderId: string | undefined = payment.cashfree_order_id ?? ids.orderId;
  if (!orderId) return { state: "untracked", reason: "refund has no gateway order" };

  const res = await getCashfreeRefund(orderId, refundId);
  // Could not ask — transient by assumption, so let Cashfree redeliver rather
  // than acknowledge a refund whose state we never actually learned.
  if (!res.ok) return { state: "error", reason: res.error };

  const outcome = classifyRefundStatus(res.data.refund_status);

  // Guarded so a confirmed refund can never be walked backwards by a late or
  // out-of-order delivery: 'completed' is the end of the line.
  const { count, error: upErr } = await db
    .from("payments")
    .update(
      {
        refund_state: outcome.state,
        refund_error: outcome.state === "failed" ? outcome.reason : null,
        // status moves to 'refunded' only on Cashfree's own confirmation — the
        // same line issueRefund() and syncRefundStatus() hold.
        ...(outcome.state === "completed"
          ? { refund_completed_at: new Date().toISOString(), status: "refunded" }
          : {}),
      },
      { count: "exact" },
    )
    .eq("id", payment.id)
    .neq("refund_state", "completed");

  if (upErr) return { state: "error", reason: upErr.message ?? "refund update failed" };

  // A FAILED refund is the outcome nobody would otherwise discover. The
  // customer was told the money was on its way when it was handed over, and
  // nothing in the product ever contradicts that — a column is not a person.
  // Fired only when THIS delivery moved the row, so a redelivery does not
  // re-alarm (the dedupe key would swallow it in any case).
  if (outcome.state === "failed" && (count ?? 0) > 0) {
    const amount = Number(payment.refund_amount ?? 0);
    await notifyAdminOperational({
      key:       `refund.failed:${payment.id}`,
      eventType: "refund.failed",
      event:     "Refund FAILED at the gateway",
      details:
        `Rs.${amount.toFixed(2)} did not reach the customer. ${outcome.reason} ` +
        `They have already been told it was on the way.`,
      reference: "Retry it in /admin/payments",
      bookingId: payment.booking_id,
    });
  }

  return { state: "applied", refundState: outcome.state };
}

// ── Receiver ─────────────────────────────────────────────────────────────────

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

  const refundIds = refundIdsFrom(payload);

  // Safe log: event type + order id only. No secrets, headers, or PII.
  console.info(`[cashfree-webhook] event=${eventType} order=${orderId ?? refundIds.orderId ?? "n/a"}`);

  const eventId = webhookEventId(rawBody);
  await recordSafely({ eventId, eventType, payload });

  try {
    // 4a. REFUND events take their own path and must NOT fall through to the
    //     payment path below. verifyAndApplyPayment re-reads the ORDER, which
    //     stays PAID after a refund, so routing a refund event through it would
    //     keep re-asserting a successful payment for money that is going back.
    //     Matched loosely (type mentions REFUND, or the body names a refund) so
    //     a shape we have not seen degrades to "acknowledged, nothing found"
    //     rather than to the wrong handler.
    if (/REFUND/i.test(eventType) || refundIds.refundId) {
      const outcome = await applyRefundStatusEvent(refundIds);

      if (outcome.state === "error") {
        console.error(`[cashfree-webhook] refund not settled — asking Cashfree to retry`);
        await markSafely(eventId, "FAILED", outcome.reason);
        return NextResponse.json({ ok: false, state: "refund_unresolved" }, { status: 503 });
      }
      if (outcome.state === "untracked") {
        // A refund Hallnect did not issue (e.g. raised in the Cashfree
        // dashboard). There is nothing here to update, and retrying will not
        // change that — acknowledge so Cashfree stops.
        await markSafely(eventId, "IGNORED", outcome.reason);
        return NextResponse.json({ ok: true, ignored: true, event: eventType });
      }

      console.info(`[cashfree-webhook] refund settled state=${outcome.refundState}`);
      await markSafely(eventId, "PROCESSED", `refund ${outcome.refundState}`);
      return NextResponse.json({ ok: true, state: `refund_${outcome.refundState}` });
    }

    if (!orderId) {
      // Acknowledge events without an order (e.g. some settlement events) so
      // Cashfree stops retrying.
      await markSafely(eventId, "IGNORED", "no order id on the event");
      return NextResponse.json({ ok: true, ignored: true, event: eventType });
    }

    // 4b. Re-verify against Cashfree + apply idempotently. This single call
    //     covers PAYMENT_SUCCESS (→ booking_requested, block availability,
    //     commission), PAYMENT_FAILED and USER_DROPPED (→ payment_failed),
    //     because it reads the authoritative order status rather than trusting
    //     the event name.
    //
    // Two kinds of money arrive at this one endpoint: CUSTOMER booking advances
    // (HN_…) and OWNER premium/pro plan purchases (HNP_…). The order-id prefix
    // routes them without an extra database round-trip. Both paths re-verify
    // against Cashfree and are individually idempotent.
    const result = isPlanOrderId(orderId)
      ? await verifyAndApplyPlanPurchase(orderId)
      : await verifyAndApplyPayment(orderId);
    console.info(`[cashfree-webhook] order=${orderId} applied state=${result.state}`);

    // 'error' is NOT a handled outcome — it is verifyAndApplyPayment telling us
    // it could not finish (booking row missing, order fetch failed, an
    // unexpected update error). Answering 200 told Cashfree the event was
    // processed and permanently cancelled its retries, so a transient blip
    // during a real payment meant the booking was never confirmed and nobody
    // ever found out. 5xx puts it back on Cashfree's retry schedule.
    // 'pending' and 'failed' ARE terminal, handled outcomes and stay 200.
    // 'unactivated' is a PLAN order whose money was captured but whose listing
    // could not be created. The owner has paid and has nothing; a 200 here
    // would permanently cancel Cashfree's retries and strand them. Retrying is
    // safe — activation is exactly-once via premium_listings.plan_purchase_id.
    if (result.state === "error" || result.state === "unactivated") {
      console.error(`[cashfree-webhook] order=${orderId} not applied — asking Cashfree to retry`);
      await markSafely(eventId, "FAILED", `apply returned ${result.state}`);
      return NextResponse.json({ ok: false, state: result.state }, { status: 503 });
    }
    // 'not_found' is an order this deployment has no row for — acknowledged,
    // but recorded as ignored rather than processed so it is not mistaken for
    // money we applied.
    await markSafely(
      eventId,
      result.state === "not_found" ? "IGNORED" : "PROCESSED",
      `apply returned ${result.state}`,
    );
    return NextResponse.json({ ok: true, state: result.state });
  } catch (e) {
    console.error("[cashfree-webhook] apply failed:", e instanceof Error ? e.message : e);
    await markSafely(eventId, "FAILED", e instanceof Error ? e.message : "processing error");
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
