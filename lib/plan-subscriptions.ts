// ─────────────────────────────────────────────────────────────────────────────
// lib/plan-subscriptions.ts — auto-renewing monthly Premium/Pro. SERVER-ONLY.
//
// The owner authorises a mandate ONCE. Cashfree then debits them every month
// and tells us; each successful debit buys another month of boost.
//
// THE CENTRAL DESIGN DECISION: a renewal is not a new mechanism. Every charge —
// the first one and every monthly one after it — is written as a plan_purchases
// row and activated by finishActivation() in lib/plan-payments.ts. That reuses,
// unchanged, the two properties that were hardest to get right for one-off
// purchases:
//   • the DB price guard, so a charge can never record an amount that is not
//     the catalogue price;
//   • exactly-once activation via the UNIQUE premium_listings.plan_purchase_id,
//     so a redelivered renewal webhook cannot grant two months.
// A renewal that arrives twice is therefore as safe as a one-off that arrives
// twice, and that path already has tests and live proof behind it.
//
// SECURITY, unchanged from the one-off flow: the amount is never taken from the
// browser, hall ownership is checked against the database, and Cashfree's own
// API is the authority on whether a mandate is live.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import crypto from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCanonicalAppUrl } from "@/lib/app-url";
import {
  createCashfreeSubscription,
  getCashfreeSubscription,
  getCashfreeSubscriptionPayments,
  cancelCashfreeSubscription,
  mapSubscriptionStatus,
} from "@/lib/cashfree-subscriptions";
import { activatePurchase } from "@/lib/plan-payments";
import {
  notifySubscriptionCharged,
  notifySubscriptionStopped,
  notifyPlanChargeUnactivated,
} from "@/lib/notifications/events";

/** Subscription ids are prefixed so they are recognisable in Cashfree's UI and
 *  in webhook payloads without a database lookup. */
export const SUBSCRIPTION_ID_PREFIX = "HNS_";

export function isPlanSubscriptionId(id: string): boolean {
  return id.startsWith(SUBSCRIPTION_ID_PREFIX);
}

function buildSubscriptionId(rowId: string): string {
  return `${SUBSCRIPTION_ID_PREFIX}${rowId.replace(/-/g, "").slice(0, 18)}_${Date.now().toString(36)}`;
}

/**
 * Placeholder written into cf_subscription_id BEFORE Cashfree is called.
 *
 * The column is NOT NULL and UNIQUE, so the row cannot be created empty and
 * filled in afterwards — it has to carry something. A value with this prefix
 * therefore means one thing only: WE NEVER HEARD BACK FROM CASHFREE, so no
 * mandate exists behind this row and nothing has ever been charged for it.
 * Both the writer and the reader below use this constant so they cannot drift.
 */
const PENDING_MANDATE_PREFIX = "pending_";

export function isUnauthorisedPlaceholder(cfSubscriptionId: string | null | undefined): boolean {
  return String(cfSubscriptionId ?? "").startsWith(PENDING_MANDATE_PREFIX);
}

/**
 * What a monthly charge is RECORDED and RECEIPTED at.
 *
 * The amount Cashfree debited, whenever it sent one. A mandate goes on charging
 * whatever it was authorised at, so today's catalogue price is not evidence of
 * anything about a charge that already happened — reading it back would restate
 * an old renewal at the new price and put that figure in the owner's receipt.
 * The catalogue price is the fallback for one case only: a charge record that
 * carries no amount at all.
 */
export function subscriptionChargeAmount(
  paidAmount: number | null | undefined,
  cataloguePrice: number,
): number {
  const paid = Number(paidAmount);
  return Number.isFinite(paid) && paid > 0 ? paid : cataloguePrice;
}

function normalisePhone(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "").slice(-12);
}

/** How long a half-finished mandate may be resumed rather than reopened.
 *  Same lesson as the one-off flow: a gateway session goes stale well before
 *  the record around it does, and replaying a dead one looks exactly like a
 *  broken button. Past this, the attempt is retired and a fresh one opened. */
const MANDATE_RESUME_WINDOW_MIN = 15;

/** "premium" -> "Premium". Used in owner-facing message copy. */
function planLabelFor(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function gatewayMode(): "sandbox" | "production" {
  return process.env.CASHFREE_ENV === "production" ? "production" : "sandbox";
}

export type StartSubscriptionResult =
  | { ok: true; subsSessionId: string; subscriptionId: string; amount: number; mode: "sandbox" | "production" }
  | { ok: false; error: string };

/**
 * Creates (or resumes) a monthly subscription for one hall + plan and returns
 * the session the browser SDK needs to collect the mandate.
 */
export async function startPlanSubscription(input: {
  hallId: string;
  planSlug: string;
  ownerProfileId: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string | null;
}): Promise<StartSubscriptionResult> {
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  // 1. The plan, from the catalogue — the ONLY source of price and Cashfree id.
  const { data: plan, error: planErr } = await db
    .from("premium_plans")
    .select("slug, name, monthly_price, duration_days, is_purchasable, cf_plan_id")
    .eq("slug", input.planSlug)
    .maybeSingle();

  if (planErr) return { ok: false, error: "Could not load the plan catalogue." };
  if (!plan)   return { ok: false, error: "That plan does not exist." };
  if (!plan.is_purchasable) return { ok: false, error: `The ${plan.name} plan is not available right now.` };
  if (!plan.cf_plan_id) {
    console.error(`[plan-subscriptions] plan ${plan.slug} has no cf_plan_id`);
    return { ok: false, error: "This plan is not set up for monthly billing yet. Please contact Hallnect support." };
  }

  const amount = Number(plan.monthly_price);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "This plan has no price set. Please contact Hallnect support." };
  }

  // 2. The hall, and that it belongs to the CALLER.
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
  if (hall.status !== "approved") {
    return { ok: false, error: "This hall is not live yet. A plan can only be bought for an approved listing." };
  }

  // 3. Already subscribed? Say so rather than starting a second mandate — a
  //    duplicate here bills the owner twice a month, every month, which is far
  //    worse than a duplicate one-off charge.
  const { data: existing } = await db
    .from("plan_subscriptions")
    .select("id, cf_subscription_id, status, created_at")
    .eq("hall_id", input.hallId)
    .eq("plan_slug", input.planSlug)
    .in("status", ["created", "active", "on_hold", "paused"])
    .maybeSingle();

  // AN INTERRUPTED SUBSCRIBE MUST NOT LOCK THE HALL OUT FOREVER.
  //
  // The row below is inserted with a `pending_` placeholder before Cashfree is
  // called. If that request dies — tab closed, deploy mid-flight, gateway
  // timeout — the placeholder row survives at status 'created', which is inside
  // uq_plan_subscriptions_live. Every later attempt then found it here and
  // asked Cashfree about an id Cashfree has never seen; the lookup fails, and
  // the "we could not check your existing subscription" guard below (correct
  // for a REAL mandate) refused permanently. That hall could never subscribe to
  // that plan again, and no support action short of a manual DB edit fixed it.
  //
  // A placeholder id is proof there is no mandate, so there is nothing to
  // double-charge and nothing to protect: retire the row and open a fresh
  // attempt below. Marking it 'failed' also takes it out of the partial unique
  // index, so the insert that follows is not blocked by it either.
  if (existing && isUnauthorisedPlaceholder(existing.cf_subscription_id)) {
    const { error: retireErr, count: retired } = await db
      .from("plan_subscriptions")
      .update(
        {
          status:         "failed",
          raw_response:   { error: "Abandoned before Cashfree returned a mandate — no subscription was ever created for this row" },
          last_synced_at: new Date().toISOString(),
        },
        { count: "exact" },
      )
      .eq("id", existing.id)
      // Guarded on the placeholder still being there, so a concurrent attempt
      // that has meanwhile linked a REAL mandate id cannot be retired by us.
      .eq("cf_subscription_id", existing.cf_subscription_id);

    if (retireErr || !retired) {
      // Failing to clear it means the insert below would collide with the live
      // partial index and report something misleading. Say so plainly instead.
      console.error(
        "[plan-subscriptions] could not retire an abandoned attempt:",
        retireErr?.message ?? "0 rows",
      );
      return {
        ok: false,
        error: "Could not start this subscription just now. Please try again in a moment.",
      };
    }
  } else if (existing) {
    const live = await getCashfreeSubscription(existing.cf_subscription_id);

    if (live.ok) {
      const mapped = mapSubscriptionStatus(live.data.subscription_status);

      if (mapped === "active" || mapped === "on_hold" || mapped === "paused") {
        await syncSubscription(existing.cf_subscription_id);
        return { ok: false, error: "This hall is already on this plan — it renews automatically each month." };
      }

      // Still awaiting authorisation. Resume it rather than opening a second
      // mandate — but ONLY while the session is fresh enough to still work.
      const ageMs = Date.now() - Date.parse(existing.created_at);
      const fresh = Number.isFinite(ageMs) && ageMs < MANDATE_RESUME_WINDOW_MIN * 60_000;

      if (mapped === "created" && live.data.subscription_session_id && fresh) {
        return {
          ok: true,
          subsSessionId:  live.data.subscription_session_id,
          subscriptionId: existing.cf_subscription_id,
          amount,
          mode: gatewayMode(),
        };
      }

      // A stale unauthorised attempt. Cancel it at Cashfree so it cannot be
      // authorised later behind our back, retire our row, and open a fresh one
      // below. Nothing was ever charged for it.
      if (mapped === "created") {
        await cancelCashfreeSubscription(existing.cf_subscription_id);
        await db.from("plan_subscriptions")
          .update({
            status:         "cancelled",
            cancelled_at:   new Date().toISOString(),
            last_synced_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      }

      // Terminal at Cashfree — retire our row and start fresh below.
      await db.from("plan_subscriptions")
        .update({ status: mapped, raw_response: live.data, last_synced_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      // We cannot tell whether a mandate is live. Refuse rather than risk a
      // second standing debit.
      return {
        ok: false,
        error: "We could not check your existing subscription just now. Please try again in a moment — this is to make sure you are not billed twice.",
      };
    }
  }

  // 4. Record the agreement FIRST so the id we send Cashfree already has a row.
  const { data: row, error: insErr } = await db
    .from("plan_subscriptions")
    .insert({
      owner_id:           hall.hall_owners.id,
      hall_id:            input.hallId,
      plan_slug:          plan.slug,
      cf_plan_id:         plan.cf_plan_id,
      cf_subscription_id: `${PENDING_MANDATE_PREFIX}${crypto.randomUUID()}`,
      amount,
      status:             "created",
    })
    .select("id")
    .maybeSingle();

  if (insErr || !row) {
    console.error("[plan-subscriptions] insert failed:", insErr?.message);
    return { ok: false, error: "Could not start this subscription. Please try again." };
  }

  const subscriptionId = buildSubscriptionId(row.id);
  const origin = getCanonicalAppUrl();

  const created = await createCashfreeSubscription({
    subscriptionId,
    planId:        plan.cf_plan_id,
    customerName:  input.ownerName || "Hall owner",
    customerEmail: input.ownerEmail,
    customerPhone: normalisePhone(input.ownerPhone),
    returnUrl:     `${origin}/owner/premium/status?subscription_id=${subscriptionId}`,
    // The first month, charged now. Not a Rs1 probe — see CreateSubscriptionParams.
    authorizationAmount: amount,
    note:          `${plan.name} monthly for ${hall.name}`,
  });

  if (!created.ok) {
    await db.from("plan_subscriptions")
      .update({ status: "failed", raw_response: { error: created.error } })
      .eq("id", row.id);
    return { ok: false, error: created.error };
  }

  const session = created.data.subscription_session_id;
  if (!session) {
    await db.from("plan_subscriptions").update({ status: "failed" }).eq("id", row.id);
    return { ok: false, error: "Cashfree did not return a subscription session. Please retry." };
  }

  // Same reasoning as the one-off flow: if we cannot record the id Cashfree will
  // report against, a mandate could be authorised that we can never reconcile.
  const { error: linkErr, count: linked } = await db
    .from("plan_subscriptions")
    .update(
      {
        cf_subscription_id:  subscriptionId,
        cf_subscription_ref: created.data.cf_subscription_id ? String(created.data.cf_subscription_id) : null,
        raw_response:        created.data,
      },
      { count: "exact" },
    )
    .eq("id", row.id);

  if (linkErr || !linked) {
    console.error(`[plan-subscriptions] could not record ${subscriptionId}:`, linkErr?.message ?? "0 rows");
    return { ok: false, error: "We could not start this safely. Nothing has been charged — please try again." };
  }

  return { ok: true, subsSessionId: session, subscriptionId, amount, mode: gatewayMode() };
}

export type SubscriptionSyncResult = {
  state: "active" | "pending" | "cancelled" | "failed" | "not_found" | "error";
  planSlug?: string;
  hallId?: string;
  /** Months successfully charged and turned into boost. */
  chargesApplied?: number;
  nextChargeAt?: string | null;
  /** end_date of the live listing, when there is one. */
  endDate?: string;
  /** A charge was taken but could not be turned into a listing. */
  unactivated?: boolean;
  /**
   * Whether the hall is ACTUALLY boosted right now.
   *
   * Deliberately separate from `state`. An authorised mandate is not the same
   * thing as a paid month: Cashfree can report ACTIVE before the first debit
   * settles, and until money has actually moved there is no listing and no
   * promotion. Reporting "your plan is active" off the mandate alone is the
   * same lie as calling an unauthorised attempt a subscription.
   */
  boosted?: boolean;
};

/**
 * Re-reads a subscription (and its charges) from Cashfree and brings our
 * records into line. This is the ONLY place subscription state is decided —
 * the return page, the webhook and the owner's own page all funnel through it,
 * so they cannot disagree.
 *
 * Idempotent and safe to call as often as you like.
 */
export async function syncSubscription(cfSubscriptionId: string): Promise<SubscriptionSyncResult> {
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  const { data: sub, error: subErr } = await db
    .from("plan_subscriptions")
    .select("id, owner_id, hall_id, plan_slug, amount, status, cf_subscription_id")
    .eq("cf_subscription_id", cfSubscriptionId)
    .maybeSingle();

  if (subErr) {
    console.error("[plan-subscriptions] lookup failed:", subErr.message);
    return { state: "error" };
  }
  if (!sub) return { state: "not_found" };

  const live = await getCashfreeSubscription(cfSubscriptionId);
  if (!live.ok) return { state: "error" };

  const mapped = mapSubscriptionStatus(live.data.subscription_status);
  const nextCharge = live.data.next_schedule_date ?? null;

  // authorized_at / cancelled_at record WHEN a transition first happened, so
  // they are only written on the sync that observes the change. Re-stamping
  // them on every poll would make "subscribed since" drift forward forever.
  const firstActivation = mapped === "active"    && sub.status !== "active";
  const firstCancel     = mapped === "cancelled" && sub.status !== "cancelled";

  // The mandate has STOPPED COLLECTING, and this is the sync that first saw it.
  // Fired on the transition only, so a repeated poll does not nag. This is the
  // one subscription failure the owner can actually act on — a declined debit
  // otherwise surfaces weeks later as "my enquiries dried up", once the paid
  // month has run out and the sweep has quietly retired the listing.
  const stoppedNow =
    ["on_hold", "paused", "cancelled", "failed", "completed"].includes(mapped) &&
    sub.status !== mapped;

  await db.from("plan_subscriptions")
    .update({
      status:              mapped,
      cf_subscription_ref: live.data.cf_subscription_id ? String(live.data.cf_subscription_id) : null,
      next_charge_at:      nextCharge,
      last_synced_at:      new Date().toISOString(),
      raw_response:        live.data,
      ...(firstActivation ? { authorized_at: new Date().toISOString() } : {}),
      ...(firstCancel     ? { cancelled_at:  new Date().toISOString() } : {}),
    })
    .eq("id", sub.id);

  // Whatever the status, reconcile the CHARGES. A cancelled subscription may
  // still have paid months that must be honoured.
  if (stoppedNow) {
    // What they keep: the window already paid for runs to its end date.
    const today = new Date().toISOString().slice(0, 10);
    const { data: paidWindow } = await db
      .from("premium_listings")
      .select("end_date")
      .eq("hall_id", sub.hall_id)
      .eq("plan_slug", sub.plan_slug)
      .eq("is_active", true)
      .gte("end_date", today)
      .order("end_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    await notifySubscriptionStopped({
      subscriptionId: sub.cf_subscription_id,
      hallId:         sub.hall_id,
      planLabel:      planLabelFor(sub.plan_slug),
      status:         mapped as "on_hold" | "paused" | "cancelled" | "failed" | "completed",
      paidUntil:      paidWindow?.end_date ?? null,
    });
  }

  const applied = await applySubscriptionCharges(db, sub, live.data.authorization_details);

  // Is there a live listing behind this subscription right now? This, not the
  // mandate status, is what decides whether the owner is actually promoted.
  const today = new Date().toISOString().slice(0, 10);
  const { data: liveListing } = await db
    .from("premium_listings")
    .select("end_date")
    .eq("hall_id", sub.hall_id)
    .eq("plan_slug", sub.plan_slug)
    .eq("is_active", true)
    .lte("start_date", today)
    .gte("end_date", today)
    .limit(1)
    .maybeSingle();

  const base = {
    planSlug: sub.plan_slug,
    hallId: sub.hall_id,
    nextChargeAt: nextCharge,
    boosted: Boolean(liveListing),
    endDate: liveListing?.end_date ?? undefined,
  };

  if (applied.unactivated) {
    return { state: "active", ...base, chargesApplied: applied.count, unactivated: true };
  }

  switch (mapped) {
    case "active":            return { state: "active",    ...base, chargesApplied: applied.count };
    case "created":           return { state: "pending",   ...base, chargesApplied: applied.count };
    case "cancelled":
    case "completed":         return { state: "cancelled", ...base, chargesApplied: applied.count };
    case "on_hold":
    case "paused":            return { state: "pending",   ...base, chargesApplied: applied.count };
    default:                  return { state: "failed",    ...base, chargesApplied: applied.count };
  }
}

/**
 * Turns every SUCCESSFUL charge on a subscription into a month of boost.
 *
 * Keyed on Cashfree's payment id, which is UNIQUE on plan_purchases — so a
 * charge already recorded is skipped, and a webhook redelivered ten times still
 * buys exactly one month.
 */
async function applySubscriptionCharges(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  sub: { id: string; owner_id: string; hall_id: string; plan_slug: string; amount: number; cf_subscription_id: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auth?: any,
): Promise<{ count: number; unactivated: boolean }> {
  const payments = await getCashfreeSubscriptionPayments(sub.cf_subscription_id);
  if (!payments.ok) return { count: 0, unactivated: false };

  const successful = payments.data.filter(
    (p) => String(p.payment_status ?? "").toUpperCase() === "SUCCESS",
  );

  // THE SIGN-UP DEBIT IS THE FIRST MONTH and may not appear in /payments — it
  // lives on the subscription's authorization_details. Without this, an owner
  // who paid at sign-up would sit unboosted until the second month, which is
  // the exact failure this change exists to remove. Keyed on the same payment
  // id, so if it DOES also appear in /payments it is recorded once, not twice.
  if (auth
      && auth.authorization_amount_refund === false
      && String(auth.authorization_status ?? "").toUpperCase() === "ACTIVE"
      && auth.payment_id) {
    const already = successful.some(
      (p) => String(p.cf_payment_id ?? p.payment_id ?? "") === String(auth.payment_id),
    );
    if (!already) {
      successful.push({
        cf_payment_id:  auth.payment_id,
        payment_status: "SUCCESS",
        payment_amount: Number(auth.authorization_amount),
        payment_time:   auth.authorization_time ?? undefined,
        cycle:          1,
      });
    }
  }

  const { data: plan } = await db
    .from("premium_plans")
    .select("duration_days, monthly_price")
    .eq("slug", sub.plan_slug)
    .maybeSingle();

  /** TODAY's list price. Not what this mandate debits — see below. */
  const cataloguePrice = Number(plan?.monthly_price ?? sub.amount);

  let count = 0;
  let unactivated = false;

  for (const p of successful) {
    const ref = String(p.cf_payment_id ?? p.payment_id ?? "");
    if (!ref) continue;

    // The authorisation debit (Rs1, refunded) is not a month of service.
    const paidAmount = Number(p.payment_amount ?? 0);
    if (Math.abs(paidAmount - Number(sub.amount)) > 0.5) continue;

    // WHAT CASHFREE ACTUALLY DEBITED — never today's list price.
    //
    // A mandate keeps charging the amount it was authorised at; changing
    // premium_plans.monthly_price does not touch it. Recording the catalogue
    // figure therefore rewrote history the instant the price moved: last
    // month's Rs499 renewal was restated as Rs699, and the receipt SMS below —
    // which quotes this same number to the owner as "you have been charged" —
    // stated a figure that never left their account. A receipt has to be true.
    //
    // The guard above has already tied this to the mandate snapshot (within
    // half a rupee of sub.amount), so this is a validated amount, not whatever
    // the gateway happened to send.
    const chargedAmount = subscriptionChargeAmount(paidAmount, cataloguePrice);

    const { data: already } = await db
      .from("plan_purchases")
      .select("id, premium_listing_id")
      .eq("cf_payment_ref", ref)
      .maybeSingle();

    let purchaseId = already?.id as string | undefined;
    let isNewCharge = false;

    if (!purchaseId) {
      const chargeRow = (amount: number) => ({
        owner_id:        sub.owner_id,
        hall_id:         sub.hall_id,
        plan_slug:       sub.plan_slug,
        amount,
        duration_days:   Number(plan?.duration_days ?? 30),
        status:          "paid",
        paid_at:         p.payment_time ?? new Date().toISOString(),
        subscription_id: sub.id,
        cf_payment_ref:  ref,
        cycle:           p.cycle ?? null,
        raw_response:    p,
      });

      let { data: made, error: insErr } = await db
        .from("plan_purchases")
        .insert(chargeRow(chargedAmount))
        .select("id")
        .maybeSingle();

      // trg_guard_plan_purchase (migration 0040) refuses any plan_purchases row
      // whose amount is not TODAY's catalogue price. That guard was written for
      // one-off purchases, where the app itself chooses the price, and it is
      // right there. It cannot express "the amount this mandate was authorised
      // at", so after a price change it rejects the true figure.
      //
      // A paid month must never be dropped over bookkeeping, so we fall back to
      // the price the guard will accept — and say so loudly, because the stored
      // amount is then NOT what the owner was debited. The receipt below still
      // quotes the real charge either way. Widening the guard to accept a
      // subscription's snapshot needs a migration (see plan_purchases).
      if (insErr && insErr.code !== "23505" && chargedAmount !== cataloguePrice) {
        console.error(
          `[plan-subscriptions] could not record charge ${ref} at the amount actually debited ` +
          `(${chargedAmount}); retrying at the catalogue price (${cataloguePrice}):`,
          insErr.message,
        );
        ({ data: made, error: insErr } = await db
          .from("plan_purchases")
          .insert(chargeRow(cataloguePrice))
          .select("id")
          .maybeSingle());
      }

      if (insErr) {
        // 23505 = another caller recorded this same charge first. Fine.
        if (insErr.code !== "23505") {
          console.error("[plan-subscriptions] charge insert failed:", insErr.message);
          continue;
        }
        const { data: theirs } = await db
          .from("plan_purchases").select("id").eq("cf_payment_ref", ref).maybeSingle();
        purchaseId = theirs?.id;
      } else {
        purchaseId = made?.id;
        count += 1;
        isNewCharge = true;
      }
    }

    if (!purchaseId) continue;

    // Grant the month. Exactly-once by construction (migration 0043).
    const { data: full } = await db
      .from("plan_purchases")
      .select("id, hall_id, plan_slug, amount, duration_days, premium_listing_id")
      .eq("id", purchaseId)
      .maybeSingle();

    if (full) {
      const result = await activatePurchase(full);

      if (result.state === "unactivated") {
        unactivated = true;
        // Money taken, nothing delivered. Tell the only person who can fix it.
        await notifyPlanChargeUnactivated({
          purchaseId: full.id,
          hallId:     sub.hall_id,
          planSlug:   sub.plan_slug,
          // The debited amount, not the stored one: this alert exists so a
          // human can make the owner whole, and they need the figure that
          // actually left the owner's account.
          amount:     chargedAmount,
        });
      }

      // RECEIPT — only for a charge we recorded for the first time, never on a
      // redelivered webhook replaying an old one. An unannounced standing debit
      // is what people charge back.
      if (isNewCharge) {
        await notifySubscriptionCharged({
          chargeRef:  ref,
          hallId:     sub.hall_id,
          planLabel:  planLabelFor(sub.plan_slug),
          // What was really debited. Quoting the stored row would restate an
          // old renewal at the new price the moment the catalogue moved.
          amount:     chargedAmount,
          paidUntil:  result.endDate ?? null,
        });
      }
    }
  }

  return { count, unactivated };
}

/** Stops future billing. The months already paid for are NOT taken away. */
export async function cancelPlanSubscription(input: {
  subscriptionRowId: string;
  ownerProfileId: string;
}): Promise<{ ok: true; until: string | null } | { ok: false; error: string }> {
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  const { data: sub } = await db
    .from("plan_subscriptions")
    .select("id, cf_subscription_id, hall_id, plan_slug, status, hall_owners!owner_id(profile_id)")
    .eq("id", input.subscriptionRowId)
    .maybeSingle();

  if (!sub) return { ok: false, error: "Subscription not found." };
  if (sub.hall_owners?.profile_id !== input.ownerProfileId) {
    return { ok: false, error: "That subscription does not belong to you." };
  }
  if (sub.status === "cancelled") return { ok: false, error: "This subscription is already cancelled." };

  const res = await cancelCashfreeSubscription(sub.cf_subscription_id);
  if (!res.ok) return { ok: false, error: res.error };

  await db.from("plan_subscriptions")
    .update({
      status:       "cancelled",
      cancelled_at: new Date().toISOString(),
      raw_response: res.data,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", sub.id);

  // The boost the owner already paid for runs to the end of its window.
  const today = new Date().toISOString().slice(0, 10);
  const { data: listing } = await db
    .from("premium_listings")
    .select("end_date")
    .eq("hall_id", sub.hall_id)
    .eq("plan_slug", sub.plan_slug)
    .eq("is_active", true)
    .gte("end_date", today)
    .order("end_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { ok: true, until: listing?.end_date ?? null };
}
