// Server-side ad reader. Separated from lib/ads.ts so the shared
// validators/types can be safely imported by client components.

import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  isValidPlacement,
  sanitizeAdText,
  type AdPlacement,
  type PublicAd,
} from "@/lib/ads";

export async function fetchActiveAds(
  placement: AdPlacement,
  limit = 4,
): Promise<PublicAd[]> {
  if (!isValidPlacement(placement)) return [];

  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const today = new Date().toISOString().slice(0, 10);

  // Try with advertiser_name (post-0014). Fall back if column is missing so
  // pages don't blow up before the migration is applied.
  const SELECT_FULL = "id, title, image_url, target_url, advertiser_name, placement";
  const SELECT_LEGACY = "id, title, image_url, target_url, placement";

  let { data, error } = await db
    .from("advertisements")
    .select(SELECT_FULL)
    .eq("status", "active")
    .eq("placement", placement)
    .lte("start_date", today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error?.code === "42703") {
    ({ data, error } = await db
      .from("advertisements")
      .select(SELECT_LEGACY)
      .eq("status", "active")
      .eq("placement", placement)
      .lte("start_date", today)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order("created_at", { ascending: false })
      .limit(limit));
  }

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      console.info("[fetchActiveAds] advertisements table not provisioned yet.");
    } else {
      console.error("[fetchActiveAds]", error.message);
    }
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): PublicAd => ({
    id:              row.id,
    title:           sanitizeAdText(row.title, 200),
    image_url:       row.image_url  ?? null,
    target_url:      row.target_url ?? null,
    advertiser_name: row.advertiser_name ? sanitizeAdText(row.advertiser_name, 120) : null,
    placement:       row.placement,
  }));
}
