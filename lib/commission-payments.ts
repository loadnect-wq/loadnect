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
// MONEY MODEL (lib/booking-payment.ts is the source of truth):
//   For ONLINE-paid bookings the commission is ABSORBED from the customer's
//   advance at settlement — status 'collected' — and the owner owes nothing.
//   This module is the FALLBACK for the remaining owner-billed cases only
//   (manual/offline bookings, or Easy Split unavailable). Charging an owner for
//   an already-absorbed commission would collect the same money twice, so every
//   entry point here is gated on isOwnerBillable() below.
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

/**
 * Statuses that mean "Hallnect already has this money" — an owner must never be
 * asked, or allowed, to pay these again:
 *   collected                      absorbed from the customer's advance at source
 *   paid / paid_out                already settled by the owner
 *   waived                         written off by an admin
 *   adjusted_from_owner_settlement recovered from a settlement deduction
 *   refunded                       the underlying booking money went back
 */
const ALREADY_SETTLED_STATUSES = new Set([
  "collected",
  "paid",
  "paid_out",
  "waived",
  "adjusted_from_owner_settlement",
  "refunded",
]);

/** True only when a commission is genuinely still owed BY THE OWNER. */
export function isOwnerBillable(status: string | null | undefined): boolean {
  return !ALREADY_SETTLED_STATUSES.has(String(status ?? ""));
}

/** Owner-facing reason a commission cannot be paid, or null when it can. */
export function settledReason(status: string | null | undefined): string | null {
  const s = String(status ?? "");
  if (s === "collected")  return "This commission was already retained from the customer's advance — you owe nothing.";
  if (s === "paid" || s === "paid_out") return "This commission has already been paid.";
  if (s === "refunded")   return "The booking was refunded — no commission is due.";
  if (ALREADY_SETTLED_STATUSES.has(s)) return "This commission has already been settled by Hallnect.";
  return null;
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

  // 3. Status — never charge twice for something already settled. This
  //    deliberately covers 'collected' (absorbed from the customer's advance):
  //    charging the owner for it would collect the same commission twice.
  const blocked = settledReason(commission.status);
  if (blocked) return { ok: false, error: blocked };

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

  // MARK THE COMMISSION PAID — but only if it is still genuinely owed.
  //
  // The old guard was `.neq("status","paid")`, which let a late gateway
  // payment overwrite any OTHER terminal state. The real sequence that breaks:
  // an owner opens a commission payment on day 6; on day 7 the overdue sweep
  // deducts the same commission from their settlement
  // (status='adjusted_from_owner_settlement'); on day 8 the owner pays the
  // still-open order. The commission flipped to 'paid', the settlement
  // deduction stayed, and Hallnect collected the same commission twice with
  // nothing recording it.
  const { data: current } = await db
    .from("commissions").select("status, payment_reference").eq("id", settlement.commission_id).maybeSingle();
  const currentStatus = String(current?.status ?? "");

  // An idempotent redelivery of THIS order's own payment: already done.
  if (currentStatus === "paid" && current?.payment_reference === orderId) {
    return { state: "paid", commissionId: settlement.commission_id };
  }

  if (!isOwnerBillable(currentStatus)) {
    // Settled some other way while this order was open. The owner has now
    // paid money they no longer owed — that needs a human and a refund, not a
    // silent second collection.
    await db.from("owner_commission_payments")
      .update({
        status: "payment_under_review",
        admin_note:
          `Owner paid ${orderId} but the commission was already settled as '${currentStatus}'. ` +
          `Refund the owner or reverse the settlement adjustment.`,
      })
      .eq("id", settlement.id);
    console.error(`[commission-payments] double collection averted: commission ${settlement.commission_id} was ${currentStatus} when ${orderId} paid`);
    return {
      state: "pending",
      commissionId: settlement.commission_id,
      message: "This commission was already settled. Your payment is under review and will be refunded if it was not owed.",
    };
  }

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
