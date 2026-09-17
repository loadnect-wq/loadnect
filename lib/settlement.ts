// ─────────────────────────────────────────────────────────────────────────────
// lib/settlement.ts — Cashfree Easy Split settlement engine (server-only).
//
// This is the TRUSTED BACKEND for the paise-integer ledger (migration 0018). It:
//   • computes the commission/owner split server-side from the DB (zero frontend
//     trust) using integer-paise math (lib/money.ts),
//   • records/settles the ledger rows (payment_transactions, commission_transactions,
//     settlement_transactions),
//   • provides the webhook audit/idempotency helpers (payment_webhook_events),
//     which app/api/webhooks/cashfree/route.ts writes on every verified event.
//
// THIS FILE DOES NOT MOVE VENDOR MONEY. It once carried a `submitSplitOrder`
// stub and a second `isEasySplitEnabled()` beside it, both unreachable: nothing
// ever imported them, and the live payout path is lib/owner-payout.ts calling
// lib/easy-split.ts. Two predicates of the same name had already drifted apart
// — this one was case-sensitive and also required isCashfreeConfigured(), the
// real one is neither — so whichever a future caller imported decided whether
// an owner got paid. Deleted rather than reconciled, because the safe number of
// definitions for "should we pay the owner automatically?" is one.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { commissionPaiseOn, splitFromParts, type CommissionSplit } from "@/lib/money";
import { STANDARD_COMMISSION_PERCENT } from "@/lib/commission";

// ── Webhook idempotency ─────────────────────────────────────────────────────────

export type RecordWebhookResult =
  | { ok: true; duplicate: false; id: string }
  | { ok: true; duplicate: true }        // already recorded → skip processing
  | { ok: false; error: string };

/**
 * Records a provider webhook event: the durable evidence of what the gateway
 * told us, when, and how it ended. Relies on the UNIQUE(provider, event_id)
 * constraint, so a re-delivered event returns `{ duplicate: true }`.
 *
 * DUPLICATE MEANS "SEEN BEFORE", NOT "ALREADY DONE" — the caller decides, and
 * the answer is not automatically "skip". This used to say the caller MUST
 * treat a duplicate as a no-op; that is only safe when the first delivery is
 * known to have succeeded, and it is not. The Cashfree receiver answers 503 on
 * an event it could not apply precisely so that Cashfree redelivers it, and
 * skipping THAT redelivery would strand a paid booking. Its apply paths are
 * idempotent, so it records the duplicate and re-applies. A caller whose work
 * is not idempotent must check processing_status before deciding.
 *
 * Callers are expected to keep the payload free of anything they would not want
 * a second copy of — the receiver strips the customer's contact details before
 * handing it over.
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

/**
 * Stamps how an already-recorded event ended. Matches on (provider, event_id),
 * so it is a silent no-op when the insert above never landed — the outcome is
 * bookkeeping, and losing it must never be worth failing a webhook over.
 */
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
  | { ok: true; split: CommissionSplit; ownerId: string | null; customerId: string; advancePaise: number; platformFeePaise: number }
  | { ok: false; error: string }
> {
  const db = getSupabaseAdminClient();
  // select("*") so the 0031 breakdown columns come along when present without
  // erroring on a pre-0031 database.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: booking, error } = await (db as any)
    .from("bookings")
    .select("*, halls(owner_id)")
    .eq("id", bookingId)
    .maybeSingle();

  if (error || !booking) return { ok: false, error: "Booking not found." };

  let advancePaise: number;
  let platformFeePaise: number;

  // THE COMMISSION IS NEVER RECOMPUTED FROM THE GROSS HERE. Its base is the
  // HALL PRICE while the gross being split is the ADVANCE, so re-applying the
  // rate to the advance would understate it fourfold at a 25% advance. The
  // amount actually charged is read from the booking's snapshot instead.
  const totalPaise = Math.round(Number(booking.total_amount) * 100);
  let commissionPaise: number;

  if (booking.advance_amount != null && Number(booking.advance_amount) > 0) {
    // New-model booking: the 0031 snapshot is authoritative. The platform fee
    // is a SEPARATE figure — it never enters the split gross, which must keep
    // reconciling commission + owner === advance exactly.
    advancePaise = Math.round(Number(booking.advance_amount) * 100);
    platformFeePaise = Math.round(Number(booking.platform_fee_amount ?? 0) * 100);
    commissionPaise = booking.commission_amount != null
      ? Math.round(Number(booking.commission_amount) * 100)
      // Only if the snapshot is missing: recompute against the HALL TOTAL, at
      // the booking's own stored rate, or the standard rate if none was stored
      // (never 0%, which would silently hand the whole commission to the owner).
      : commissionPaiseOn(totalPaise, Number(booking.commission_rate ?? STANDARD_COMMISSION_PERCENT));
  } else {
    // Legacy booking: advance = 25% of total; platform_fee stored the
    // commission actually charged. That AMOUNT is preserved verbatim —
    // historical financial records are never recomputed.
    advancePaise = Math.max(1, Math.round(totalPaise * 0.25));
    commissionPaise = Math.round(Number(booking.platform_fee) * 100);
    platformFeePaise = 0; // no customer fee existed under the legacy model
  }

  // Defensive: a corrupted snapshot must not mint a negative owner payout.
  commissionPaise = Math.min(Math.max(0, commissionPaise), advancePaise);
  // Reported against the HALL PRICE, the base the live model uses, so legacy
  // and current rows are read on the same footing.
  const ratePercent = totalPaise > 0
    ? Math.round((commissionPaise / totalPaise) * 10000) / 100
    : 0;

  const split = splitFromParts(advancePaise, commissionPaise, ratePercent);
  const hall = Array.isArray(booking.halls) ? booking.halls[0] : booking.halls;

  return {
    ok: true,
    split,
    ownerId: hall?.owner_id ?? null,
    customerId: booking.customer_id,
    advancePaise,
    platformFeePaise,
  };
}

