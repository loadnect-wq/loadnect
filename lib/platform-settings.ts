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
import { DEFAULT_COMMISSION_PERCENT } from "@/lib/booking-payment";

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
  hallnectUpiId:                 string | null;
  hallnectUpiQrUrl:              string | null;
  commissionDueDays:             number;
  defaultAdvancePercentage:      number;
  enableOnlineCustomerPayment:   boolean;
  enableOwnerUpiPayment:         boolean;
  enableAutoCommissionAdjustment: boolean;
};

const PAYMENT_SETTINGS_FALLBACK: PublicPaymentSettings = {
  hallnectUpiId:                 null,
  hallnectUpiQrUrl:              null,
  commissionDueDays:             7,
  defaultAdvancePercentage:      20,
  enableOnlineCustomerPayment:   false,
  enableOwnerUpiPayment:         true,
  enableAutoCommissionAdjustment: false,
};

/** Non-sensitive payment settings (UPI id/QR, advance %, feature flags) for the
 *  owner Pay-Now UI and the customer booking flow. Read through the SECURITY
 *  DEFINER RPC `get_public_payment_settings()` so non-admins never touch the
 *  admin-only platform_settings row. Falls back to safe defaults pre-migration. */
export async function getPublicPaymentSettings(): Promise<PublicPaymentSettings> {
  try {
    const supabase = await getSupabaseServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db.rpc("get_public_payment_settings");
    if (error || !data) return PAYMENT_SETTINGS_FALLBACK;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return PAYMENT_SETTINGS_FALLBACK;
    return {
      hallnectUpiId:                 row.hallnect_upi_id ?? null,
      hallnectUpiQrUrl:              row.hallnect_upi_qr_url ?? null,
      commissionDueDays:             Number(row.commission_due_days ?? 7),
      defaultAdvancePercentage:      Number(row.default_advance_percentage ?? 20),
      enableOnlineCustomerPayment:   Boolean(row.enable_online_customer_payment),
      enableOwnerUpiPayment:         Boolean(row.enable_owner_upi_payment ?? true),
      enableAutoCommissionAdjustment: Boolean(row.enable_auto_commission_adjustment),
    };
  } catch {
    return PAYMENT_SETTINGS_FALLBACK;
  }
}
