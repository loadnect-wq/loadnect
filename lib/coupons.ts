// ─────────────────────────────────────────────────────────────────────────────
// lib/coupons.ts — resolving a customer-typed promo code. SERVER-ONLY.
//
// WHAT A COUPON DOES: waives the flat ₹200 PLATFORM FEE. Nothing else. The
// commission is 2.5% of the full hall price, retained out of the advance, and
// is the venue's side of the split — a coupon never touches it, so Hallnect
// absorbs 100% of the discount and the owner is paid exactly the same.
//
// THE CLIENT SENDS A STRING, NEVER A NUMBER. This module turns an opaque code
// into a server-decided fee. There is deliberately no path from request body to
// an amount: `platformFeeRupees` is produced here, not received.
//
// ONE REJECTION MESSAGE FOR EVERY FAILURE. "Expired", "limit reached" and
// "unavailable" each confirm that a guessed code is REAL, which turns the
// preview action into an existence oracle for anyone willing to iterate. The
// real reason goes to the server log; the customer gets one flat string.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * MUST stay identical to the coupons_code_format CHECK in migration 0045 and
 * to couponCodeSchema in lib/validation/schemas.ts.
 *
 * The 8-character floor is a security bound, not a style choice: resolveCoupon
 * is reachable once per request with no rate limiter in front of it, and a
 * 3-character code over a 37-symbol alphabet is only ~46k candidates.
 */
export const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{7,23}$/;

/** Statuses that mean money actually moved — see resolveCoupon's cap comment. */
const PAID_STATUSES = [
  "payment_success",
  "booking_requested",
  "owner_confirmed",
  "completed",
] as const;

const REJECT = "That coupon code is not valid.";

export type ResolvedCoupon = {
  id: string;
  /** Canonical UPPERCASE, as stored. */
  code: string;
  kind: "zero_platform_fee";
  /** The fee this booking should be charged, in rupees. */
  platformFeeRupees: number;
};

export type CouponResolution =
  | { ok: true; coupon: ResolvedCoupon }
  | { ok: false; error: string };

/**
 * Canonicalises client input. Must agree with the coupons_code_canonical CHECK
 * (`code = upper(code)`), or a code that passes here fails at the database.
 *
 * NFKC first so full-width and other compatibility forms fold to ASCII before
 * the pattern test, rather than being rejected as "invalid" for a customer who
 * pasted from a styled message.
 */
export function normalizeCouponCode(raw: string): string {
  return String(raw ?? "")
    .slice(0, 64)
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toUpperCase();
}

/**
 * Turns a typed code into the fee it earns, or a flat refusal.
 *
 * Uses the service-role client on purpose: `coupons` has no anon/authenticated
 * SELECT policy and the default grants are revoked, precisely so the live code
 * list cannot be enumerated over PostgREST. Validation therefore has to happen
 * on the server.
 */
export async function resolveCoupon(raw: string): Promise<CouponResolution> {
  const code = normalizeCouponCode(raw);
  if (!code || !COUPON_CODE_PATTERN.test(code)) return { ok: false, error: REJECT };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;

  const { data, error } = await db
    .from("coupons")
    .select("id, code, kind, is_active, expires_at, max_redemptions")
    .eq("code", code)
    .maybeSingle();

  if (error) {
    // Includes the pre-0045 case (relation missing). Behave as though no coupon
    // exists — never as though one applied.
    console.error("[resolveCoupon]", error.code, error.message);
    return { ok: false, error: REJECT };
  }
  if (!data || !data.is_active) return { ok: false, error: REJECT };
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: REJECT };
  }

  if (data.max_redemptions != null) {
    // PAID statuses only, matching the database trigger. Counting live pending
    // holds would let one signed-in user open N free holds and starve a capped
    // coupon for everyone for 20 minutes, repeatably — a pending booking costs
    // nothing and does not even conflict with other holds.
    //
    // FAIL CLOSED: a cap that cannot be verified is not satisfied.
    const { count, error: countErr } = await db
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("coupon_id", data.id)
      .in("status", PAID_STATUSES as unknown as string[]);

    if (countErr || count == null) {
      console.error("[resolveCoupon] usage count failed", countErr?.message);
      return { ok: false, error: REJECT };
    }
    if (count >= Number(data.max_redemptions)) return { ok: false, error: REJECT };
  }

  return {
    ok: true,
    coupon: {
      id: data.id,
      code: data.code,
      kind: "zero_platform_fee",
      // The ONLY place this number is decided. Not received, not negotiated.
      platformFeeRupees: 0,
    },
  };
}
