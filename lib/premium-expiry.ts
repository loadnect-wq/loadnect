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
import { notifyPremiumChanged } from "@/lib/notifications/events";

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

  // WHICH listings are about to be retired, captured BEFORE the sweep runs —
  // afterwards they are indistinguishable from any other inactive row, and the
  // RPC returns counts rather than ids. Without this the owner's boost simply
  // stopped one night with no message: they had paid for it, it ended, and the
  // first they knew was that enquiries dried up.
  const { data: expiring } = await db
    .from("premium_listings")
    .select("id, hall_id, plan_slug")
    .eq("is_active", true)
    .lt("end_date", new Date().toISOString().slice(0, 10));

  const { data, error } = await db.rpc("expire_premium_listings");
  if (error) throw new Error(error.message);

  // Notified after the sweep, so the message is only sent for a demotion that
  // actually happened. Failures here must not fail the sweep — the listing is
  // already correctly retired, and notifyPremiumChanged swallows its own errors.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const l of ((expiring ?? []) as any[])) {
    await notifyPremiumChanged(
      l.id,
      l.hall_id,
      false,
      String(l.plan_slug).charAt(0).toUpperCase() + String(l.plan_slug).slice(1),
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    deactivated:     Number(row?.deactivated ?? 0),
    hallsRecomputed: Number(row?.halls_recomputed ?? 0),
  };
}
