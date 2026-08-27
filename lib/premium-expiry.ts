// ─────────────────────────────────────────────────────────────────────────────
// lib/premium-expiry.ts — retire premium listings whose paid window has closed.
// SERVER-ONLY.
//
// The work is done by the SQL function expire_premium_listings() (migration
// 0041) rather than here, because retiring a listing and recomputing the hall's
// tier has to happen as one unit: the AFTER trigger on premium_listings is what
// updates halls.premium_tier, and a sweep that deactivated rows in one
// statement and recomputed in another could leave a hall promoted or demoted in
// between. The function is SECURITY DEFINER and revoked from anon/authenticated,
// so only the service-role client here can call it.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export type PremiumExpirySummary = {
  /** Listings whose end_date had passed and are now inactive. */
  deactivated: number;
  /** Halls that were still flagged premium with no live listing behind them. */
  hallsRecomputed: number;
};

export async function expirePremiumListings(): Promise<PremiumExpirySummary> {
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  const { data, error } = await db.rpc("expire_premium_listings");
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  return {
    deactivated:     Number(row?.deactivated ?? 0),
    hallsRecomputed: Number(row?.halls_recomputed ?? 0),
  };
}
