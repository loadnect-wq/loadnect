// ─────────────────────────────────────────────────────────────────────────────
// lib/guides.server.ts — the live data the planning guides read. SERVER-ONLY.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";
import { getSupabasePublicClient } from "@/lib/supabase/public";

/**
 * Every live hall's city and listed full-day price, for the wedding hall cost
 * guide's city table. The same population the sitemap lists (status
 * approved), through the cookie-free client so the guide can be cached.
 *
 * THROWS ON A FAILED READ. The guide is ISR: throwing keeps the last good page
 * up. Returning [] would publish "no city has enough priced halls" — a claim
 * about the catalogue — every time a transient error landed on a revalidation.
 *
 * NOT `Number(row.price_per_day)` on its own: Number(null) is 0, and a hall
 * priced "on request" must stay null, not become a ₹0 listing.
 */
export async function fetchListedPricesStrict(): Promise<{ city: string; price_per_day: number | null }[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabasePublicClient() as any;
  const { data, error } = await db
    .from("halls")
    .select("city, price_per_day")
    .eq("status", "approved")
    .limit(5000);
  if (error) {
    console.error("[guides] listed-price query failed:", error.message);
    throw new Error(`[guides] listed-price query failed: ${error.message}`);
  }
  return ((data ?? []) as { city: string | null; price_per_day: number | string | null }[]).map((h) => ({
    city: (h.city ?? "").trim(),
    price_per_day: h.price_per_day == null ? null : Number(h.price_per_day),
  }));
}
