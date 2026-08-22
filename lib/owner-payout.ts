// ─────────────────────────────────────────────────────────────────────────────
// lib/owner-payout.ts — pays the venue owner the moment they ACCEPT a booking.
// SERVER-ONLY.
//
//   advance the customer paid
//     − Hallnect's commission (a percentage OF THAT ADVANCE, currently 2%)
//     = the owner's share, settled to their Cashfree vendor balance
//
// For a ₹29,400 booking with a 25% advance: advance ₹7,350 − commission ₹147
// = ₹7,203 to the owner now, ₹22,050 collected at the venue → ₹29,253 net.
// Hallnect earns the commission ONCE, retained from the advance, so the owner
// is never separately billed for it.
//
// NEVER FAILS THE ACCEPTANCE. A booking the owner accepted must stay accepted
// even if payout plumbing is missing, mid-KYC, or the gateway is down. Every
// outcome is recorded on payments.split_status so an admin can see and retry
// it, and the customer's booking is unaffected.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEasySplitEnabled, splitOrderToVendor } from "@/lib/easy-split";

export type ShareResult =
  | { ok: true; commission: number; ownerAmount: number }
  | { ok: false; reason: string };

/**
 * Splits the advance into Hallnect's platform fee and the owner's share.
 *
 *   Hallnect keeps  = the commission charged on the advance
 *   Owner receives  = advance − commission
 *
 * Kept pure so the money arithmetic is unit-testable without a database.
 *
 * REFUSES rather than guessing when the commission is unknown. The previous
 * version defaulted a missing commission to 0, which paid the owner the ENTIRE
 * advance and silently cost Hallnect its fee — a wrong payout is far worse than
 * a deferred one, because a settled vendor share cannot be clawed back.
 */
export function computeOwnerShare(input: {
  advance: number;
  /** From the commissions row — the authoritative figure. */
  commissionAmount: number | null | undefined;
  /** Fallback: the rate snapshot stored on the booking at creation. */
  bookingPlatformFee: number | null | undefined;
}): ShareResult {
  const advance = Number(input.advance);
  if (!Number.isFinite(advance) || advance <= 0) {
    return { ok: false, reason: "No advance was captured for this booking" };
  }

  const fromCommission = Number(input.commissionAmount);
  const fromBooking = Number(input.bookingPlatformFee);
  const commission = Number.isFinite(fromCommission) && input.commissionAmount != null
    ? fromCommission
    : Number.isFinite(fromBooking) && input.bookingPlatformFee != null
      ? fromBooking
      : NaN;

  if (!Number.isFinite(commission) || commission < 0) {
    return { ok: false, reason: "Commission for this booking is unknown — refusing to pay out" };
  }
  if (commission > advance) {
    // Would mean paying the owner a negative amount; hold for a human.
    return { ok: false, reason: "Commission exceeds the advance captured — needs review" };
  }

  const ownerAmount = Math.round((advance - commission) * 100) / 100;
  if (ownerAmount <= 0) {
    return { ok: false, reason: "Nothing left to pay out after the commission" };
  }

  return { ok: true, commission: Math.round(commission * 100) / 100, ownerAmount };
}

export type PayoutOutcome =
  | { state: "paid"; ownerAmount: number }
  | { state: "skipped"; reason: string }
  | { state: "failed"; reason: string };

/**
 * Fires the owner payout for an accepted booking. Idempotent: the split is
 * claimed with a status-guarded update, so a double-tapped Accept or a retry
 * can never split the same order twice (Cashfree's disable_split closes it at
 * the gateway too).
 */
export async function payOwnerOnAcceptance(bookingId: string): Promise<PayoutOutcome> {
  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;

    // 1. The verified payment that funded this booking, plus the owner's vendor.
    const { data: payment } = await db
      .from("payments")
      .select("id, amount, status, cashfree_order_id, split_status, booking_id")
      .eq("booking_id", bookingId)
      .eq("status", "payment_success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!payment) {
      // Manual-mode bookings have no gateway payment — nothing to split.
      return { state: "skipped", reason: "No gateway payment for this booking" };
    }
    if (payment.split_status === "done") {
      return { state: "skipped", reason: "Already paid out" };
    }

    // 2. Commission owed on this booking — authoritative, from the DB.
    const { data: commission } = await db
      .from("commissions")
      .select("commission_amount, hall_owner_id, hall_owners!hall_owner_id(cashfree_vendor_id)")
      .eq("booking_id", bookingId)
      .maybeSingle();

    // Fallback source for the fee: the rate snapshot written onto the booking
    // when it was created. Used only if the commissions row is missing.
    const { data: bookingRow } = await db
      .from("bookings")
      .select("platform_fee")
      .eq("id", bookingId)
      .maybeSingle();

    const advance = Number(payment.amount ?? 0);
    const share = computeOwnerShare({
      advance,
      commissionAmount: commission?.commission_amount ?? null,
      bookingPlatformFee: bookingRow?.platform_fee ?? null,
    });

    const vendorId: string | null = commission?.hall_owners?.cashfree_vendor_id ?? null;
    const ownerAmount = share.ok ? share.ownerAmount : 0;

    // 3. Record WHY a payout cannot happen, rather than failing silently.
    const note = async (status: string, error: string | null) => {
      await db.from("payments")
        .update({ split_status: status, split_error: error, split_owner_amount: ownerAmount })
        .eq("id", payment.id)
        .neq("split_status", "done");
    };

    if (!isEasySplitEnabled()) {
      await note("not_applicable", "Easy Split is not enabled");
      return { state: "skipped", reason: "Easy Split is not enabled" };
    }
    if (!vendorId) {
      await note("failed", "Owner has not completed Cashfree vendor onboarding");
      return { state: "failed", reason: "Owner has not completed payout onboarding" };
    }
    if (!share.ok) {
      // Never fall back to paying out the full advance — that would hand the
      // owner Hallnect's platform fee, and a settled split cannot be reversed.
      await note("failed", share.reason);
      return { state: "failed", reason: share.reason };
    }

    // 4. CLAIM the split before calling the gateway. A concurrent Accept sees
    //    'pending' and matches 0 rows, so only one caller can dispatch.
    const { count: claimed } = await db
      .from("payments")
      .update({ split_status: "pending", split_owner_amount: ownerAmount, split_vendor_id: vendorId }, { count: "exact" })
      .eq("id", payment.id)
      .in("split_status", ["none", "failed", "not_applicable"]);

    if ((claimed ?? 0) === 0) {
      return { state: "skipped", reason: "A payout is already in progress" };
    }

    // 5. Dispatch.
    const result = await splitOrderToVendor({
      cashfreeOrderId: payment.cashfree_order_id,
      vendorId,
      amountToOwner: ownerAmount,
    });

    if (!result.ok) {
      await note("failed", result.error);
      return { state: "failed", reason: result.error };
    }

    await db.from("payments")
      .update({ split_status: "done", split_at: new Date().toISOString(), split_error: null })
      .eq("id", payment.id);

    // The commission is now genuinely collected — it never left Hallnect's
    // share of the advance, so the owner owes nothing separately.
    await db.from("commissions")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        payment_method: "easy_split",
        payment_reference: payment.cashfree_order_id,
        admin_note: "Collected automatically from the customer advance at payout",
      })
      .eq("booking_id", bookingId)
      .neq("status", "paid");

    return { state: "paid", ownerAmount: result.ownerAmount };
  } catch (e) {
    // Never propagate — the acceptance itself must stand.
    console.error("[owner-payout] failed:", e instanceof Error ? e.message : e);
    return { state: "failed", reason: "Unexpected payout error" };
  }
}
