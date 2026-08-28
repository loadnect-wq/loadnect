// ─────────────────────────────────────────────────────────────────────────────
// lib/cashfree-subscriptions.ts — Cashfree SUBSCRIPTIONS API wrapper.
//
// ⛔  SERVER-ONLY. Reads CASHFREE_SECRET_KEY.
//
// Separate from lib/cashfree.ts on purpose: Subscriptions is a DIFFERENT product
// with its own endpoints, its own payload shapes and — critically — its own API
// VERSION. Orders are pinned to 2023-08-01; the subscription endpoints want
// 2025-01-01. Sharing one version constant across both would silently break
// whichever one moved.
//
// Verified against the live sandbox rather than taken from the docs (which
// disagreed with themselves about the version):
//   POST /pg/plans                        create a plan   (done in the dashboard)
//   POST /pg/subscriptions                create a subscription -> session id
//   GET  /pg/subscriptions/{id}           authoritative status
//   GET  /pg/subscriptions/{id}/payments  the individual monthly charges
//   POST /pg/subscriptions/{id}/manage    {action:"CANCEL"} to stop it
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getCashfreeConfig, type CashfreeResult } from "@/lib/cashfree";

/** Subscriptions speaks a different version from orders. Do not unify these. */
const SUBSCRIPTION_API_VERSION = "2025-01-01";

const GENERIC_CONFIG_ERROR = "Online payments are temporarily unavailable. Please try again later.";

type Cfg = ReturnType<typeof getCashfreeConfig>;

function headers(cfg: Cfg): Record<string, string> {
  return {
    "Content-Type":    "application/json",
    "x-api-version":   SUBSCRIPTION_API_VERSION,
    "x-client-id":     cfg.appId,
    "x-client-secret": cfg.secretKey,
  };
}

export type CashfreeSubscription = {
  subscription_id?:          string;
  cf_subscription_id?:       string | number;
  subscription_status?:      string;  // INITIALIZED | ACTIVE | ON_HOLD | CANCELLED | COMPLETED
  subscription_session_id?:  string;
  next_schedule_date?:       string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authorization_details?:    any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plan_details?:             any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]:             any;
};

export type CashfreeSubscriptionPayment = {
  cf_payment_id?:      string | number;
  payment_id?:         string | number;
  payment_status?:     string;   // SUCCESS | FAILED | PENDING | INITIALIZED
  payment_amount?:     number;
  payment_time?:       string;
  /** Which cycle of the plan this charge is. */
  cycle?:              number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]:       any;
};

async function request<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<CashfreeResult<T>> {
  let cfg: Cfg;
  try {
    cfg = getCashfreeConfig();
  } catch (e) {
    console.error("[cashfree-subs] configuration error:", e instanceof Error ? e.message : e);
    return { ok: false, error: GENERIC_CONFIG_ERROR };
  }

  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method:  init.method,
      headers: headers(cfg),
      body:    init.body === undefined ? undefined : JSON.stringify(init.body),
      cache:   "no-store",
    });

    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }

    if (!res.ok) {
      // Cashfree returns { message, code, type }. Surface the message — the
      // caller decides whether it is safe to show an owner.
      const message = parsed?.message ?? `Cashfree returned ${res.status}`;
      console.error(`[cashfree-subs] ${init.method} ${path} -> ${res.status}: ${message}`);
      return { ok: false, error: String(message), status: res.status };
    }

    return { ok: true, data: parsed as T };
  } catch (e) {
    console.error("[cashfree-subs] request failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Could not reach our payment provider. Please try again." };
  }
}

export type CreateSubscriptionParams = {
  /** Our id. Must be unique per merchant. */
  subscriptionId: string;
  /** The Cashfree plan_id (premium_plans.cf_plan_id). */
  planId:         string;
  customerName:   string;
  customerEmail:  string;
  customerPhone:  string;
  returnUrl:      string;
  /**
   * Charged once to prove the mandate works, then refunded. Rs1 rather than the
   * full monthly amount: the owner should not be charged a month up front just
   * to authorise, and refunding Rs1 costs nothing if they abandon.
   */
  authorizationAmount?: number;
  expiryTime?:    string;
  note?:          string;
};

export async function createCashfreeSubscription(
  params: CreateSubscriptionParams,
): Promise<CashfreeResult<CashfreeSubscription>> {
  return request<CashfreeSubscription>("/subscriptions", {
    method: "POST",
    body: {
      subscription_id: params.subscriptionId,
      customer_details: {
        customer_name:  params.customerName,
        customer_email: params.customerEmail,
        customer_phone: params.customerPhone,
      },
      plan_details: { plan_id: params.planId },
      authorization_details: {
        authorization_amount:        params.authorizationAmount ?? 1,
        authorization_amount_refund: true,
        // eNACH is deliberately omitted: it needs bank-account details from the
        // owner and takes days to register. UPI AutoPay and card mandates are
        // both instant.
        payment_methods:             ["upi", "card"],
      },
      subscription_meta: { return_url: params.returnUrl },
      ...(params.expiryTime ? { subscription_expiry_time: params.expiryTime } : {}),
      ...(params.note ? { subscription_note: params.note } : {}),
    },
  });
}

export async function getCashfreeSubscription(
  subscriptionId: string,
): Promise<CashfreeResult<CashfreeSubscription>> {
  return request<CashfreeSubscription>(
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: "GET" },
  );
}

export async function getCashfreeSubscriptionPayments(
  subscriptionId: string,
): Promise<CashfreeResult<CashfreeSubscriptionPayment[]>> {
  const res = await request<CashfreeSubscriptionPayment[] | null>(
    `/subscriptions/${encodeURIComponent(subscriptionId)}/payments`,
    { method: "GET" },
  );
  if (!res.ok) return res;
  // The endpoint answers `null` rather than `[]` when nothing has been charged
  // yet, which would otherwise blow up every caller that maps over it.
  return { ok: true, data: Array.isArray(res.data) ? res.data : [] };
}

/** Stops future charges. Cashfree keeps the record; it simply stops debiting. */
export async function cancelCashfreeSubscription(
  subscriptionId: string,
): Promise<CashfreeResult<CashfreeSubscription>> {
  return request<CashfreeSubscription>(
    `/subscriptions/${encodeURIComponent(subscriptionId)}/manage`,
    { method: "POST", body: { action: "CANCEL" } },
  );
}

/** Cashfree's subscription states, mapped to the ones we store. */
export function mapSubscriptionStatus(
  cf: string | undefined | null,
): "created" | "active" | "cancelled" | "failed" | "completed" | "on_hold" | "paused" {
  switch ((cf ?? "").toUpperCase()) {
    case "ACTIVE":      return "active";
    case "INITIALIZED": return "created";
    case "BANK_APPROVAL_PENDING":
    case "PENDING":     return "created";
    case "ON_HOLD":     return "on_hold";
    case "PAUSED":      return "paused";
    case "CANCELLED":   return "cancelled";
    case "COMPLETED":   return "completed";
    default:            return "failed";
  }
}
