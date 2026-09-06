// ─────────────────────────────────────────────────────────────────────────────
// lib/refunds.ts — records what a cancelled booking owes the customer back.
// SERVER-ONLY.
//
// The money components come from ONE calculation (lib/booking-payment.ts):
//   • the ADVANCE is refundable per the published cancellation schedule below,
//   • the flat ₹200 PLATFORM FEE is NOT refundable when the CUSTOMER cancels,
//     and IS refunded in full when the venue or Hallnect causes the
//     cancellation — exactly what /refund-policy and /cancellation-policy
//     promise. Nothing here invents a policy; the schedule mirrors the
//     published table one-for-one and lives in one editable place.
//
// WHAT THIS DOES AND DOES NOT DO: it computes what is OWED and records it on
// the payment row as refund_state='owed'. It does not move money. Sending it is
// issueRefund() in app/admin/actions.ts, which an admin triggers from the
// dashboard and which calls Cashfree for real.
//
// The distinction is the point. This function used to set status='refunded' the
// moment it ran, while no refund integration existed at all — so a customer who
// had received nothing was shown as refunded everywhere.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { calculateRefund } from "@/lib/booking-payment";
import { daysBetweenInclusive, todayInBusinessTz } from "@/lib/dates";
import { toPaise, PAISE_PER_RUPEE } from "@/lib/money";

/**
 * The published customer-cancellation schedule (see /refund-policy). Percent of
 * the ADVANCE returned, by how far ahead of the event the cancellation lands.
 * Editing this table is how the policy changes — no caller hard-codes a number.
 */
// MOVED to lib/refund-schedule.ts so the cancel dialog — a client component —
// can read it and show the customer what they get back before they confirm,
// which /cancellation-policy promises in writing. Re-exported here so every
// existing server import keeps working and there is still ONE table.
export { CUSTOMER_REFUND_SCHEDULE, customerRefundPercent } from "@/lib/refund-schedule";
// A re-export does not bind the name locally, and this module calls it.
import { customerRefundPercent } from "@/lib/refund-schedule";

/**
 * The commission Hallnect KEEPS when a booking is cancelled, in rupees.
 *
 * The commission is retained out of the advance, so it is only earned on the
 * part of the advance that stays. Reverse it in the same proportion the advance
 * is refunded in: 100% back → nothing kept; 0% back (a customer cancelling
 * inside 7 days) → the whole commission stays earned, because Hallnect still
 * holds every rupee of that advance.
 *
 * Integer paise, and FLOORED like every other commission calculation
 * (lib/money.ts) — the fraction of a paisa goes to the part being given back,
 * never to the platform.
 */
export function retainedCommission(
  commissionRupees: number,
  refundPercentOfAdvance: number,
): number {
  const charged = Number(commissionRupees);
  if (!Number.isFinite(charged) || charged <= 0) return 0;

  const pct = Number(refundPercentOfAdvance);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new RangeError(`retainedCommission: refund percent ${pct} out of [0,100]`);
  }

  const keptPaise = Math.floor((toPaise(charged) * Math.round((100 - pct) * 100)) / 10_000);
  return keptPaise / PAISE_PER_RUPEE;
}

/** Who caused the cancellation — this decides the platform fee's fate. */
export type CancellationInitiator =
  | "customer"   // schedule applies; ₹200 fee retained
  | "owner"      // venue declined/cancelled: full refund INCLUDING the fee
  | "platform";  // our fault (slot race, payment issue): full refund incl. fee

export type RecordedRefund = {
  refundAmount: number;
  platformFeeRetained: number;
  advanceWithheld: number;
  percentApplied: number;
};

/**
 * Computes and records the refund owed for a cancelled booking. Idempotent: a
 * payment that already carries a refund_amount is left exactly as it is, so a
 * repeated cancellation or a webhook retry can never inflate a refund.
 *
 * Returns null when there is nothing to refund (no successful payment).
 * NEVER throws — a cancellation must stand even if refund bookkeeping fails.
 */
export async function recordBookingRefund(
  bookingId: string,
  initiator: CancellationInitiator,
): Promise<RecordedRefund | null> {
  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;

    const { data: payment } = await db
      .from("payments")
      .select("*")
      .eq("booking_id", bookingId)
      .eq("status", "payment_success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Nothing captured → nothing to refund (a pending booking simply lapses).
    if (!payment) return null;

    // Already recorded — do not recompute or re-announce.
    if (payment.refund_amount != null && Number(payment.refund_amount) > 0) return null;

    const { data: booking } = await db
      .from("bookings").select("*").eq("id", bookingId).maybeSingle();
    if (!booking) return null;

    // Components: prefer the stored breakdown; legacy payments carried the
    // advance alone and no fee.
    const advance = payment.advance_amount != null && Number.isFinite(Number(payment.advance_amount))
      ? Number(payment.advance_amount)
      : Number(payment.amount ?? 0);
    const fee = payment.platform_fee_amount != null && Number.isFinite(Number(payment.platform_fee_amount))
      ? Number(payment.platform_fee_amount)
      : 0;
    // GST collected on that fee (0049). Absent on payments taken before GST
    // registration, where it is genuinely zero rather than unknown.
    const feeGst = payment.platform_fee_gst != null && Number.isFinite(Number(payment.platform_fee_gst))
      ? Number(payment.platform_fee_gst)
      : 0;

    // Days until the event decides the customer tier. Owner/platform-caused
    // cancellations return everything regardless of timing.
    const eventDate: string = booking.event_date;
    const daysUntilEvent = Math.max(0, daysBetweenInclusive(todayInBusinessTz(), eventDate) - 1);
    const percent = initiator === "customer" ? customerRefundPercent(daysUntilEvent) : 100;

    const breakdown = calculateRefund({
      advanceAmount: advance,
      platformFee: fee,
      platformFeeGst: feeGst,
      refundPercentOfAdvance: percent,
      refundPlatformFee: initiator !== "customer",
    });

    // `fee` is a MONEY value, so it is tested against 0 explicitly. The old
    // `fee || PLATFORM_FEE_RUPEES` printed "₹200 retained" whenever the fee was
    // zero — which is now every coupon booking, and was already wrong for any
    // legacy payment that fell back to 0 at :105. This note is persisted to
    // payments.payment_message: it is the durable record an admin quotes back
    // to a customer in a dispute, so it must not claim money that was never
    // taken.
    const feeNote = fee > 0
      ? ` ₹${fee} platform fee retained per policy.`
      : " No platform fee was charged on this booking.";
    const note =
      initiator === "customer"
        ? `Customer cancellation ${daysUntilEvent} day(s) before the event — ${percent}% of the advance refundable;${feeNote}`
        : `${initiator === "owner" ? "Venue" : "Platform"}-initiated cancellation — full refund${fee > 0 ? " including the platform fee" : ""}.`;

    const update: Record<string, unknown> = {
      refund_amount: breakdown.refundableAmount,
      payment_message: note,
      // 'owed', NOT 'refunded'. This function records what the customer is due;
      // the money is sent later by issueRefund(). Marking the payment refunded
      // here told every dashboard, receipt and message that a customer had been
      // paid back when nothing had left the account.
      // refund_owed_at starts the clock the published SLA is measured against
      // (5–7 business days, /refund-policy §8). Without it the overdue sweep has
      // to age rows by updated_at, which is only a proxy — any later touch to
      // the row resets it and the refund looks younger than it is, which is the
      // wrong direction for a promise. Stamped in the same write that sets
      // 'owed' so the two can never disagree.
      ...(breakdown.refundableAmount > 0
        ? { refund_state: "owed", refund_owed_at: new Date().toISOString() }
        : {}),
    };

    // THE COMMISSION IS EARNED ON THE MONEY HALLNECT ACTUALLY KEEPS — NO MORE,
    // AND NO LESS.
    //
    // createCommission writes status 'collected' the moment payment lands —
    // before the venue has even accepted. Nothing ever wrote it back, so a
    // cancelled, rejected or refunded booking kept counting toward "Net
    // Hallnect revenue" permanently, and the owner's commissions page kept
    // showing a green "Retained from advance" for a booking that never
    // happened. The 'refunded' badge on that page was dead code with nothing
    // to trigger it.
    //
    // The correction then over-corrected: it marked the row 'refunded'
    // UNCONDITIONALLY, ungated on how much actually went back. The schedule
    // above refunds 100 / 75 / 50 / 0 percent of the advance, so a customer
    // cancelling inside 7 days gets nothing back — Hallnect keeps the entire
    // advance, commission and all — and the ledger recorded zero earnings on
    // it. Every partial cancellation understated revenue the same way.
    //
    // So the reversal follows the refund: keep the commission earned on the
    // portion of the advance that was RETAINED, reverse the rest. 100% back
    // (every owner- and platform-caused cancellation, and an early customer
    // one) still reverses in full and still lands on 'refunded', which is what
    // every revenue query filters on. A partial keeps the row EARNED at the
    // reduced figure, so it goes on counting for exactly what it is worth.
    //
    // owner_payout_amount moves with it. It was written as "hall price −
    // commission", i.e. what the venue collects across the advance and the
    // balance on the day — and there is no day any more. What the venue is
    // actually left holding is its share of the retained advance, and leaving
    // the old figure on an EARNED row would have the admin dashboard counting
    // the full price of a booking that never happened.
    //
    // Best-effort and deliberately BEFORE the payment write is checked: a
    // ledger correction must never be the reason a customer's refund fails to
    // be recorded.
    try {
      // select("*") for the same reason the reads above use it: the 0017
      // columns are absent on an older database rather than an error.
      const { data: commission } = await db
        .from("commissions").select("*").eq("booking_id", bookingId).maybeSingle();

      // Applied ONCE. The reversal scales the stored figure, so re-running it
      // on an already-reduced row would shrink the commission again — and this
      // function IS re-enterable on a 0%-refund booking, where refund_amount
      // is 0 and the idempotency check at the top does not fire.
      const alreadyReversed =
        commission != null &&
        (commission.status === "refunded" ||
          ["adjusted", "reversed"].includes(String(commission.settlement_adjustment_status ?? "")));

      if (commission && !alreadyReversed) {
        const charged = Number(commission.commission_amount);
        const commissionPaise = Number.isFinite(charged) && charged > 0 ? toPaise(charged) : 0;

        const kept = retainedCommission(charged, percent);
        const keptPaise = toPaise(kept);

        // WHO OWNS A FORFEITED ADVANCE: HALLNECT.
        //
        // This used to record owner_payout_amount = advanceWithheld − commission,
        // i.e. it said the venue was owed the non-commission part of an advance
        // the customer did not get back. Nothing ever paid it:
        // payOwnerOnAcceptance only pays owner_confirmed or completed bookings,
        // and this booking is cancelled. So the figure sat on the ledger owed to
        // someone who would never receive it, inflating every "owed to owners"
        // total, while the money itself sat in the Cashfree balance attributed
        // to nobody.
        //
        // The published policy now says plainly that Hallnect retains it (see
        // /cancellation-policy §3 and /refund-policy §3), so the ledger says the
        // same thing: the owner is owed NOTHING out of a customer cancellation.
        //
        // This only ever bites on a CUSTOMER cancellation. Owner- and
        // platform-initiated ones refund 100%, so advanceWithheld is zero and
        // there is nothing to attribute either way.
        const withheldPaise = toPaise(breakdown.advanceWithheld);
        const ownerKeptPaise = 0;
        const hallnectRetainedPaise = Math.max(0, withheldPaise - keptPaise);

        const movement =
          keptPaise === 0                ? `Commission ₹${charged} reversed in full.`
          : keptPaise === commissionPaise ? `Commission ₹${charged} retained in full.`
          :                                 `Commission ₹${charged} reduced to ₹${kept}.`;

        // The retained remainder is stated in words rather than left implied.
        // commission_amount is the COMMISSION and must not be inflated to carry
        // it — an admin reading this row has to be able to tell the two apart.
        const retention =
          hallnectRetainedPaise > 0
            ? ` Hallnect retains ₹${hallnectRetainedPaise / PAISE_PER_RUPEE} of the withheld advance beyond commission; the venue is owed nothing on this booking.`
            : "";

        const reversal: Record<string, unknown> = {
          commission_amount:   kept,
          owner_payout_amount: ownerKeptPaise / PAISE_PER_RUPEE,
          settlement_adjustment_status: keptPaise > 0 ? "adjusted" : "reversed",
          // The original figure survives here, and in booking_amount ×
          // commission_rate, so a reduced row can always be explained.
          admin_note:
            `Booking cancelled (${initiator}) — ${percent}% of the advance refunded. ${movement}${retention}`,
          // Only a FULL reversal is 'refunded'; a partial row is still earned.
          ...(keptPaise > 0 ? {} : { status: "refunded" }),
        };

        let { error: commErr } = await db
          .from("commissions").update(reversal).eq("id", commission.id).neq("status", "refunded");

        if (commErr && (commErr.code === "42703" || commErr.code === "PGRST204")) {
          // Pre-0017 database: no admin_note / settlement_adjustment_status.
          const { settlement_adjustment_status: _s, admin_note: _n, ...legacy } = reversal;
          void _s; void _n;
          ({ error: commErr } = await db
            .from("commissions").update(legacy).eq("id", commission.id).neq("status", "refunded"));
        }

        if (commErr) {
          console.error("[recordBookingRefund] commission reversal failed:", commErr.message);
        }
      }
    } catch (e) {
      console.error("[recordBookingRefund] commission reversal failed:",
        e instanceof Error ? e.message : e);
    }

    let { error } = await db
      .from("payments").update(update).eq("id", payment.id).is("refund_amount", null);

    // Pre-0053 database: refund_owed_at does not exist. Drop ONLY that and
    // retry — this rung sits ahead of the pre-0031 one because that one drops
    // refund_amount, and losing the figure the customer is owed to work around
    // a missing SLA timestamp trades the important column for the cosmetic one.
    // The refund is still recorded; only its clock is unset, and the overdue
    // sweep falls back to updated_at for exactly these rows.
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      const { refund_owed_at: _o, ...withoutOwedAt } = update;
      void _o;
      console.warn("[refunds] payments.refund_owed_at missing — apply migration 0053");
      ({ error } = await db
        .from("payments").update(withoutOwedAt).eq("id", payment.id).is("refund_amount", null));
    }

    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      // Pre-0031 database — record what we can.
      const { refund_amount: _r, refund_owed_at: _o2, ...legacy } = update;
      void _r; void _o2;
      ({ error } = await db.from("payments").update(legacy).eq("id", payment.id));
    }
    if (error) {
      console.error("[refunds] could not record refund:", error.message);
      return null;
    }

    return {
      refundAmount: breakdown.refundableAmount,
      platformFeeRetained: breakdown.nonRefundablePlatformFee,
      advanceWithheld: breakdown.advanceWithheld,
      percentApplied: percent,
    };
  } catch (e) {
    console.error("[refunds] failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
