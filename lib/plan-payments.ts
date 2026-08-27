// ─────────────────────────────────────────────────────────────────────────────
// lib/plan-payments.ts — an owner buys a Premium/Pro listing plan through
// Cashfree, and the listing activates itself on verified payment. SERVER-ONLY.
//
// Before this, "upgrade" was a link to the contact form. An admin collected the
// money out of band, then typed an amount into a free-text field to grant the
// listing. Nothing connected the payment to the promotion.
//
// SECURITY, same rules as every other money path here:
//   • The amount is NEVER taken from the browser. It is read from the
//     premium_plans catalogue server-side, and a DB trigger
//     (guard_plan_purchase_integrity, migration 0040) independently rejects a
//     row whose amount, duration, plan or hall ownership does not match.
//   • Ownership is verified against the database: the hall must belong to the
//     hall_owners row of the AUTHENTICATED caller.
//   • Payment is confirmed by re-reading the order from Cashfree. The return
//     URL's claim of success is never trusted.
//   • cashfree_order_id is UNIQUE, and activation is status-guarded, so a
//     redelivered webhook cannot grant a second listing.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createCashfreeOrder, getCashfreeOrder } from "@/lib/cashfree";
import { getCanonicalAppUrl } from "@/lib/app-url";

/** Plan orders are prefixed HNP_ so the shared Cashfree webhook can tell them
 *  apart from customer booking orders (HN_) without a database lookup. */
export const PLAN_ORDER_PREFIX = "HNP_";

export function isPlanOrderId(orderId: string): boolean {
  return orderId.startsWith(PLAN_ORDER_PREFIX);
}

function buildPlanOrderId(purchaseId: string): string {
  const compact = purchaseId.replace(/-/g, "").slice(0, 18);
  return `${PLAN_ORDER_PREFIX}${compact}_${Date.now().toString(36)}`;
}

/** Cashfree requires a plain 10–15 digit number, no "+" or spaces. */
function normalisePhone(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "").slice(-12);
}

/** How long the gateway order stays payable. Cashfree rejects anything not
 *  MORE than 15 minutes out (see lib/payments.ts), so this sits clear of it.
 *  Unlike a booking there is no slot being held, so nothing is lost by being
 *  generous — the only cost of an abandoned order is a stale 'created' row. */
const PLAN_ORDER_TTL_MIN = 30;

function planOrderExpiry(): string {
  return new Date(Date.now() + PLAN_ORDER_TTL_MIN * 60_000).toISOString();
}

/** YYYY-MM-DD for a Date, in UTC. premium_listings.start/end_date are DATEs. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

/**
 * Works out the window a purchase buys.
 *
 * Exported for tests: this is the arithmetic that decides how many days an
 * owner actually receives for their money, and it is easy to get wrong by one
 * day in either direction.
 *
 * EXTEND: renewing a plan that is still running pushes its end_date out by the
 * full duration, so none of the days already paid for are lost.
 * NEW: anything else starts today and runs for the duration. 'today' is
 * inclusive, so a 30-day plan bought on the 1st covers the 1st and ends on the
 * 31st — 30 days of promotion, not 31.
 */
export function planWindow(input: {
  today: string;
  activeEndDate: string | null;
  durationDays: number;
}): { startDate: string; endDate: string; mode: "extend" | "new" } {
  const { today, activeEndDate, durationDays } = input;

  if (activeEndDate && activeEndDate >= today) {
    return { startDate: today, endDate: addDays(activeEndDate, durationDays), mode: "extend" };
  }
  return { startDate: today, endDate: addDays(today, durationDays - 1), mode: "new" };
}

export type StartPlanPurchaseResult =
  | { ok: true; paymentSessionId: string; orderId: string; amount: number; mode: "sandbox" | "production" }
  | { ok: false; error: string };

/**
 * Opens a Cashfree order for one hall + plan and records the purchase.
 * `ownerProfileId` is the AUTHENTICATED user's profile id — resolved by the
 * caller from the session, never from the request body.
 */
export async function startPlanPurchase(input: {
  hallId: string;
  planSlug: string;
  ownerProfileId: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string | null;
}): Promise<StartPlanPurchaseResult> {
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  // 1. The plan, from the catalogue. This is the ONLY source of the price.
  const { data: plan, error: planErr } = await db
    .from("premium_plans")
    .select("slug, name, monthly_price, duration_days, is_purchasable")
    .eq("slug", input.planSlug)
    .maybeSingle();

  if (planErr) return { ok: false, error: "Could not load the plan catalogue." };
  if (!plan)   return { ok: false, error: "That plan does not exist." };
  if (!plan.is_purchasable) return { ok: false, error: `The ${plan.name} plan is not available for purchase.` };

  const amount = Number(plan.monthly_price);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "This plan has no price set. Please contact Hallnect support." };
  }

  // 2. The hall, and that it belongs to the CALLER — checked against the
  //    database rather than anything the client supplied.
  const { data: hall, error: hallErr } = await db
    .from("halls")
    .select("id, name, status, owner_id, hall_owners!owner_id(id, profile_id)")
    .eq("id", input.hallId)
    .maybeSingle();

  if (hallErr) return { ok: false, error: "Could not load that hall." };
  if (!hall)   return { ok: false, error: "Hall not found." };
  if (hall.hall_owners?.profile_id !== input.ownerProfileId) {
    return { ok: false, error: "That hall does not belong to you." };
  }

  // Promotion only makes sense for a hall customers can actually see. Taking
  // money to rank a pending or suspended listing higher would be selling
  // nothing.
  if (hall.status !== "approved") {
    return {
      ok: false,
      error: "This hall is not live yet. A plan can only be bought for an approved listing.",
    };
  }

  // 3. Reuse an in-flight order rather than opening a second one for the same
  //    hall and plan — a double-click must not create two payable orders.
  const { data: existing } = await db
    .from("plan_purchases")
    .select("id, cashfree_order_id, payment_session_id")
    .eq("hall_id", input.hallId)
    .eq("plan_slug", input.planSlug)
    .eq("status", "created")
    .not("payment_session_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.cashfree_order_id && existing.payment_session_id) {
    const live = await getCashfreeOrder(existing.cashfree_order_id);
    if (live.ok && live.data.order_status === "ACTIVE") {
      return {
        ok: true,
        paymentSessionId: existing.payment_session_id,
        orderId:          existing.cashfree_order_id,
        amount,
        mode: process.env.CASHFREE_ENV === "production" ? "production" : "sandbox",
      };
    }
  }

  // 4. Record the purchase FIRST, so the order id we hand Cashfree already has
  //    a row to come back to. The guard trigger re-checks price, duration,
  //    purchasability and hall ownership at this point.
  const { data: purchase, error: insErr } = await db
    .from("plan_purchases")
    .insert({
      owner_id:      hall.hall_owners.id,
      hall_id:       input.hallId,
      plan_slug:     plan.slug,
      amount,
      duration_days: Number(plan.duration_days),
      status:        "created",
    })
    .select("id")
    .maybeSingle();

  if (insErr || !purchase) {
    console.error("[plan-payments] purchase insert failed:", insErr?.message);
    return { ok: false, error: "Could not start this purchase. Please try again." };
  }

  const orderId = buildPlanOrderId(purchase.id);
  const origin  = getCanonicalAppUrl();

  const order = await createCashfreeOrder({
    orderId,
    amount,
    customerId:    input.ownerProfileId,
    customerName:  input.ownerName || "Hall owner",
    customerEmail: input.ownerEmail,
    customerPhone: normalisePhone(input.ownerPhone),
    returnUrl:     `${origin}/owner/premium/status?order_id={order_id}`,
    notifyUrl:     `${origin}/api/webhooks/cashfree`,
    expiresAt:     planOrderExpiry(),
    note:          `${plan.name} plan for ${hall.name}`,
  });

  if (!order.ok) {
    await db.from("plan_purchases")
      .update({ status: "failed", raw_response: { error: order.error } })
      .eq("id", purchase.id);
    return { ok: false, error: order.error };
  }

  if (!order.data.payment_session_id) {
    await db.from("plan_purchases").update({ status: "failed" }).eq("id", purchase.id);
    return { ok: false, error: "Cashfree did not return a payment session. Please retry." };
  }

  await db.from("plan_purchases")
    .update({
      cashfree_order_id:  orderId,
      payment_session_id: order.data.payment_session_id,
    })
    .eq("id", purchase.id);

  return {
    ok: true,
    paymentSessionId: order.data.payment_session_id,
    orderId,
    amount,
    mode: process.env.CASHFREE_ENV === "production" ? "production" : "sandbox",
  };
}

export type ApplyPlanPaymentResult = {
  state: "paid" | "pending" | "failed" | "not_found" | "error";
  hallId?: string;
  planSlug?: string;
  endDate?: string;
};

/**
 * Re-verifies a plan order against Cashfree and, on success, activates the
 * listing. Idempotent: safe to call from the webhook and the return page, in
 * any order, any number of times.
 */
export async function verifyAndApplyPlanPurchase(orderId: string): Promise<ApplyPlanPaymentResult> {
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  const { data: purchase, error: pErr } = await db
    .from("plan_purchases")
    .select("id, owner_id, hall_id, plan_slug, amount, duration_days, status, premium_listing_id")
    .eq("cashfree_order_id", orderId)
    .maybeSingle();

  if (pErr) {
    console.error("[plan-payments] purchase lookup failed:", pErr.message);
    return { state: "error" };
  }
  if (!purchase) return { state: "not_found" };

  // Already applied — nothing to do. Report the outcome so the return page can
  // render the receipt without re-running anything.
  if (purchase.status === "paid" && purchase.premium_listing_id) {
    return { state: "paid", hallId: purchase.hall_id, planSlug: purchase.plan_slug };
  }

  const order = await getCashfreeOrder(orderId);
  if (!order.ok) {
    console.error("[plan-payments] order fetch failed:", order.error);
    return { state: "error" };
  }

  const status = order.data.order_status;

  if (status !== "PAID") {
    // ACTIVE means the owner has not finished paying — still payable, not a
    // failure. Anything else is terminal.
    if (status === "ACTIVE") return { state: "pending" };
    await db.from("plan_purchases")
      .update({ status: "failed", raw_response: order.data })
      .eq("id", purchase.id)
      .eq("status", "created");
    return { state: "failed" };
  }

  // Cashfree says PAID. Confirm the amount is the one we recorded — a mismatch
  // means the order was not the one we created and must never grant a listing.
  const paid = Number(order.data.order_amount ?? 0);
  const owed = Number(purchase.amount);
  if (Math.abs(paid - owed) > 0.5) {
    console.error(`[plan-payments] amount mismatch on ${orderId}: paid ${paid}, expected ${owed}`);
    return { state: "error" };
  }

  // ── Claim the purchase. Status-guarded, count-checked: exactly one caller
  //    wins, so a webhook and the return page racing cannot both activate.
  const { count: claimed, error: claimErr } = await db
    .from("plan_purchases")
    .update(
      {
        status:              "paid",
        paid_at:             new Date().toISOString(),
        cashfree_payment_id: order.data.cf_order_id ? String(order.data.cf_order_id) : null,
        raw_response:        order.data,
      },
      { count: "exact" },
    )
    .eq("id", purchase.id)
    .eq("status", "created");

  if (claimErr) {
    console.error("[plan-payments] claim failed:", claimErr.message);
    return { state: "error" };
  }

  if (!claimed) {
    // Someone else claimed it first. Re-read to report their outcome rather
    // than activating a second listing.
    const { data: after } = await db
      .from("plan_purchases")
      .select("status, hall_id, plan_slug")
      .eq("id", purchase.id)
      .maybeSingle();
    return after?.status === "paid"
      ? { state: "paid", hallId: after.hall_id, planSlug: after.plan_slug }
      : { state: "error" };
  }

  const endDate = await activateListing(db, purchase);
  return { state: "paid", hallId: purchase.hall_id, planSlug: purchase.plan_slug, endDate };
}

/**
 * Grants (or extends) the premium listing this purchase paid for.
 *
 * Stacking rule: buying the SAME plan again while it is still running EXTENDS
 * the existing window rather than opening a parallel one, so a renewal never
 * loses the days already paid for. Buying a DIFFERENT plan opens its own
 * window — recompute_hall_premium takes the highest active tier, so an owner
 * on Premium who buys Pro is upgraded immediately and their remaining Premium
 * days are not thrown away.
 */
async function activateListing(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  purchase: { id: string; hall_id: string; plan_slug: string; amount: number; duration_days: number },
): Promise<string | undefined> {
  const days  = Number(purchase.duration_days);
  const today = isoDay(new Date());

  try {
    const { data: live } = await db
      .from("premium_listings")
      .select("id, end_date")
      .eq("hall_id", purchase.hall_id)
      .eq("plan_slug", purchase.plan_slug)
      .eq("is_active", true)
      .gte("end_date", today)
      .order("end_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const window = planWindow({
      today,
      activeEndDate: live?.end_date ?? null,
      durationDays:  days,
    });

    let listingId: string | undefined;

    if (window.mode === "extend" && live?.id) {
      const { error } = await db
        .from("premium_listings")
        .update({ end_date: window.endDate })
        .eq("id", live.id);
      if (error) throw error;
      listingId = live.id;
    } else {
      const { data: created, error } = await db
        .from("premium_listings")
        .insert({
          hall_id:    purchase.hall_id,
          plan_slug:  purchase.plan_slug,
          start_date: window.startDate,
          end_date:   window.endDate,
          amount:     purchase.amount,
          is_active:  true,
        })
        .select("id")
        .maybeSingle();
      if (error) throw error;
      listingId = created?.id;
    }

    if (listingId) {
      await db.from("plan_purchases")
        .update({ premium_listing_id: listingId })
        .eq("id", purchase.id);
    }

    // The AFTER trigger on premium_listings recomputes halls.premium_tier, so
    // the boost is live the moment this returns.
    return window.endDate;
  } catch (e) {
    // The money is taken and the purchase is marked paid. Do NOT unwind that —
    // the owner paid and is owed the listing. Surface it loudly so an admin can
    // grant it by hand from /admin/premium-listings.
    console.error(
      `[plan-payments] PAID BUT NOT ACTIVATED purchase=${purchase.id} hall=${purchase.hall_id} ` +
      `plan=${purchase.plan_slug}:`,
      e instanceof Error ? e.message : e,
    );
    return undefined;
  }
}
