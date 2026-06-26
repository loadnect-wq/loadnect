// ─────────────────────────────────────────────────────────────────────────────
// lib/premium-plans.ts — premium plan catalogue + tier types.
//
// Plans live in `premium_plans` (migration 0013).  The catalogue is PUBLIC-
// readable so the owner upgrade page and the public marketing page can render
// pricing without an admin session; only admins can write.
//
// Feature lists below are CODE-driven on purpose — they describe what each
// tier UNLOCKS in the product, not pricing.  Pricing/duration is the only
// admin-editable part.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseServerClient } from "@/lib/supabase/server";

export type PremiumTier = "free" | "premium" | "pro";

export type PremiumPlan = {
  slug:           PremiumTier;
  name:           string;
  description:    string | null;
  monthly_price:  number;
  duration_days:  number;
  is_purchasable: boolean;
  sort_order:     number;
};

export type PlanFeature = { label: string };

// Code-driven feature lists per tier. Edited via deploy, not the admin UI.
export const PLAN_FEATURES: Record<PremiumTier, PlanFeature[]> = {
  free: [
    { label: "Basic listing" },
    { label: "Normal search ranking" },
    { label: "Limited visibility" },
  ],
  premium: [
    { label: "Featured badge on hall card" },
    { label: "Higher search ranking" },
    { label: "More visibility across categories" },
    { label: "Basic analytics" },
  ],
  pro: [
    { label: "Homepage promotion" },
    { label: "Top placement in search" },
    { label: "Advanced analytics" },
    { label: "Priority support" },
  ],
};

// Hardcoded fallback used when premium_plans isn't provisioned yet (dev).
const FALLBACK: PremiumPlan[] = [
  { slug: "free",    name: "Free",    description: "Basic listing with normal search ranking and limited visibility.",        monthly_price: 0,    duration_days: 30, is_purchasable: false, sort_order: 0 },
  { slug: "premium", name: "Premium", description: "Featured badge, higher search ranking, more visibility, basic analytics.", monthly_price: 999,  duration_days: 30, is_purchasable: true,  sort_order: 1 },
  { slug: "pro",     name: "Pro",     description: "Homepage promotion, top placement, advanced analytics, priority support.", monthly_price: 2499, duration_days: 30, is_purchasable: true,  sort_order: 2 },
];

export async function fetchPremiumPlans(): Promise<PremiumPlan[]> {
  try {
    const supabase = await getSupabaseServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from("premium_plans")
      .select("slug, name, description, monthly_price, duration_days, is_purchasable, sort_order")
      .order("sort_order", { ascending: true });

    if (error) {
      if (error.code !== "PGRST205" && error.code !== "42P01") {
        console.error("[fetchPremiumPlans]", error.message);
      }
      return FALLBACK;
    }
    if (!data || data.length === 0) return FALLBACK;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data.map((row: any): PremiumPlan => ({
      slug:           row.slug as PremiumTier,
      name:           row.name,
      description:    row.description ?? null,
      monthly_price:  Number(row.monthly_price),
      duration_days:  Number(row.duration_days),
      is_purchasable: row.is_purchasable,
      sort_order:     Number(row.sort_order),
    }));
  } catch (e) {
    console.error("[fetchPremiumPlans]", e instanceof Error ? e.message : e);
    return FALLBACK;
  }
}

// Label + priority helpers used by the badge + sort code.
export const TIER_LABEL: Record<PremiumTier, string> = {
  free:    "Free",
  premium: "Premium",
  pro:     "Pro",
};

/** Higher = ranks higher in search. Pro > Premium > free. */
export function tierRank(tier: PremiumTier | null): number {
  switch (tier) {
    case "pro":     return 2;
    case "premium": return 1;
    default:        return 0;
  }
}
