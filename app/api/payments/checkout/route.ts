// ─────────────────────────────────────────────────────────────────────────────
// app/api/payments/checkout/route.ts
// POST — server-authoritative checkout entry point for the paise settlement
// engine. Creates/returns the authoritative payment_transactions ledger row for
// a booking with the commission/owner split computed SERVER-SIDE in integer
// paise. Zero frontend trust: the ONLY accepted input is `bookingId`; every
// amount, the vendor/owner id, and the commission rate are resolved from the DB.
//
// Feature-flagged: while Easy Split is disabled (default), this records the
// intended split in the ledger but does not dispatch a live vendor split. The
// live Cashfree gateway session continues to be created by the existing,
// verified server-action flow (app/book/[slug]/actions.ts → createPaymentSession)
// until Easy Split is wired. See docs/CASHFREE_EASY_SPLIT_ENGINE.md.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveSplitForBooking, submitSplitOrder, isEasySplitEnabled } from "@/lib/settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  // ── Auth — identity strictly from the session, never the body ───────────────
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // ── Input — bookingId only ──────────────────────────────────────────────────
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  const bookingId = (body as { bookingId?: string })?.bookingId ?? "";
  if (!UUID_RE.test(bookingId)) return NextResponse.json({ error: "Invalid bookingId" }, { status: 400 });

  // ── Server-authoritative split (paise) ──────────────────────────────────────
  const resolved = await resolveSplitForBooking(bookingId);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 404 });

  // IDOR guard: the booking must belong to the caller.
  if (resolved.customerId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { split, ownerId } = resolved;
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  // Idempotency: reuse an existing pending transaction for this booking+customer.
  const { data: existing } = await db
    .from("payment_transactions")
    .select("id, payment_status")
    .eq("booking_id", bookingId)
    .eq("customer_id", user.id)
    .in("payment_status", ["PENDING"])
    .maybeSingle();

  let transactionId: string;
  if (existing?.id) {
    transactionId = existing.id;
    await db.from("payment_transactions").update({
      gross_amount_paise:      split.grossPaise,
      commission_amount_paise: split.commissionPaise,
      owner_amount_paise:      split.ownerPaise,
      commission_rate:         split.ratePercent,
    }).eq("id", existing.id);
  } else {
    const { data: created, error: insErr } = await db
      .from("payment_transactions")
      .insert({
        booking_id:              bookingId,
        customer_id:             user.id,
        owner_id:                ownerId,
        gross_amount_paise:      split.grossPaise,
        commission_amount_paise: split.commissionPaise,
        owner_amount_paise:      split.ownerPaise,
        commission_rate:         split.ratePercent,
        payment_status:          "PENDING",
        split_status:            isEasySplitEnabled() ? "PENDING" : "NOT_APPLICABLE",
      })
      .select("id")
      .single();
    if (insErr) {
      console.error("[payments/checkout] ledger insert failed", insErr.message);
      return NextResponse.json({ error: "Could not start checkout." }, { status: 500 });
    }
    transactionId = created.id;
  }

  // Owner vendor id (for a live split when enabled).
  let ownerVendorId: string | null = null;
  if (ownerId) {
    const { data: ownerRow } = await db
      .from("hall_owners").select("cashfree_vendor_id").eq("id", ownerId).maybeSingle();
    ownerVendorId = ownerRow?.cashfree_vendor_id ?? null;
  }

  // Dispatch the live split only when the flag is on (stub otherwise).
  const splitResult = await submitSplitOrder({
    ownerCashfreeVendorId: ownerVendorId,
    ownerAmountPaise: split.ownerPaise,
  });

  return NextResponse.json({
    ok: true,
    transactionId,
    easySplitEnabled: isEasySplitEnabled(),
    split: {
      grossPaise:      split.grossPaise,
      commissionPaise: split.commissionPaise,
      ownerPaise:      split.ownerPaise,
      ratePercent:     split.ratePercent,
    },
    liveSplit: splitResult,
    // Until Easy Split is wired, the browser completes payment via the existing
    // verified server-action flow (createPaymentSession). This route is the
    // authoritative ledger + split source of truth.
    note: isEasySplitEnabled()
      ? "Ledger recorded; live split dispatched."
      : "Ledger recorded. Easy Split is disabled — complete payment via the standard checkout; no live vendor split dispatched.",
  });
}
