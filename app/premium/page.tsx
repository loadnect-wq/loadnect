import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import Link from "next/link";
import { CheckCircle2, Zap } from "lucide-react";
import { buttonVariants } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/sections/SectionHeader";
import { PREMIUM_TIERS } from "@/lib/content";
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

export default function PremiumPage() {
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
          description="Flexible monthly plans. No lock-in. Cancel anytime."
          className="mb-12"
        />

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PREMIUM_TIERS.map((tier) => (
            <div
              key={tier.id}
              className={cn(
                "relative flex flex-col rounded-2xl border p-8 shadow-card transition-shadow hover:shadow-card-hover",
                tier.isPopular
                  ? "border-gold-400 bg-white ring-2 ring-gold-400"
                  : "border-border bg-white",
              )}
            >
              {tier.isPopular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <Badge variant="gold" size="md">
                    <Zap className="h-3.5 w-3.5" aria-hidden /> Most Popular
                  </Badge>
                </div>
              )}

              <div>
                <p className="font-serif text-2xl font-bold text-charcoal-900">{tier.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{tier.tagline}</p>
              </div>

              <div className="my-6">
                <span className="font-serif text-4xl font-bold text-maroon-700">
                  {formatPrice(tier.priceMonthly)}
                </span>
                <span className="ml-1 text-sm text-muted-foreground">{tier.durationLabel}</span>
              </div>

              <ul className="flex-1 space-y-3">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-charcoal-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-maroon-500" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href={tier.ctaHref}
                className={cn(
                  buttonVariants({
                    variant: tier.isPopular ? "gold" : "outline",
                    size: "lg",
                  }),
                  "mt-8 w-full justify-center",
                )}
              >
                {tier.ctaLabel}
              </Link>
            </div>
          ))}
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
