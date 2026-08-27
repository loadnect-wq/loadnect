import type { Metadata } from "next";
import { Check, Sparkles, Star } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchPremiumPlans, PLAN_FEATURES, type PremiumPlan, type PremiumTier } from "@/lib/premium-plans";
import { fetchOwnerRow, fetchOwnerBuyableHalls } from "@/lib/owner";
import { isCashfreeConfigured } from "@/lib/cashfree";
import { AppHeader } from "@/components/app/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { BuyPlan } from "../_components/BuyPlan";

export const metadata: Metadata = { title: "Premium Upgrade" };

function formatPrice(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

const TIER_VISUAL: Record<PremiumTier, { ring: string; pill: string; icon: React.ReactNode; }> = {
  free:    { ring: "ring-charcoal-200", pill: "bg-charcoal-100 text-charcoal-700",  icon: <span className="h-5 w-5 inline-flex items-center justify-center rounded-full bg-charcoal-200 text-charcoal-600 text-[10px] font-bold">F</span> },
  premium: { ring: "ring-gold-400",     pill: "bg-gold-100 text-gold-800",          icon: <Sparkles className="h-5 w-5 text-gold-600" /> },
  pro:     { ring: "ring-maroon-500",   pill: "bg-maroon-100 text-maroon-800",      icon: <Star className="h-5 w-5 text-maroon-700 fill-maroon-600" /> },
};

export default async function OwnerPremiumUpgradePage() {
  await requireRole(["owner_approved"]);

  const ownerRow = await fetchOwnerRow();
  const [plans, halls] = await Promise.all([
    fetchPremiumPlans(),
    ownerRow ? fetchOwnerBuyableHalls(ownerRow.id) : Promise.resolve([]),
  ]);
  // Nothing to sell against if the gateway is not configured — say so rather
  // than rendering a button that can only fail.
  const gatewayReady = isCashfreeConfigured();

  // Render free first, then paid, regardless of sort_order quirks.
  const ordered: PremiumPlan[] = ["free", "premium", "pro"]
    .map((s) => plans.find((p) => p.slug === s))
    .filter((p): p is PremiumPlan => Boolean(p));

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Premium Plans" showBack />

      <div className="px-4 py-5 sm:px-6 lg:px-8 space-y-5">

        <div className="text-center max-w-xl mx-auto">
          <h1 className="font-serif text-2xl font-bold text-charcoal-900">Boost your hall&apos;s visibility</h1>
          <p className="mt-1 text-sm text-charcoal-600">
            Pick a plan that fits your venue. Premium and Pro listings appear higher in search.
            All plans run for {ordered[0]?.duration_days ?? 30} days from activation.
          </p>
        </div>

        {/* Plan grid */}
        <div className="grid gap-4 lg:grid-cols-3">
          {ordered.map((plan) => {
            const features = PLAN_FEATURES[plan.slug];
            const v = TIER_VISUAL[plan.slug];
            const isCurrent = plan.slug === "free"; // owner's current default; precise current-plan comes from /owner/premium
            return (
              <div
                key={plan.slug}
                className={`relative rounded-2xl bg-white p-5 shadow-card ring-2 ${v.ring}`}
              >
                {plan.slug === "pro" && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-maroon-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow">
                    Most popular
                  </span>
                )}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {v.icon}
                    <h2 className="font-serif text-lg font-bold text-charcoal-900">{plan.name}</h2>
                  </div>
                  <Badge size="sm" variant="secondary">{plan.duration_days}d</Badge>
                </div>

                <div className="mt-3">
                  <span className="font-serif text-3xl font-bold text-charcoal-900">
                    {plan.monthly_price === 0 ? "Free" : formatPrice(plan.monthly_price)}
                  </span>
                  {plan.monthly_price > 0 && (
                    <span className="ml-1 text-xs text-charcoal-500">/ {plan.duration_days}d</span>
                  )}
                </div>

                {plan.description && (
                  <p className="mt-2 text-xs text-charcoal-600">{plan.description}</p>
                )}

                <ul className="mt-4 space-y-1.5">
                  {features.map((f) => (
                    <li key={f.label} className="flex items-start gap-2 text-sm text-charcoal-700">
                      <Check className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                      <span>{f.label}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-5">
                  {plan.slug === "free" ? (
                    <span className={`block rounded-lg ${v.pill} px-3 py-2 text-center text-xs font-semibold`}>
                      {isCurrent ? "Your default plan" : "Included by default"}
                    </span>
                  ) : !plan.is_purchasable ? (
                    <span className="block rounded-lg bg-charcoal-100 px-3 py-2 text-center text-xs font-semibold text-charcoal-500">
                      Coming soon
                    </span>
                  ) : !gatewayReady ? (
                    <span className="block rounded-lg bg-charcoal-100 px-3 py-2 text-center text-xs font-semibold text-charcoal-500">
                      Payments temporarily unavailable
                    </span>
                  ) : (
                    <BuyPlan
                      planSlug={plan.slug as "premium" | "pro"}
                      amountLabel={formatPrice(plan.monthly_price)}
                      halls={halls}
                      accent={plan.slug === "pro" ? "maroon" : "gold"}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-800">
          <p className="font-semibold">How activation works</p>
          <ol className="mt-1.5 space-y-1 list-decimal list-inside">
            <li>Pick the hall you want to promote and pay by UPI, card, net banking or wallet.</li>
            <li>Your listing is boosted the moment the payment is confirmed — no waiting for approval.</li>
            <li>
              The plan runs for {ordered[0]?.duration_days ?? 30} days and then stops on its own.
              Renewing early adds to the days you already have.
            </li>
          </ol>
          <p className="mt-2 text-[11px] text-blue-700">
            Payment is handled by Cashfree; Hallnect never sees your card or UPI details. A plan can
            only be bought for a hall that is already approved and live.
          </p>
        </div>
      </div>
    </div>
  );
}
