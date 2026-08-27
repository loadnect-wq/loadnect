// ─────────────────────────────────────────────────────────────────────────────
// lib/cashfree.ts — Cashfree Payment Gateway (PG) server-side API wrapper.
//
// ⛔  SERVER-ONLY.  This file reads CASHFREE_SECRET_KEY, which must NEVER reach
//     the browser.  The "server-only" import below makes the build fail if this
//     module is ever pulled into a client bundle.
//
// Docs: https://docs.cashfree.com/reference/pg-new-apis-endpoint
// API version pinned to 2023-08-01 (the "orders" + "payment_session_id" flow).
//
// Flow this wrapper supports:
//   1. createOrder()            → returns payment_session_id (frontend opens checkout with it)
//   2. getOrder(orderId)        → authoritative order status (PAID / ACTIVE / EXPIRED …)
//   3. getOrderPayments(orderId)→ per-attempt payment details (method, message)
//   4. verifyWebhookSignature() → validates the notify_url webhook came from Cashfree
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import crypto from "node:crypto";
import { requireEnv, optionalEnv } from "@/lib/env";

const CASHFREE_API_VERSION = "2023-08-01";

type CashfreeEnv = "sandbox" | "production";

type CashfreeConfig = {
  appId:     string;
  secretKey: string;
  env:       CashfreeEnv;
  baseUrl:   string;
};

/**
 * Reads + validates Cashfree credentials from the environment.
 * Throws a clear error if CASHFREE_APP_ID / CASHFREE_SECRET_KEY are missing.
 */
export function getCashfreeConfig(): CashfreeConfig {
  const appId     = requireEnv("CASHFREE_APP_ID");
  const secretKey = requireEnv("CASHFREE_SECRET_KEY");
  const env       = (optionalEnv("CASHFREE_ENV", "sandbox") === "production"
    ? "production"
    : "sandbox") as CashfreeEnv;

  const baseUrl = env === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";

  return { appId, secretKey, env, baseUrl };
}

/**
 * True only if both Cashfree credentials are present. Never throws — safe to
 * call as a pre-flight guard before attempting a payment.
 */
export function isCashfreeConfigured(): boolean {
  const appId  = process.env.CASHFREE_APP_ID;
  const secret = process.env.CASHFREE_SECRET_KEY;
  return typeof appId === "string"  && appId.trim()  !== ""
      && typeof secret === "string" && secret.trim() !== "";
}

// Client-safe message. requireEnv() throws a verbose developer message that
// names env vars and the .env.local path — that must NEVER reach the browser.
const GENERIC_CONFIG_ERROR = "Online payments are temporarily unavailable. Please try again later.";

/** Logs the real config error server-side and returns a generic client-safe result. */
function configError(e: unknown): { ok: false; error: string } {
  console.error("[cashfree] configuration error:", e instanceof Error ? e.message : e);
  return { ok: false, error: GENERIC_CONFIG_ERROR };
}

function authHeaders(cfg: CashfreeConfig): Record<string, string> {
  return {
    "Content-Type":    "application/json",
    "x-api-version":   CASHFREE_API_VERSION,
    "x-client-id":     cfg.appId,
    "x-client-secret": cfg.secretKey,
  };
}

// ── Types (only the fields we use) ─────────────────────────────────────────────

export type CreateOrderParams = {
  orderId:       string;        // our unique id (must be unique per Cashfree merchant)
  amount:        number;        // in INR — the FULL customer charge (advance + ₹200 platform fee)
  currency?:     string;        // default INR
  customerId:    string;        // our auth user id
  customerName:  string;
  customerEmail: string;
  customerPhone: string;
  returnUrl:     string;        // browser is redirected here after checkout
  notifyUrl?:    string;        // server webhook (notify_url)
  /** ISO-8601 instant after which Cashfree must refuse payment. Set to the
   *  booking's own hold expiry so the order cannot outlive the reservation. */
  expiresAt?:    string;
  note?:         string;
};

export type CashfreeOrder = {
  cf_order_id?:        number | string;
  order_id:            string;
  order_status?:       string;     // ACTIVE | PAID | EXPIRED | TERMINATED …
  order_amount?:       number;
  order_currency?:     string;
  payment_session_id?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]:       any;
};

export type CashfreePaymentEntry = {
  cf_payment_id?:  number | string;
  payment_status?: string;          // SUCCESS | FAILED | PENDING | USER_DROPPED …
  payment_amount?: number;
  payment_method?: // eslint-disable-next-line @typescript-eslint/no-explicit-any
                   any;
  payment_message?: string;
  payment_time?:    string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]:    any;
};

export type CashfreeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

// ── 1. Create order ────────────────────────────────────────────────────────────

export async function createCashfreeOrder(
  params: CreateOrderParams,
): Promise<CashfreeResult<CashfreeOrder>> {
  let cfg: CashfreeConfig;
  try {
    cfg = getCashfreeConfig();
  } catch (e) {
    return configError(e);
  }

  const body = {
    order_id:       params.orderId,
    order_amount:   Number(params.amount.toFixed(2)),
    order_currency: params.currency ?? "INR",
    customer_details: {
      customer_id:    params.customerId,
      customer_name:  params.customerName,
      customer_email: params.customerEmail,
      customer_phone: params.customerPhone,
    },
    order_meta: {
      return_url: params.returnUrl,
      ...(params.notifyUrl ? { notify_url: params.notifyUrl } : {}),
    },
    // The order must die with the hold it is paying for. Without an expiry
    // Cashfree kept accepting payment long after the 15-minute pending sweep
    // cancelled the booking, so a customer whose UPI approval was slow paid
    // for a booking that no longer existed — money captured against nothing.
    ...(params.expiresAt ? { order_expiry_time: params.expiresAt } : {}),
    ...(params.note ? { order_note: params.note } : {}),
  };

  try {
    const res = await fetch(`${cfg.baseUrl}/orders`, {
      method:  "POST",
      headers: authHeaders(cfg),
      body:    JSON.stringify(body),
      cache:   "no-store",
    });

    const json = (await res.json()) as CashfreeOrder & { message?: string };

    if (!res.ok) {
      return {
        ok:     false,
        status: res.status,
        error:  json?.message ?? `Cashfree create-order failed (HTTP ${res.status})`,
      };
    }
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error contacting Cashfree" };
  }
}

// ── 2. Get order (authoritative status) ────────────────────────────────────────

export async function getCashfreeOrder(
  orderId: string,
): Promise<CashfreeResult<CashfreeOrder>> {
  let cfg: CashfreeConfig;
  try {
    cfg = getCashfreeConfig();
  } catch (e) {
    return configError(e);
  }
  try {
    const res = await fetch(`${cfg.baseUrl}/orders/${encodeURIComponent(orderId)}`, {
      method:  "GET",
      headers: authHeaders(cfg),
      cache:   "no-store",
    });
    const json = (await res.json()) as CashfreeOrder & { message?: string };
    if (!res.ok) {
      return {
        ok:     false,
        status: res.status,
        error:  json?.message ?? `Cashfree get-order failed (HTTP ${res.status})`,
      };
    }
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error contacting Cashfree" };
  }
}

// ── 3. Get order payments (per-attempt details) ────────────────────────────────

export async function getCashfreeOrderPayments(
  orderId: string,
): Promise<CashfreeResult<CashfreePaymentEntry[]>> {
  let cfg: CashfreeConfig;
  try {
    cfg = getCashfreeConfig();
  } catch (e) {
    return configError(e);
  }
  try {
    const res = await fetch(`${cfg.baseUrl}/orders/${encodeURIComponent(orderId)}/payments`, {
      method:  "GET",
      headers: authHeaders(cfg),
      cache:   "no-store",
    });
    const json = await res.json();
    if (!res.ok) {
      return {
        ok:     false,
        status: res.status,
        error:  (json?.message as string) ?? `Cashfree get-payments failed (HTTP ${res.status})`,
      };
    }
    return { ok: true, data: Array.isArray(json) ? json : [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error contacting Cashfree" };
  }
}

// ── 4. Verify webhook signature ────────────────────────────────────────────────
// Cashfree signs each webhook: signature = Base64( HMAC-SHA256( `${timestamp}${rawBody}`, secretKey ) )
// sent in the `x-webhook-signature` header, with `x-webhook-timestamp`.
// We recompute and compare in constant time. Never trust an unsigned webhook.

export function verifyCashfreeWebhookSignature(
  rawBody:   string,
  signature: string | null,
  timestamp: string | null,
): boolean {
  if (!signature || !timestamp) return false;
  try {
    // Prefer a dedicated webhook secret if configured; otherwise fall back to
    // the API secret key (Cashfree signs webhooks with the client secret by
    // default). This lets deployments rotate the webhook secret independently.
    const webhookSecret = process.env.CASHFREE_WEBHOOK_SECRET?.trim();
    const secretKey = webhookSecret && webhookSecret !== ""
      ? webhookSecret
      : getCashfreeConfig().secretKey;
    const expected = crypto
      .createHmac("sha256", secretKey)
      .update(`${timestamp}${rawBody}`)
      .digest("base64");

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Maps a Cashfree order_status to our internal payment_status enum value. */
export function mapOrderStatusToPaymentStatus(orderStatus: string | undefined): string {
  switch ((orderStatus ?? "").toUpperCase()) {
    case "PAID":       return "payment_success";
    case "ACTIVE":     return "created";        // order created, awaiting payment
    case "EXPIRED":    return "payment_failed";
    case "TERMINATED":
    case "TERMINATION_REQUESTED": return "cancelled";
    default:           return "pending";
  }
}

// ── Refunds ────────────────────────────────────────────────────────────────────
//
// This is the piece that did not exist. Cancellations computed and recorded what
// a customer was owed, and nothing moved the money — so a booking could sit
// marked "refunded" while the customer had received nothing.
//
// IDEMPOTENCY IS THE WHOLE GAME HERE. `refund_id` is OUR id and is unique per
// order at Cashfree: replaying the same refund_id returns the existing refund
// instead of sending a second one. A double payout cannot be clawed back, so
// every retry path must reuse the id rather than mint a fresh one.

export type CashfreeRefund = {
  cf_refund_id?:   number | string;
  refund_id:       string;
  refund_status?:  string;   // SUCCESS | PENDING | ONHOLD | CANCELLED | FAILED
  refund_amount?:  number;
  refund_note?:    string;
  refund_arn?:     string;   // bank reference, once settled
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]:   any;
};

/** How the customer's refund is progressing, in terms the UI can act on. */
export type RefundOutcome =
  | { state: "completed" }              // money confirmed back
  | { state: "processing" }             // accepted, bank still moving it
  | { state: "failed"; reason: string };

/**
 * Narrows Cashfree's refund_status. PENDING and ONHOLD are NOT failures — the
 * refund is accepted and in flight, and treating either as failed would invite
 * an admin to issue a second one.
 */
export function classifyRefundStatus(raw: string | undefined): RefundOutcome {
  switch ((raw ?? "").toUpperCase()) {
    case "SUCCESS":   return { state: "completed" };
    case "PENDING":
    case "ONHOLD":    return { state: "processing" };
    case "CANCELLED": return { state: "failed", reason: "Cashfree cancelled the refund." };
    case "FAILED":    return { state: "failed", reason: "Cashfree could not complete the refund." };
    default:          return { state: "processing" };
  }
}

/**
 * Issues a refund against a paid order.
 *
 * `amount` is decided by the caller from SERVER-SIDE figures (the recorded
 * refund_amount), never from a browser. `refundId` must be stable for a given
 * booking so a retry is a lookup, not a second payout.
 */
export async function createCashfreeRefund(params: {
  orderId:  string;
  refundId: string;
  amount:   number;
  note?:    string;
}): Promise<CashfreeResult<CashfreeRefund>> {
  let cfg: CashfreeConfig;
  try { cfg = getCashfreeConfig(); } catch (e) { return configError(e); }

  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    return { ok: false, error: "Refund amount must be greater than zero." };
  }

  try {
    const res = await fetch(
      `${cfg.baseUrl}/orders/${encodeURIComponent(params.orderId)}/refunds`,
      {
        method: "POST",
        headers: authHeaders(cfg),
        body: JSON.stringify({
          refund_id:     params.refundId,
          refund_amount: Number(params.amount.toFixed(2)),
          refund_note:   (params.note ?? "Hallnect booking cancellation").slice(0, 100),
          // STANDARD, not INSTANT: instant refunds carry a fee and are not
          // enabled on every account. A cancellation is not time-critical.
          refund_speed:  "STANDARD",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );

    const text = await res.text();
    let data: CashfreeRefund | { message?: string } = {} as CashfreeRefund;
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }

    if (!res.ok) {
      const message = (data as { message?: string })?.message ?? `Cashfree returned HTTP ${res.status}`;
      // Status and message only — a refund response echoes customer details.
      console.error(`[cashfree] refund failed: HTTP ${res.status}`);
      return { ok: false, error: message, status: res.status };
    }
    return { ok: true, data: data as CashfreeRefund };
  } catch (e) {
    console.error("[cashfree] refund request failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Could not reach Cashfree to issue the refund." };
  }
}

/** Reads a refund's current status — used to resolve anything left 'processing'. */
export async function getCashfreeRefund(
  orderId: string,
  refundId: string,
): Promise<CashfreeResult<CashfreeRefund>> {
  let cfg: CashfreeConfig;
  try { cfg = getCashfreeConfig(); } catch (e) { return configError(e); }

  try {
    const res = await fetch(
      `${cfg.baseUrl}/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}`,
      { method: "GET", headers: authHeaders(cfg), cache: "no-store", signal: AbortSignal.timeout(15_000) },
    );
    const text = await res.text();
    let data: CashfreeRefund = {} as CashfreeRefund;
    try { data = text ? JSON.parse(text) : {}; } catch { /* ignore */ }

    if (!res.ok) {
      return { ok: false, error: `Cashfree returned HTTP ${res.status}`, status: res.status };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Could not reach Cashfree to check the refund." };
  }
}
