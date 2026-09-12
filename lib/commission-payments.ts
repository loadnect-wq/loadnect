// ─────────────────────────────────────────────────────────────────────────────
// lib/commission-payments.ts — a venue settles a LEAD commission through
// Cashfree. SERVER-ONLY.
//
// ═══ WHY THIS EXISTS WHEN MIGRATION 0039 RETIRED OWNER BILLING ═══════════════
//
// It retired owner billing for DIRECT BOOKINGS, and the reason was specific:
// the customer's advance passes through Hallnect, so the commission is retained
// out of it at settlement and there is nothing to invoice. Sending the venue a
// bill for money already deducted would collect it twice — which is the exact
// defect 0027 was written to fix.
//
// None of that reaches a lead. Hallnect never touches the lead customer's
// money: the venue is paid directly, in full, by arrangement neither party
// routes through this platform. There is no advance to retain from, so billing
// the venue is not one option among several — it is the only one. 0039's
// decision about direct bookings is untouched, and nothing in this file can
// reach a booking commission (see assertLeadCommission).
//
// ═══ WHAT MAKES A PAYMENT REAL ═══════════════════════════════════════════════
//
// Never the browser. The return URL carries an order id and nothing else of
// consequence; the money is confirmed by re-reading the ORDER from Cashfree's
// own API, and the amount is compared against the figure this server computed
// and stored. A tampered redirect, a replayed webhook and a forged POST all
// converge on the same question — "what does Cashfree say about order X" — and
// get the same answer.
//
// ═══ IDEMPOTENCY ════════════════════════════════════════════════════════════
//   • uq_ocp_open_per_commission (0073) — at most ONE open payment attempt per
//     commission, so two Pay buttons cannot open two payable orders.
//   • uq_ocp_cashfree_order (0027) — one settlement row per gateway order.
//   • The commission is marked paid under a status guard, so the webhook and
//     the return page racing each other still produce one transition.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createCashfreeOrder, getCashfreeOrder, getCashfreeMode } from "@/lib/cashfree";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { normalizePhoneE164 } from "@/lib/notifications/phone";

/**
 * Order-id namespace. `HN_` is a customer booking advance, `HNP_` is an owner's
 * listing plan, `HNC_` is an owner's commission settlement. The webhook routes
 * on this prefix without a database round trip, so the three kinds of money
 * arriving at one endpoint never reach each other's handler.
 */
export const COMMISSION_ORDER_PREFIX = "HNC_";

export function isCommissionOrderId(orderId: string): boolean {
  return typeof orderId === "string" && orderId.startsWith(COMMISSION_ORDER_PREFIX);
}

function buildCommissionOrderId(paymentRowId: string): string {
  // Keyed on the SETTLEMENT ROW, not the commission. A commission whose first
  // attempt expired needs a second, distinct order id — Cashfree rejects a
  // duplicate order_id outright, so keying on the commission would make a
  // failed attempt permanent.
  return `${COMMISSION_ORDER_PREFIX}${paymentRowId.replace(/-/g, "").slice(0, 28)}`;
}

/** Cashfree refuses an expiry under 15 minutes out. */
const ORDER_TTL_MIN = 30;
/** A payment_session_id goes stale long before its order leaves ACTIVE. */
const SESSION_REUSE_WINDOW_MIN = 10;

function orderExpiry(): string {
  return new Date(Date.now() + ORDER_TTL_MIN * 60_000).toISOString();
}

function normalisePhone(raw: string | null | undefined): string {
  const e164 = raw ? normalizePhoneE164(raw) : null;
  // Cashfree wants a bare 10-digit Indian number on the order.
  if (!e164) return "9999999999";
  const digits = e164.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function admin(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getSupabaseAdminClient() as any;
}

// ── The debt ─────────────────────────────────────────────────────────────────

export type PayableCommission = {
  id: string;
  leadId: string;
  hallOwnerId: string;
  hallId: string | null;
  amount: number;
  rate: number;
  base: number;
  status: string;
  dueDate: string | null;
};

/** Commission statuses that mean the money has already been accounted for.
 *
 *  EXPORTED so that anything telling an owner what they owe agrees with the
 *  module that actually takes the payment. If a screen says a commission is
 *  due, `assertLeadCommission` below must be willing to accept money for it;
 *  a shorter list elsewhere would show a bill that cannot be paid, and a
 *  longer one would hide a bill that can. */
export const SETTLED_COMMISSION_STATUSES = [
  "paid", "collected", "paid_out", "waived", "refunded", "adjusted_from_owner_settlement",
];
const SETTLED = SETTLED_COMMISSION_STATUSES;

/**
 * Loads a commission and refuses everything that is not an unsettled LEAD debt.
 *
 * THE booking_id GUARD IS THE POINT OF THIS FUNCTION. A booking commission has
 * already been retained out of the customer's advance. If an id for one ever
 * reached this module — through a crafted request, a copy-pasted id, or a bug
 * in a future caller — the venue would be invited to pay a second time for
 * money Hallnect already holds. Refusing here means that cannot happen no
 * matter what calls in.
 */
async function assertLeadCommission(
  commissionId: string,
  ownerProfileId: string,
): Promise<{ ok: true; commission: PayableCommission } | { ok: false; error: string }> {
  const { data, error } = await admin()
    .from("commissions")
    .select("id, lead_id, booking_id, hall_id, hall_owner_id, booking_amount, commission_rate, commission_amount, status, due_date, hall_owners!hall_owner_id(id, profile_id)")
    .eq("id", commissionId)
    .maybeSingle();

  if (error) {
    console.error("[commission-payments] lookup failed", error.code, error.message);
    return { ok: false, error: "Could not load that commission." };
  }
  if (!data) return { ok: false, error: "That commission could not be found." };

  if (data.booking_id != null || data.lead_id == null) {
    console.error(
      `[commission-payments] refused a non-lead commission ${commissionId} ` +
      `(booking_id=${data.booking_id ?? "null"})`,
    );
    return {
      ok: false,
      error: "This commission was already deducted from the customer's advance — there is nothing to pay.",
    };
  }

  // Ownership from the session profile, via hall_owners. Same reasoning as
  // loadOwnedLead: the denormalised hall_owner_id is not the authority.
  if (data.hall_owners?.profile_id !== ownerProfileId) {
    return { ok: false, error: "That commission could not be found." };
  }

  if (SETTLED.includes(String(data.status))) {
    return { ok: false, error: "This commission has already been settled." };
  }

  const amount = Number(data.commission_amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "This commission has no amount to pay. Please contact Hallnect support." };
  }

  return {
    ok: true,
    commission: {
      id: String(data.id),
      leadId: String(data.lead_id),
      hallOwnerId: String(data.hall_owner_id),
      hallId: (data.hall_id as string | null) ?? null,
      amount,
      rate: Number(data.commission_rate ?? 0),
      base: Number(data.booking_amount ?? 0),
      status: String(data.status),
      dueDate: (data.due_date as string | null) ?? null,
    },
  };
}

// ── Opening a payment ────────────────────────────────────────────────────────

export type StartCommissionPaymentResult =
  | { ok: true; paymentSessionId: string; orderId: string; amount: number; mode: "sandbox" | "production" }
  | { ok: false; error: string };

/**
 * Opens a Cashfree order for one lead commission.
 *
 * THE AMOUNT IS NEVER TAKEN FROM THE CALLER. It is read from the commission
 * row, which was computed by the server at confirmation from a rate the server
 * resolved from the hall. The client sends a commission id and nothing else
 * that touches money.
 */
export async function startCommissionPayment(input: {
  commissionId: string;
  ownerProfileId: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string | null;
}): Promise<StartCommissionPaymentResult> {
  const checked = await assertLeadCommission(input.commissionId, input.ownerProfileId);
  if (!checked.ok) return { ok: false, error: checked.error };
  const commission = checked.commission;

  const db = admin();

  // ── MONEY ALREADY TAKEN? Before anything else. ─────────────────────────────
  //
  // An attempt at 'verified' means Cashfree captured the payment and we recorded
  // that fact; the commission is still unpaid only because markCommissionSettled
  // failed afterwards (the state this module calls 'unsettled'). The in-flight
  // lookup below filters on status='created' and therefore could not see such a
  // row, so every one of its double-charge guards was skipped and a second
  // payable order for the full debt was opened. The status page was telling the
  // owner "do NOT pay again" while the button behind it still would.
  //
  // Retry the settlement — that is the part that failed — and refuse the order.
  const { data: captured } = await db
    .from("owner_commission_payments")
    .select("id, cashfree_order_id, amount")
    .eq("commission_id", commission.id)
    .eq("status", "verified")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (captured?.id) {
    await markCommissionSettled(commission.id, captured.id, Number(captured.amount));
    return {
      ok: false,
      error: "We have already received this payment and are still recording it. Please do not pay again — refresh in a moment.",
    };
  }

  // ── Reuse an in-flight order rather than opening a second payable one ──────
  const { data: existing } = await db
    .from("owner_commission_payments")
    .select("id, cashfree_order_id, payment_session_id, created_at, status")
    .eq("commission_id", commission.id)
    .eq("status", "created")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.cashfree_order_id && existing.payment_session_id) {
    const ageMs = Date.now() - Date.parse(existing.created_at);
    const fresh = Number.isFinite(ageMs) && ageMs < SESSION_REUSE_WINDOW_MIN * 60_000;
    const live = await getCashfreeOrder(existing.cashfree_order_id);

    // ACTIVE and recent — hand back the same session. A stale session id is
    // indistinguishable from a broken button: checkout navigates to Cashfree,
    // which answers payment_session_id_invalid, and nothing is logged here.
    if (live.ok && live.data.order_status === "ACTIVE" && fresh) {
      return {
        ok: true,
        paymentSessionId: existing.payment_session_id,
        orderId: existing.cashfree_order_id,
        amount: commission.amount,
        mode: getCashfreeMode(),
      };
    }

    // ALREADY PAID and the webhook has not landed. Opening a fresh order would
    // let the venue pay the same commission twice. Apply it instead.
    if (live.ok && live.data.order_status === "PAID") {
      await verifyAndApplyCommissionPayment(existing.cashfree_order_id);
      return {
        ok: false,
        error: "This commission has already been paid — we are recording it now. Refresh in a moment.",
      };
    }

    // UNREADABLE and RECENT. We do not know whether it was paid, so we must not
    // create another payable order. Failing closed costs a retry; failing open
    // costs the venue the commission twice. Bounded by freshness so one
    // unreadable row cannot dead-end this commission forever.
    if (!live.ok && fresh) {
      console.error("[commission-payments] could not read in-flight order:", live.error);
      return {
        ok: false,
        error: "We could not check your previous payment attempt. Please try again in a moment — this is to make sure you are not charged twice.",
      };
    }

    // STILL ACTIVE, just past the session-reuse window. Cashfree keeps an order
    // payable for ORDER_TTL_MIN, which is three times that window, so this order
    // can still take the owner's money. Retiring it locally and opening a second
    // payable order left two live orders for the same debt — and if the first one
    // then completed, the claim in verifyAndApplyCommissionPayment (guarded on
    // status='created') matched nothing, so the capture was never recorded
    // against it and /owner/commissions told the owner in writing that "nothing
    // was charged". Refuse instead, and say what to do.
    if (live.ok && live.data.order_status === "ACTIVE") {
      return {
        ok: false,
        error: "You already have a payment in progress for this commission. Finish it, or wait a few minutes for it to lapse and try again — this is to make sure you are not charged twice.",
      };
    }

    // EXPIRED / TERMINATED / long-dead and unreadable. Retire it so it leaves
    // the open-attempt unique index and a fresh attempt is possible.
    await db
      .from("owner_commission_payments")
      .update({ status: "failed", raw_response: live.ok ? live.data : { error: live.error } })
      .eq("id", existing.id)
      .eq("status", "created");
  }

  // ── Record the attempt FIRST, so the order id has a row to come back to ────
  // The guard trigger from 0027 re-checks here that the settlement belongs to
  // the owner who owes the commission AND that the amount equals the full debt.
  // A partial or token payment is refused by the database, not by this code.
  const { data: payment, error: insErr } = await db
    .from("owner_commission_payments")
    .insert({
      owner_id: commission.hallOwnerId,
      commission_id: commission.id,
      amount: commission.amount,
      method: "upi_gateway",
      status: "created",
    })
    .select("id")
    .maybeSingle();

  if (insErr || !payment) {
    // 23505 = uq_ocp_open_per_commission. A concurrent click won the race and
    // its order is being created right now. Refusing is correct: the alternative
    // is two payable orders for one debt.
    if (insErr?.code === "23505") {
      return { ok: false, error: "A payment for this commission is already being opened. Please refresh in a moment." };
    }
    console.error("[commission-payments] attempt insert failed", insErr?.code, insErr?.message);
    return { ok: false, error: "Could not start this payment. Please try again." };
  }

  const orderId = buildCommissionOrderId(payment.id);
  const origin = getCanonicalAppUrl();

  const order = await createCashfreeOrder({
    orderId,
    amount: commission.amount,
    customerId: input.ownerProfileId,
    customerName: input.ownerName || "Hall owner",
    customerEmail: input.ownerEmail,
    customerPhone: normalisePhone(input.ownerPhone),
    returnUrl: `${origin}/owner/commissions/status?order_id={order_id}`,
    notifyUrl: `${origin}/api/webhooks/cashfree`,
    expiresAt: orderExpiry(),
    note: "Hallnect commission on a confirmed enquiry",
  });

  if (!order.ok) {
    await db
      .from("owner_commission_payments")
      .update({ status: "failed", raw_response: { error: order.error } })
      .eq("id", payment.id);
    return { ok: false, error: order.error };
  }

  if (!order.data.payment_session_id) {
    await db.from("owner_commission_payments").update({ status: "failed" }).eq("id", payment.id);
    return { ok: false, error: "Cashfree did not return a payment session. Please retry." };
  }

  // LOAD-BEARING. cashfree_order_id is the only route from a payment back to
  // this row — the webhook, the return page and every retry look it up by that
  // column. If this write silently failed the venue could pay and nothing could
  // ever match the money to the debt. Refuse checkout rather than take money we
  // cannot reconcile.
  const { error: linkErr, count: linked } = await db
    .from("owner_commission_payments")
    .update(
      { cashfree_order_id: orderId, payment_session_id: order.data.payment_session_id },
      { count: "exact" },
    )
    .eq("id", payment.id);

  if (linkErr || !linked) {
    console.error(
      `[commission-payments] could not record order ${orderId} on payment ${payment.id}:`,
      linkErr?.message ?? "0 rows updated",
    );
    return {
      ok: false,
      error: "We could not start this payment safely. Nothing has been charged — please try again.",
    };
  }

  return {
    ok: true,
    paymentSessionId: order.data.payment_session_id,
    orderId,
    amount: commission.amount,
    mode: getCashfreeMode(),
  };
}

// ── Verifying a payment ──────────────────────────────────────────────────────

export type ApplyCommissionPaymentResult = {
  /** paid      — money captured AND the commission is marked settled.
   *  pending   — still payable, nothing captured.
   *  failed    — terminal, nothing captured.
   *  unsettled — MONEY CAPTURED, commission NOT marked. Never reported as
   *              success; the webhook must retry.
   *  not_found — no settlement row matches this order id.
   *  error     — could not determine; the caller must retry. */
  state: "paid" | "pending" | "failed" | "unsettled" | "not_found" | "error";
  commissionId?: string;
  amount?: number;
};

/**
 * Re-verifies a commission order against Cashfree and settles the debt.
 *
 * Idempotent, and safe to call from the webhook and the owner's return page in
 * any order, any number of times.
 *
 * THE MONEY AND THE SETTLEMENT ARE TWO SEPARATE STEPS, for the reason
 * verifyAndApplyPlanPurchase documents at length: if the second step fails, a
 * design that treats the first as proof will report success forever and the
 * venue will have paid a commission that still shows as owing. So the claim
 * records only that money arrived; markCommissionSettled runs on EVERY call
 * until it takes, and is exactly-once by its own status guard.
 */
export async function verifyAndApplyCommissionPayment(
  orderId: string,
): Promise<ApplyCommissionPaymentResult> {
  const db = admin();

  const { data: payment, error: pErr } = await db
    .from("owner_commission_payments")
    .select("id, owner_id, commission_id, amount, status")
    .eq("cashfree_order_id", orderId)
    .maybeSingle();

  if (pErr) {
    console.error("[commission-payments] lookup failed:", pErr.message);
    return { state: "error" };
  }
  if (!payment) return { state: "not_found" };

  // Money already recorded. Do not return success on that alone — finish the
  // settlement, which is what the venue actually bought.
  if (payment.status === "verified") {
    return markCommissionSettled(payment.commission_id, payment.id, Number(payment.amount));
  }

  const order = await getCashfreeOrder(orderId);
  if (!order.ok) {
    console.error("[commission-payments] order fetch failed:", order.error);
    return { state: "error" };
  }

  const status = order.data.order_status;
  if (status !== "PAID") {
    if (status === "ACTIVE") return { state: "pending" };
    await db
      .from("owner_commission_payments")
      .update({ status: "failed", raw_response: order.data })
      .eq("id", payment.id)
      .eq("status", "created");
    return { state: "failed" };
  }

  // AMOUNT AND CURRENCY, both checked. A PAID order for the wrong amount is not
  // this debt being settled — it is a different order, or a tampered one, and
  // marking the commission paid on it would write off a debt for less than it
  // is worth. The half-rupee tolerance absorbs gateway rounding only.
  const paidAmount = Number(order.data.order_amount ?? 0);
  const owed = Number(payment.amount);
  if (Math.abs(paidAmount - owed) > 0.5) {
    console.error(
      `[commission-payments] amount mismatch on ${orderId}: paid ${paidAmount}, expected ${owed}`,
    );
    return { state: "error" };
  }
  const currency = String(order.data.order_currency ?? "INR").toUpperCase();
  if (currency !== "INR") {
    console.error(`[commission-payments] currency mismatch on ${orderId}: ${currency}`);
    return { state: "error" };
  }

  // COUNT THE ROW. An RLS- or status-filtered UPDATE that matches nothing does
  // NOT raise, so `claimErr === null` was being read as "claimed" even when the
  // row had already moved on (e.g. retired to 'failed' by a later attempt). The
  // code then went on to settle the commission while verified_at,
  // cashfree_payment_id and raw_response were never written — losing the only
  // record of which order the money came from.
  const { error: claimErr, count: claimed } = await db
    .from("owner_commission_payments")
    .update({
      status: "verified",
      verified_at: new Date().toISOString(),
      cashfree_payment_id: order.data.cf_order_id ? String(order.data.cf_order_id) : null,
      raw_response: order.data,
    }, { count: "exact" })
    .eq("id", payment.id)
    .eq("status", "created");

  if (claimErr) {
    console.error("[commission-payments] claim failed:", claimErr.message);
    return { state: "error" };
  }

  // CLAIMED NOTHING. The money is real — the order is PAID and the amount
  // matches — but this row is no longer 'created', so the capture was not
  // recorded against it. Two ways that happens, and they need opposite answers:
  //
  //   • Another caller (webhook vs return page) already claimed it and the row
  //     is 'verified'. That is the intended race; settling is idempotent, so
  //     carry on.
  //   • The row was retired to 'failed' by a later attempt. Settling now would
  //     write off the debt while verified_at, cashfree_payment_id and
  //     raw_response stay empty — the capture would have no record of which
  //     order it came from, and /owner/commissions would go on telling the owner
  //     "nothing was charged" about money that was.
  if (claimed === 0) {
    const { data: after } = await db
      .from("owner_commission_payments")
      .select("status")
      .eq("id", payment.id)
      .maybeSingle();

    if (after?.status !== "verified") {
      console.error(
        `[commission-payments] captured ${owed} on ${orderId} but attempt ${payment.id} ` +
        `is '${after?.status ?? "missing"}', not 'created' — capture NOT recorded against it`,
      );
      return { state: "unsettled", commissionId: payment.commission_id, amount: owed };
    }
  }

  return markCommissionSettled(payment.commission_id, payment.id, owed);
}

/**
 * Flips the commission to paid, once.
 *
 * The `.neq("status", "paid")` guard is what makes a webhook redelivery, a
 * refreshed return page and a manual retry converge on one transition instead
 * of three — and it is why paid_at records the first settlement rather than the
 * most recent replay of it.
 */
async function markCommissionSettled(
  commissionId: string,
  paymentId: string,
  amount: number,
): Promise<ApplyCommissionPaymentResult> {
  const db = admin();

  const { data: current, error: readErr } = await db
    .from("commissions")
    .select("id, status, lead_id, booking_id")
    .eq("id", commissionId)
    .maybeSingle();

  if (readErr || !current) {
    console.error("[commission-payments] commission read failed:", readErr?.message ?? "missing row");
    return { state: "unsettled", commissionId, amount };
  }

  // Belt and braces on the same rule assertLeadCommission enforces at the front
  // door. Money has now changed hands, so this cannot refuse — but it must not
  // silently mark a BOOKING commission paid, because that would write off a
  // debt that was already retained from a customer advance.
  if (current.booking_id != null) {
    console.error(
      `[commission-payments] payment ${paymentId} points at booking commission ${commissionId} — not settling`,
    );
    return { state: "unsettled", commissionId, amount };
  }

  if (String(current.status) === "paid") {
    return { state: "paid", commissionId, amount };
  }

  const { error: updErr, count } = await db
    .from("commissions")
    .update(
      {
        status: "paid",
        paid_at: new Date().toISOString(),
        payment_method: "cashfree",
        payment_reference: paymentId,
      },
      { count: "exact" },
    )
    .eq("id", commissionId)
    .neq("status", "paid");

  if (updErr) {
    console.error("[commission-payments] settle failed:", updErr.message);
    return { state: "unsettled", commissionId, amount };
  }
  // Zero rows means a concurrent call already flipped it — which is success.
  if ((count ?? 0) === 0) {
    return { state: "paid", commissionId, amount };
  }

  return { state: "paid", commissionId, amount };
}

// ── Reads for the dashboards ─────────────────────────────────────────────────

export type CommissionPaymentRow = {
  id: string;
  commission_id: string;
  amount: number;
  status: string;
  method: string;
  cashfree_order_id: string | null;
  cashfree_payment_id: string | null;
  submitted_at: string;
  verified_at: string | null;
  admin_note: string | null;
};

const PAYMENT_COLUMNS =
  "id, commission_id, amount, status, method, cashfree_order_id, cashfree_payment_id, " +
  "submitted_at, verified_at, admin_note";

function toPaymentRow(row: Record<string, unknown>): CommissionPaymentRow {
  return {
    id: String(row.id),
    commission_id: String(row.commission_id),
    amount: Number(row.amount ?? 0),
    status: String(row.status),
    method: String(row.method ?? "upi_gateway"),
    cashfree_order_id: (row.cashfree_order_id as string | null) ?? null,
    cashfree_payment_id: (row.cashfree_payment_id as string | null) ?? null,
    submitted_at: String(row.submitted_at),
    verified_at: (row.verified_at as string | null) ?? null,
    admin_note: (row.admin_note as string | null) ?? null,
  };
}

/** Settlement attempts for a set of commissions, newest first per commission. */
export async function fetchCommissionPayments(
  commissionIds: readonly string[],
): Promise<Map<string, CommissionPaymentRow[]>> {
  const out = new Map<string, CommissionPaymentRow[]>();
  if (commissionIds.length === 0) return out;
  try {
    const { data, error } = await admin()
      .from("owner_commission_payments")
      .select(PAYMENT_COLUMNS)
      .in("commission_id", [...commissionIds])
      .order("submitted_at", { ascending: false });
    if (error) {
      console.error("[commission-payments] history failed", error.code, error.message);
      return out;
    }
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const p = toPaymentRow(row);
      const list = out.get(p.commission_id) ?? [];
      list.push(p);
      out.set(p.commission_id, list);
    }
    return out;
  } catch (e) {
    console.error("[commission-payments] history threw", e instanceof Error ? e.message : e);
    return out;
  }
}
