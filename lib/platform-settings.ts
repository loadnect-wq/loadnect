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
import { PLATFORM_FEE_PERCENT } from "@/lib/constants";

const FALLBACK = PLATFORM_FEE_PERCENT; // 5

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
