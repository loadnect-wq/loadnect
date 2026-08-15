// ─────────────────────────────────────────────────────────────────────────────
// lib/settlement.ts — Cashfree Easy Split settlement engine (server-only).
//
// This is the TRUSTED BACKEND for the paise-integer ledger (migration 0018). It:
//   • computes the commission/owner split server-side from the DB (zero frontend
//     trust) using integer-paise math (lib/money.ts),
//   • records/settles the ledger rows (payment_transactions, commission_transactions,
//     settlement_transactions),
//   • provides the webhook idempotency helper (payment_webhook_events).
//
// LIVE Cashfree Easy Split ORDER + SETTLEMENT calls are FEATURE-FLAGGED. Until
// `CASHFREE_EASY_SPLIT_ENABLED=true` AND vendor credentials exist, `submitSplitOrder`
// returns `{ enabled: false }` and the ledger records the intended split without
// dispatching a live vendor split. This keeps money code build-verifiable and
// prevents shipping an unverifiable live split. Search for "TODO(easy-split)".
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isCashfreeConfigured } from "@/lib/cashfree";
import { computeCommissionSplit, type CommissionSplit } from "@/lib/money";

/** True only when Easy Split is explicitly enabled AND Cashfree is configured.
 *  Never throws — safe as a pre-flight guard. */
export function isEasySplitEnabled(): boolean {
  return (
    process.env.CASHFREE_EASY_SPLIT_ENABLED === "true" &&
    isCashfreeConfigured()
  );
}

// ── Webhook idempotency ─────────────────────────────────────────────────────────

export type RecordWebhookResult =
  | { ok: true; duplicate: false; id: string }
  | { ok: true; duplicate: true }        // already recorded → skip processing
  | { ok: false; error: string };

/**
 * Records a provider webhook event for idempotency. Relies on the
 * UNIQUE(provider, event_id) constraint: a re-delivered event returns
 * `{ duplicate: true }` and MUST be treated as a no-op by the caller.
 */
export async function recordWebhookEvent(input: {
  provider?: string;
  eventId: string;
  eventType?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
  signatureVerified: boolean;
}): Promise<RecordWebhookResult> {
  const db = getSupabaseAdminClient();
  const provider = input.provider ?? "cashfree";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("payment_webhook_events")
    .insert({
      provider,
      event_id:           input.eventId,
      event_type:         input.eventType ?? null,
      payload:            input.payload ?? null,
      signature_verified: input.signatureVerified,
      processing_status:  "RECEIVED",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { ok: true, duplicate: true };
    return { ok: false, error: error.message ?? "Failed to record webhook event" };
  }
  return { ok: true, duplicate: false, id: data.id };
}

export async function markWebhookProcessed(
  eventId: string,
  status: "PROCESSED" | "FAILED" | "IGNORED",
  note?: string,
  provider = "cashfree",
): Promise<void> {
  const db = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)
    .from("payment_webhook_events")
    .update({ processing_status: status, error_note: note ?? null, processed_at: new Date().toISOString() })
    .eq("provider", provider)
    .eq("event_id", eventId);
}

// ── Split computation (server-authoritative, paise) ─────────────────────────────

/**
 * Resolves the authoritative split for a booking's advance from the DB — NEVER
 * from the client. Reads the booking's stored amounts + the platform commission
 * rate and computes integer-paise commission/owner shares.
 */
export async function resolveSplitForBooking(bookingId: string): Promise<
  | { ok: true; split: CommissionSplit; ownerId: string | null; customerId: string; advancePaise: number }
  | { ok: false; error: string }
> {
  const db = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: booking, error } = await (db as any)
    .from("bookings")
    .select("id, customer_id, total_amount, platform_fee, base_amount, halls(owner_id)")
    .eq("id", bookingId)
    .maybeSingle();

  if (error || !booking) return { ok: false, error: "Booking not found." };

  // Advance = 25% of total (mirrors the existing rupee checkout), converted to
  // integer paise. All downstream math is integer-only.
  const totalPaise = Math.round(Number(booking.total_amount) * 100);
  const advancePaise = Math.max(1, Math.round(totalPaise * 0.25));

  // Commission rate snapshot: derive from the booking's stored platform_fee vs
  // base_amount so historical rate changes don't retroactively alter the split.
  const base = Number(booking.base_amount);
  const fee = Number(booking.platform_fee);
  const ratePercent = base > 0 ? Math.round((fee / base) * 10000) / 100 : 0;

  const split = computeCommissionSplit(advancePaise, ratePercent);
  const hall = Array.isArray(booking.halls) ? booking.halls[0] : booking.halls;

  return {
    ok: true,
    split,
    ownerId: hall?.owner_id ?? null,
    customerId: booking.customer_id,
    advancePaise,
  };
}

// ── Live Easy Split order (feature-flagged stub) ────────────────────────────────

export type SplitOrderResult =
  | { ok: true; enabled: true; splitGroupId: string }
  | { ok: true; enabled: false }        // flag off → ledger records intent only
  | { ok: false; error: string };

/**
 * Dispatches a live Cashfree Easy Split vendor split for a payment transaction.
 *
 * While `isEasySplitEnabled()` is false (default), this is a NO-OP that returns
 * `{ enabled: false }` — the caller records the intended split in the ledger but
 * does not move vendor money. This is deliberate: a live split cannot be
 * verified without Cashfree Easy Split enabled + a verified `cashfree_vendor_id`.
 */
export async function submitSplitOrder(params: {
  ownerCashfreeVendorId: string | null;
  ownerAmountPaise: number;
}): Promise<SplitOrderResult> {
  if (!isEasySplitEnabled()) {
    return { ok: true, enabled: false };
  }
  if (!params.ownerCashfreeVendorId) {
    return { ok: false, error: "Owner has no verified Cashfree vendor id (KYC incomplete)." };
  }

  // TODO(easy-split): call the Cashfree Easy Split order/split API here with the
  // vendor id + owner share (paise → rupees for the API). Persist the returned
  // split group id on payment_transactions.cashfree_split_group_id and advance
  // split_status → PROCESSED. Until credentials + sandbox testing exist, we do
  // NOT fabricate a live split.
  return { ok: false, error: "Easy Split live dispatch is not yet wired (awaiting vendor credentials)." };
}
