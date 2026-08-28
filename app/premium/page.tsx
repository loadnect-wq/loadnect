import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import Link from "next/link";
import { CheckCircle2, Zap } from "lucide-react";
import { buttonVariants } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/sections/SectionHeader";
import { fetchPremiumPlans, PLAN_FEATURES, type PremiumTier } from "@/lib/premium-plans";
import { cn } from "@/lib/utils";

export const metadata: Metadata = buildMetadata({
  title: "Premium Listings for Venue Owners",
  description:
    "Premium listing plans for hall owners on Hallnect — top placement in Tamil Nadu search results and on the homepage, so more couples find your venue.",
  path: "/premium",
});

function formatPrice(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

// Server Component: the plan catalogue comes from premium_plans, the same rows
// the owner dashboard and the upgrade flow read. This page previously rendered
// a hardcoded list that had drifted badly out of step with it — the page
// advertised "Pro Rs4,999" and "Elite Rs9,999" while the database sold
// "Premium Rs4,999" and "Pro Rs9,999". An owner comparing the pricing page to
// their dashboard saw different products at different prices.
export default async function PremiumPage() {
  const plans = await fetchPremiumPlans();
  return (
    <div className="min-h-screen bg-ivory-100">

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="bg-hero-gradient py-20 text-center">
        <div className="container-page">
          <Badge variant="gold" size="md" className="mb-5">✦ Premium Listings</Badge>
          <h1 className="font-serif text-4xl font-bold text-ivory-100 sm:text-5xl">
            Boost your hall&apos;s visibility
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ivory-400">
            Premium-listed halls appear at the top of search results and on the Hallnect homepage,
            so couples searching in Tamil Nadu find your venue first.
          </p>
        </div>
      </section>

      {/* ── Plans ────────────────────────────────────────────────── */}
      <section className="container-page py-20">
        <SectionHeader
          title="Choose Your Plan"
          description="Monthly plans, billed per hall, renewing automatically. Cancel whenever you like — you keep the month you have already paid for."
          className="mb-12"
        />

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => {
            const features = PLAN_FEATURES[plan.slug as PremiumTier] ?? [];
            const isPopular = plan.slug === "premium";
            return (
              <div
                key={plan.slug}
                className={cn(
                  "relative flex flex-col rounded-2xl border p-8 shadow-card transition-shadow hover:shadow-card-hover",
                  isPopular ? "border-gold-400 bg-white ring-2 ring-gold-400" : "border-border bg-white",
                )}
              >
                {isPopular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <Badge variant="gold" size="md">
                      <Zap className="h-3.5 w-3.5" aria-hidden /> Most Popular
                    </Badge>
                  </div>
                )}

                <div>
                  <p className="font-serif text-2xl font-bold text-charcoal-900">{plan.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
                </div>

                <div className="my-6">
                  <span className="font-serif text-4xl font-bold text-maroon-700">
                    {formatPrice(Number(plan.monthly_price))}
                  </span>
                  <span className="ml-1 text-sm text-muted-foreground">
                    {Number(plan.monthly_price) === 0 ? "always" : "per month"}
                  </span>
                </div>

                <ul className="flex-1 space-y-3">
                  {features.map((f) => (
                    <li key={f.label} className="flex items-start gap-2.5 text-sm text-charcoal-700">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-maroon-500" aria-hidden />
                      {f.label}
                    </li>
                  ))}
                </ul>

                <Link
                  href="/owner/register"
                  className={cn(
                    buttonVariants({ variant: isPopular ? "gold" : "outline", size: "lg" }),
                    "mt-8 w-full justify-center",
                  )}
                >
                  {plan.is_purchasable ? `Choose ${plan.name}` : "Get started free"}
                </Link>
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          All plans require an approved owner account.{" "}
          <Link href="/owner/register" className="font-semibold text-maroon-600 hover:underline">
            Register as owner →
          </Link>
        </p>
      </section>

      {/* ── Comparison callout ───────────────────────────────────── */}
      <section className="bg-ivory-200/60 py-16">
        <div className="container-page">
          <div className="mx-auto max-w-3xl rounded-2xl border border-gold-200 bg-gold-50 p-8 text-center">
            <h2 className="font-serif text-2xl font-semibold text-charcoal-900">
              Not sure which plan to choose?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-charcoal-600">
              Our team is happy to walk you through the options and help you pick what fits best for your hall.
            </p>
            <Link
              href="/contact"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "mt-6")}
            >
              Talk to our team
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
