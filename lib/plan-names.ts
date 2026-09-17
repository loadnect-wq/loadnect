// ─────────────────────────────────────────────────────────────────────────────
// lib/plan-names.ts — what each listing plan is CALLED. Pure: no imports, so
// client components can use it without pulling in a Supabase client.
// ─────────────────────────────────────────────────────────────────────────────

// THE SLUGS ARE INTERNAL IDS AND DO NOT CHANGE. The plans are CALLED Free, Pro
// and Elite (renamed 2026-09-17), but the slugs stay "free" | "premium" | "pro":
// they are stored in premium_listings.plan_slug, halls.premium_tier, Cashfree
// subscription plan ids (hallnect_premium_monthly / hallnect_pro_monthly) and
// recompute_hall_premium(). Renaming a slug would orphan live subscriptions.
//
//   slug "free"    → shown as "Free"
//   slug "premium" → shown as "Pro"    ₹4,999/month
//   slug "pro"     → shown as "Elite"  ₹9,999/month
//
// Every place that shows a plan's name must use TIER_LABEL (or the plan row's
// `name`, which migration 0098 set to the same words) — never the slug.
export type PremiumTier = "free" | "premium" | "pro";

/** The plan NAMES customers and owners see. Slugs are internal — see above. */
export const TIER_LABEL: Record<PremiumTier, string> = {
  free:    "Free",
  premium: "Pro",
  pro:     "Elite",
};

/** A plan slug from anywhere (a DB row, a listing) to its display name. */
export function planDisplayName(slug: string | null | undefined): string {
  return slug === "pro" || slug === "premium" || slug === "free" ? TIER_LABEL[slug] : "Free";
}
