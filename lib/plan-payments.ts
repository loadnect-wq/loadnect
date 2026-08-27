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
//   • cashfree_order_id is UNIQUE, so a redelivered webhook cannot create a
//     second purchase; and premium_listings.plan_purchase_id is UNIQUE, so one
//     purchase can never grant two listings however often activation is retried.
//
// MONEY AND DELIVERY ARE SEPARATE STEPS, deliberately. Capturing the payment
// and granting the listing cannot be one transaction across two systems, so the
// capture is recorded first and the listing is granted by a step that RE-RUNS
// on every call until it succeeds. A purchase that is paid but not yet
// activated reports 'unactivated' — never success — so the webhook keeps
// retrying and the owner is never told a plan is live when it is not.
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

/** Which Cashfree environment the browser SDK should open against. */
function gatewayMode(): "sandbox" | "production" {
  return process.env.CASHFREE_ENV === "production" ? "production" : "sandbox";
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
 * ALWAYS A NEW ROW, NEVER A MUTATION. Renewing used to push the live listing's
 * end_date out in place. That is not safe to retry: if the write that linked
 * the purchase to the listing then failed, a second attempt would extend the
 * same row again and hand out a free duration. Queuing a fresh row instead
 * makes activation a pure INSERT, which the UNIQUE index on plan_purchase_id
 * (migration 0043) turns into an exactly-once operation.
 *
 * QUEUED: renewing the SAME plan while it is still running starts the new
 * window the day after the current one ends. The owner keeps every day they
 * already paid for — the coverage is continuous and the total is identical to
 * extending in place.
 * IMMEDIATE: a DIFFERENT plan starts today, so an owner on Premium who buys Pro
 * is promoted at once rather than waiting for Premium to lapse.
 * recompute_hall_premium takes the highest tier among live windows, so both
 * plans simply co-exist and the better one wins.
 *
 * 'start' is inclusive, so a 30-day plan starting on the 1st ends on the 30th —
 * 30 days of promotion, not 31.
 */
export function planWindow(input: {
  today: string;
  /** end_date of a live listing for the SAME plan, if there is one. */
  sameplanEndDate: string | null;
  durationDays: number;
}): { startDate: string; endDate: string; mode: "queued" | "immediate" } {
  const { today, sameplanEndDate, durationDays } = input;

  if (sameplanEndDate && sameplanEndDate >= today) {
    const startDate = addDays(sameplanEndDate, 1);
    return { startDate, endDate: addDays(startDate, durationDays - 1), mode: "queued" };
  }
  return { startDate: today, endDate: addDays(today, durationDays - 1), mode: "immediate" };
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

    // ACTIVE — still payable. Hand back the same session rather than opening a
    // second one.
    if (live.ok && live.data.order_status === "ACTIVE") {
      return {
        ok: true,
        paymentSessionId: existing.payment_session_id,
        orderId:          existing.cashfree_order_id,
        amount,
        mode: gatewayMode(),
      };
    }

    // ALREADY PAID. The webhook has not landed yet, so our row still says
    // 'created' — but the owner's money is gone. Opening a fresh order here
    // would let them pay a second time for the same plan. Apply the payment
    // instead and tell them it is done.
    if (live.ok && live.data.order_status === "PAID") {
      await verifyAndApplyPlanPurchase(existing.cashfree_order_id);
      return {
        ok: false,
        error: "You have already paid for this plan — we are activating it now. Refresh your premium page in a moment.",
      };
    }

    // COULD NOT READ THE STATUS. We do not know whether that order was paid, so
    // we must not create another payable one. Failing closed costs a retry;
    // failing open can cost the owner ₹9,999 twice.
    if (!live.ok) {
      console.error("[plan-payments] could not read in-flight order:", live.error);
      return {
        ok: false,
        error: "We could not check your previous payment attempt just now. Please try again in a moment — this is to make sure you are not charged twice.",
      };
    }

    // Anything else (EXPIRED, TERMINATED) is genuinely finished. Mark it so it
    // stops being reconsidered, and fall through to a new order.
    await db.from("plan_purchases")
      .update({ status: "failed", raw_response: live.data })
      .eq("id", existing.id)
      .eq("status", "created");
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

  // THIS WRITE IS LOAD-BEARING and was previously neither error- nor
  // count-checked. cashfree_order_id is the ONLY way a payment finds its way
  // back to this row: verifyAndApplyPlanPurchase looks the purchase up by it.
  // If it silently failed, the owner would pay and no webhook, return page or
  // retry could ever match the money to anything — a charge with no record.
  // Better to refuse checkout than to take money we cannot reconcile.
  const { error: linkErr, count: linked } = await db
    .from("plan_purchases")
    .update(
      {
        cashfree_order_id:  orderId,
        payment_session_id: order.data.payment_session_id,
      },
      { count: "exact" },
    )
    .eq("id", purchase.id);

  if (linkErr || !linked) {
    console.error(
      `[plan-payments] could not record order ${orderId} on purchase ${purchase.id}:`,
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
    amount,
    mode: gatewayMode(),
  };
}

export type ApplyPlanPaymentResult = {
  /** paid        — money captured AND the listing is live.
   *  pending     — still payable, nothing captured.
   *  failed      — terminal, nothing captured.
   *  unactivated — MONEY CAPTURED BUT NO LISTING. Never reported as success.
   *  not_found   — no purchase matches this order id.
   *  error       — could not determine; the caller must retry. */
  state: "paid" | "pending" | "failed" | "unactivated" | "not_found" | "error";
  hallId?: string;
  planSlug?: string;
  startDate?: string;
  endDate?: string;
};

/**
 * Re-verifies a plan order against Cashfree and, on success, activates the
 * listing. Idempotent: safe to call from the webhook and the return page, in
 * any order, any number of times.
 *
 * ACTIVATION IS RETRIED, NOT ASSUMED. An earlier version used the status claim
 * ('created' to 'paid') as the only gate and activated once, inline. If that
 * activation failed, the row was stranded paid-with-no-listing: every later
 * call found the claim already taken, returned "paid", and never tried again —
 * so an owner could be charged Rs9,999, receive nothing, and be told it worked.
 * Now the claim records only the MONEY; the listing is granted by a separate
 * step that runs on every call until it succeeds, and is exactly-once because
 * premium_listings.plan_purchase_id is UNIQUE (migration 0043).
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

  // Already captured. Do NOT return success on the strength of that alone — the
  // listing is what the owner bought. If it is missing, finish the job.
  if (purchase.status === "paid") {
    return finishActivation(db, purchase);
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
  const paidAmount = Number(order.data.order_amount ?? 0);
  const owed = Number(purchase.amount);
  if (Math.abs(paidAmount - owed) > 0.5) {
    console.error(`[plan-payments] amount mismatch on ${orderId}: paid ${paidAmount}, expected ${owed}`);
    return { state: "error" };
  }

  // Record the MONEY. Status-guarded so exactly one caller writes it; whoever
  // loses simply proceeds to activation below, which is itself safe to run
  // concurrently.
  const { error: claimErr } = await db
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

  return finishActivation(db, { ...purchase, status: "paid" });
}

/**
 * Grants the listing this purchase paid for, if it does not have one yet.
 *
 * Safe to call repeatedly and concurrently: it first looks for a listing
 * already carrying this purchase id, and the INSERT is protected by a UNIQUE
 * index on that column, so a lost race surfaces as 23505 and is resolved by
 * re-reading rather than by granting a second listing.
 */
async function finishActivation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  purchase: {
    id: string; hall_id: string; plan_slug: string;
    amount: number; duration_days: number; premium_listing_id: string | null;
  },
): Promise<ApplyPlanPaymentResult> {
  const base = { hallId: purchase.hall_id, planSlug: purchase.plan_slug };

  try {
    // 1. Has this purchase already produced a listing? Keyed on the purchase,
    //    NOT on plan_purchases.premium_listing_id — that link-back write can
    //    itself fail, which is exactly how the old code lost track.
    const { data: mine, error: mineErr } = await db
      .from("premium_listings")
      .select("id, start_date, end_date")
      .eq("plan_purchase_id", purchase.id)
      .maybeSingle();
    if (mineErr) throw mineErr;

    if (mine) {
      await linkBack(db, purchase, mine.id);
      return { state: "paid", ...base, startDate: mine.start_date, endDate: mine.end_date };
    }

    // 2. Work out the window. A live listing for the SAME plan means this is a
    //    renewal, so the new window queues after it instead of overlapping.
    const today = isoDay(new Date());
    const { data: live, error: liveErr } = await db
      .from("premium_listings")
      .select("end_date")
      .eq("hall_id", purchase.hall_id)
      .eq("plan_slug", purchase.plan_slug)
      .eq("is_active", true)
      .gte("end_date", today)
      .order("end_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (liveErr) throw liveErr;

    const window = planWindow({
      today,
      sameplanEndDate: live?.end_date ?? null,
      durationDays:    Number(purchase.duration_days),
    });

    const { data: created, error: insErr } = await db
      .from("premium_listings")
      .insert({
        hall_id:          purchase.hall_id,
        plan_slug:        purchase.plan_slug,
        plan_purchase_id: purchase.id,
        start_date:       window.startDate,
        end_date:         window.endDate,
        amount:           purchase.amount,
        is_active:        true,
      })
      .select("id, start_date, end_date")
      .maybeSingle();

    if (insErr) {
      // 23505 = another caller won the race and created it. Not an error.
      if (insErr.code !== "23505") throw insErr;
      const { data: theirs } = await db
        .from("premium_listings")
        .select("id, start_date, end_date")
        .eq("plan_purchase_id", purchase.id)
        .maybeSingle();
      if (!theirs) throw insErr;
      await linkBack(db, purchase, theirs.id);
      return { state: "paid", ...base, startDate: theirs.start_date, endDate: theirs.end_date };
    }

    if (created?.id) await linkBack(db, purchase, created.id);

    // The AFTER trigger on premium_listings recomputes halls.premium_tier, so
    // an immediate window is live the moment this returns.
    return { state: "paid", ...base, startDate: created?.start_date, endDate: created?.end_date };
  } catch (e) {
    // The money is captured and the purchase stays 'paid' — the owner paid and
    // is owed the listing, so that record must not be unwound. But this is NOT
    // reported as success: the caller returns 'unactivated', the webhook asks
    // Cashfree to retry, and the status page says we could not confirm it
    // rather than "your plan is active".
    console.error(
      `[plan-payments] PAID BUT NOT ACTIVATED purchase=${purchase.id} hall=${purchase.hall_id} ` +
      `plan=${purchase.plan_slug}:`,
      e instanceof Error ? e.message : e,
    );
    return { state: "unactivated", ...base };
  }
}

/** Best-effort link from the purchase back to its listing. Purely for
 *  reporting — activation no longer depends on it, which is the point. */
async function linkBack(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  purchase: { id: string; premium_listing_id: string | null },
  listingId: string,
): Promise<void> {
  if (purchase.premium_listing_id === listingId) return;
  const { error } = await db
    .from("plan_purchases")
    .update({ premium_listing_id: listingId })
    .eq("id", purchase.id);
  if (error) console.error("[plan-payments] link-back failed (the listing IS granted):", error.message);
}
