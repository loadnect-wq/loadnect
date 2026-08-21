// ─────────────────────────────────────────────────────────────────────────────
// lib/commission-payments.ts — owner settles their Hallnect commission through
// Cashfree (UPI, cards, net-banking, wallets) instead of a manual UPI transfer
// that an admin has to eyeball and approve.  SERVER-ONLY.
//
// Mirrors lib/payments.ts deliberately: same gateway wrapper, same
// server-authoritative amount rule, same "verify against Cashfree, never trust
// the browser" rule, same idempotency shape. The two flows differ only in WHO
// pays and WHAT the money settles.
//
// MONEY MODEL (set with the operator):
//   customer pays the hall price  →  owner owes 5% of the hall price
//   → owner settles that 5% here  →  Hallnect earns the commission ONCE.
//
// SECURITY:
//   • The amount is ALWAYS re-read from commissions.commission_amount. Nothing
//     the browser sends can influence what is charged.
//   • Ownership is verified server-side: the caller's hall_owners row must be
//     the commission's hall_owner_id.
//   • A DB trigger (guard_commission_payment_integrity, migration 0027)
//     independently rejects a settlement whose owner or amount does not match
//     the commission — so even a direct API call cannot underpay.
//   • cashfree_order_id is UNIQUE, so a redelivered webhook cannot create a
//     second settlement row.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createCashfreeOrder, getCashfreeOrder } from "@/lib/cashfree";
import { getCanonicalAppUrl } from "@/lib/app-url";

/** Commission gateway orders are prefixed HNC_ so the shared Cashfree webhook
 *  can tell them apart from booking orders (HN_) without a database lookup. */
export const COMMISSION_ORDER_PREFIX = "HNC_";

export function isCommissionOrderId(orderId: string): boolean {
  return orderId.startsWith(COMMISSION_ORDER_PREFIX);
}

function buildCommissionOrderId(commissionId: string): string {
  const compact = commissionId.replace(/-/g, "").slice(0, 18);
  return `${COMMISSION_ORDER_PREFIX}${compact}_${Date.now().toString(36)}`;
}

/** Cashfree requires a plain 10–15 digit number, no "+" or spaces. */
function normalisePhone(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "").slice(-12);
}

export type StartCommissionPaymentResult =
  | { ok: true; paymentSessionId: string; orderId: string; amount: number; mode: "sandbox" | "production" }
  | { ok: false; error: string };

/**
 * Opens a Cashfree order for one commission and records a settlement row.
 * `ownerProfileId` is the AUTHENTICATED user's profile id — resolved by the
 * caller from the session, never from the request body.
 */
export async function startCommissionPayment(input: {
  commissionId: string;
  ownerProfileId: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string | null;
}): Promise<StartCommissionPaymentResult> {
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  // 1. Load the commission and the owner it belongs to (service-role read).
  const { data: commission, error: cErr } = await db
    .from("commissions")
    .select("id, hall_owner_id, commission_amount, status, booking_id, hall_owners!hall_owner_id(profile_id)")
    .eq("id", input.commissionId)
    .maybeSingle();

  if (cErr)       return { ok: false, error: "Could not load this commission." };
  if (!commission) return { ok: false, error: "Commission not found." };

  // 2. Ownership — the commission must belong to the CALLER, checked against
  //    the database rather than anything the client supplied.
  if (commission.hall_owners?.profile_id !== input.ownerProfileId) {
    return { ok: false, error: "This commission does not belong to you." };
  }

  // 3. Status — never charge twice for something already settled.
  if (commission.status === "paid") {
    return { ok: false, error: "This commission has already been paid." };
  }
  if (commission.status === "waived" || commission.status === "adjusted_from_owner_settlement") {
    return { ok: false, error: "This commission has already been settled by Hallnect." };
  }

  // 4. Amount — SERVER-AUTHORITATIVE. Read from the commission row only.
  const amount = Number(commission.commission_amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "This commission has no amount payable." };
  }

  // 5. Reuse an in-flight order rather than opening a second one for the same
  //    commission — otherwise an owner who clicks twice gets two live orders
  //    and could pay both.
  const { data: existing } = await db
    .from("owner_commission_payments")
    .select("id, status, cashfree_order_id, payment_session_id, amount")
    .eq("commission_id", input.commissionId)
    .in("status", ["created", "payment_submitted", "payment_under_review"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.cashfree_order_id && existing.payment_session_id) {
    // Only reuse while Cashfree still considers the order payable.
    const live = await getCashfreeOrder(existing.cashfree_order_id);
    const state = live.ok ? (live.data.order_status ?? "").toUpperCase() : "";
    if (state === "ACTIVE" && Number(existing.amount) === amount) {
      return {
        ok: true,
        paymentSessionId: existing.payment_session_id,
        orderId: existing.cashfree_order_id,
        amount,
        mode: cashfreeMode(),
      };
    }
  }

  const phone = normalisePhone(input.ownerPhone);
  if (phone.length < 10) {
    return { ok: false, error: "Add a valid 10-digit phone number to your profile before paying." };
  }

  // 6. Open the gateway order.
  const orderId = buildCommissionOrderId(input.commissionId);
  const origin = getCanonicalAppUrl();

  const order = await createCashfreeOrder({
    orderId,
    amount,
    customerId: input.ownerProfileId,
    customerName: input.ownerName || "Hallnect Venue Owner",
    customerEmail: input.ownerEmail,
    customerPhone: phone,
    returnUrl: `${origin}/owner/commissions/status?order_id={order_id}`,
    notifyUrl: `${origin}/api/webhooks/cashfree`,
    note: `Hallnect commission for booking ${commission.booking_id ?? input.commissionId}`,
  });

  if (!order.ok) return { ok: false, error: order.error };
  if (!order.data.payment_session_id) {
    return { ok: false, error: "Cashfree did not return a payment session. Please retry." };
  }

  // 7. Record the settlement attempt. The integrity trigger re-checks owner and
  //    amount here, so a forged call cannot write a mismatched row.
  const { error: insErr } = await db.from("owner_commission_payments").insert({
    owner_id: commission.hall_owner_id,
    commission_id: input.commissionId,
    amount,
    method: "upi_gateway",
    status: "created",
    cashfree_order_id: orderId,
    payment_session_id: order.data.payment_session_id,
  });

  if (insErr) return { ok: false, error: "Could not start the payment. Please try again." };

  return { ok: true, paymentSessionId: order.data.payment_session_id, orderId, amount, mode: cashfreeMode() };
}

function cashfreeMode(): "sandbox" | "production" {
  return process.env.CASHFREE_ENV === "production" ? "production" : "sandbox";
}

export type ApplyCommissionResult =
  | { state: "paid"; commissionId: string }
  | { state: "pending" | "failed" | "not_found"; commissionId?: string; message?: string };

/**
 * Verifies a commission order against Cashfree and, when genuinely PAID, marks
 * the commission settled. Idempotent: every write is status-guarded, so a
 * webhook redelivery and the return page racing each other is harmless.
 *
 * This is the ONLY function that may mark a commission paid — the browser's
 * claim of success is never trusted.
 */
export async function verifyAndApplyCommissionPayment(orderId: string): Promise<ApplyCommissionResult> {
  if (!orderId) return { state: "not_found" };

  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  const { data: settlement } = await db
    .from("owner_commission_payments")
    .select("id, commission_id, amount, status")
    .eq("cashfree_order_id", orderId)
    .maybeSingle();

  if (!settlement) return { state: "not_found" };

  // Already settled — re-assert nothing, just report.
  if (settlement.status === "verified") {
    return { state: "paid", commissionId: settlement.commission_id };
  }

  // Ask Cashfree what actually happened. This is the source of truth.
  const order = await getCashfreeOrder(orderId);
  if (!order.ok) return { state: "pending", commissionId: settlement.commission_id, message: order.error };

  const status = (order.data.order_status ?? "").toUpperCase();

  if (status === "ACTIVE") {
    return { state: "pending", commissionId: settlement.commission_id };
  }

  if (status === "EXPIRED" || status === "TERMINATED" || status === "TERMINATION_REQUESTED") {
    await db.from("owner_commission_payments")
      .update({ status: "failed", admin_note: `Gateway order ${status.toLowerCase()}` })
      .eq("id", settlement.id)
      .neq("status", "verified");
    return { state: "failed", commissionId: settlement.commission_id };
  }

  if (status !== "PAID") {
    return { state: "pending", commissionId: settlement.commission_id };
  }

  // ── PAID ──────────────────────────────────────────────────────────────────
  // Guard against a gateway amount that does not match what was owed. Cashfree
  // is authoritative for "was it paid", but the amount must still reconcile.
  const paidAmount = Number(order.data.order_amount ?? 0);
  if (Math.abs(paidAmount - Number(settlement.amount)) > 0.5) {
    await db.from("owner_commission_payments")
      .update({ status: "payment_under_review", admin_note: `Amount mismatch: gateway ${paidAmount}, expected ${settlement.amount}` })
      .eq("id", settlement.id)
      .neq("status", "verified");
    return { state: "pending", commissionId: settlement.commission_id, message: "Payment is under review." };
  }

  // Mark the settlement verified (status-guarded → repeat runs match 0 rows).
  await db.from("owner_commission_payments")
    .update({
      status: "verified",
      verified_at: new Date().toISOString(),
      cashfree_payment_id: String(order.data.cf_order_id ?? ""),
      raw_response: order.data,
      admin_note: "Verified automatically by Cashfree",
    })
    .eq("id", settlement.id)
    .neq("status", "verified");

  // Mark the commission paid. Guarded on NOT already paid so a redelivery is a
  // no-op rather than restamping paid_at.
  await db.from("commissions")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      payment_method: "cashfree",
      payment_reference: orderId,
    })
    .eq("id", settlement.commission_id)
    .neq("status", "paid");

  return { state: "paid", commissionId: settlement.commission_id };
}
