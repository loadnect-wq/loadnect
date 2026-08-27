// ─────────────────────────────────────────────────────────────────────────────
// lib/platform-settings.ts — global commission % helper.
//
// Use this anywhere we need the active platform commission rate (booking flow,
// owner revenue UI, admin settings UI).
//
// The rate lives in `platform_settings` (migration 0012). RLS restricts that
// table to admins, so non-admin callers read the rate through the SECURITY
// DEFINER RPC `get_commission_percent()` which returns the number only.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isCashfreeConfigured } from "@/lib/cashfree";
import { DEFAULT_COMMISSION_PERCENT, DEFAULT_ADVANCE_PERCENT } from "@/lib/booking-payment";
import { cache } from "react";

const FALLBACK = DEFAULT_COMMISSION_PERCENT; // 2.5

/** Returns the active platform commission rate as a percent (e.g. 5, 7.5).
 *  Falls back to the compile-time default if the settings row or table is
 *  missing (e.g. migration 0012 has not been run yet in dev). */
export async function getCommissionPercent(): Promise<number> {
  try {
    const supabase = await getSupabaseServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db.rpc("get_commission_percent");
    if (error) {
      if (error.code !== "PGRST202" && error.code !== "42883") {
        console.error("[getCommissionPercent]", error.message);
      }
      return FALLBACK;
    }
    const n = Number(data);
    if (!Number.isFinite(n) || n < 0 || n > 100) return FALLBACK;
    return n;
  } catch (e) {
    console.error("[getCommissionPercent]", e instanceof Error ? e.message : e);
    return FALLBACK;
  }
}

/** Convenience: rate as a multiplier (0.05 for 5%). */
export async function getCommissionRate(): Promise<number> {
  return (await getCommissionPercent()) / 100;
}

export type PublicPaymentSettings = {
  defaultAdvancePercentage:    number;
  enableOnlineCustomerPayment: boolean;
};

const PAYMENT_SETTINGS_FALLBACK: PublicPaymentSettings = {
  // MUST equal the compile-time constant. This is what a customer is charged
  // when the settings read fails, and a fallback that disagrees with the code
  // would silently reprice every booking during a database blip. It read 20
  // while the code charged 25.
  defaultAdvancePercentage:    DEFAULT_ADVANCE_PERCENT,
  // Fails CLOSED on purpose: if we cannot confirm that online payment is
  // switched on, take no money and fall back to manual booking requests.
  enableOnlineCustomerPayment: false,
};

/** Non-sensitive payment settings (advance %, online-payment flag) for the
 *  customer booking flow. Read through the SECURITY
 *  DEFINER RPC `get_public_payment_settings()` so non-admins never touch the
 *  admin-only platform_settings row. Falls back to safe defaults pre-migration.
 *
 *  Wrapped in React cache(): a listing page renders many hall cards and each
 *  needs the advance percentage, which would otherwise be one RPC per card.
 *  Deduped per request, not cached across requests, so an admin's change still
 *  takes effect on the next page load. */
export const getPublicPaymentSettings = cache(async function getPublicPaymentSettings(): Promise<PublicPaymentSettings> {
  try {
    const supabase = await getSupabaseServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db.rpc("get_public_payment_settings");
    if (error || !data) return PAYMENT_SETTINGS_FALLBACK;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return PAYMENT_SETTINGS_FALLBACK;
    return {
      // The null-default MUST be the compile-time constant, not a literal. It
      // read 20 here while the fallback below and the code both used 25, so a
      // settings row with a null advance would have repriced every booking.
      defaultAdvancePercentage:    Number(row.default_advance_percentage ?? DEFAULT_ADVANCE_PERCENT),
      enableOnlineCustomerPayment: Boolean(row.enable_online_customer_payment),
    };
  } catch {
    return PAYMENT_SETTINGS_FALLBACK;
  }
});

/** The live advance percentage, for the one thing that needs just that. */
export async function getAdvancePercent(): Promise<number> {
  return (await getPublicPaymentSettings()).defaultAdvancePercentage;
}

/**
 * Is online card/UPI checkout available right now?
 *
 * BOTH must hold: Cashfree credentials must exist, AND an admin must not have
 * switched online payment off. The admin toggle existed in the settings UI but
 * was read by nothing, so turning it off did nothing at all. It is now a real
 * kill switch — flip it off and the site degrades to manual booking requests
 * rather than failing at the gateway.
 */
export async function isOnlinePaymentEnabled(): Promise<boolean> {
  if (!isCashfreeConfigured()) return false;
  return (await getPublicPaymentSettings()).enableOnlineCustomerPayment;
}

/**
 * May a booking be confirmed WITHOUT payment?
 *
 * This is the mirror of isOnlinePaymentEnabled and it must fail in the OTHER
 * direction. isOnlinePaymentEnabled fails closed — if the settings row cannot
 * be read we refuse to take money. Reusing that answer here inverted its
 * meaning: a transient database error made "online payment is off" look true,
 * and this gate then handed out FREE bookings on a gateway-configured
 * deployment.
 *
 * So manual mode requires positive evidence:
 *   • no Cashfree credentials at all (a deployment fact, cannot fail), OR
 *   • the settings row was genuinely READ and says online payment is off.
 * A failed read yields false — no free bookings on a maybe.
 */
export async function isManualBookingAllowed(): Promise<boolean> {
  if (!isCashfreeConfigured()) return true;

  try {
    const supabase = await getSupabaseServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db.rpc("get_public_payment_settings");
    if (error || !data) return false;               // could not read → refuse
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return false;
    return Boolean(row.enable_online_customer_payment) === false;
  } catch {
    return false;
  }
}
