import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerRow, fetchOwnerHalls, fetchOwnerPremiumListings } from "@/lib/owner";
import { PLAN_FEATURES } from "@/lib/premium-plans";
import { formatPrice } from "@/lib/mock-data";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { AppHeader } from "@/components/app/AppHeader";

export const metadata: Metadata = { title: "Premium Listings" };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function isActive(startDate: string, endDate: string): boolean {
  const today = new Date().toISOString().split("T")[0];
  return startDate <= today && today <= endDate;
}

export default async function OwnerPremiumPage() {
  await requireRole(["owner_approved"]);

  const ownerRow = await fetchOwnerRow();
  if (!ownerRow) {
    return (
      <div className="min-h-screen bg-ivory-100">
        <AppHeader title="Premium" />
        <div className="px-4 py-8">
          <EmptyState
            icon={<Sparkles className="h-8 w-8" />}
            title="No business profile"
            description="Complete your owner profile first."
            action={<Link href="/owner/profile" className={buttonVariants({ variant: "gold", size: "sm" })}>Complete Profile</Link>}
          />
        </div>
      </div>
    );
  }

  const halls    = await fetchOwnerHalls(ownerRow.id);
  const hallIds  = halls.map((h) => h.id);
  const listings = await fetchOwnerPremiumListings(hallIds);

  const activeListing = listings.find(
    (l) => l.is_active && isActive(l.start_date, l.end_date),
  );

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Premium Listings" />

      <div className="px-4 py-5 sm:px-6 lg:px-8 space-y-5">

        {/* Current status */}
        <div className="rounded-2xl bg-gradient-to-br from-gold-600 to-gold-700 p-5 text-white shadow-elevated">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-5 w-5" />
            <h2 className="font-serif text-lg font-bold">Premium Status</h2>
          </div>
          {activeListing ? (
            <>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{activeListing.hall_name}</p>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  {activeListing.plan_slug === "pro" ? "★ Pro" : "✦ Premium"}
                </span>
              </div>
              <p className="mt-1 text-xs text-gold-100">
                Active {fmtDate(activeListing.start_date)} – {fmtDate(activeListing.end_date)}
              </p>
              <div className="mt-3 rounded-xl bg-white/15 px-3 py-2">
                <p className="text-xs text-gold-100">Benefits active:</p>
                <ul className="mt-1 space-y-0.5 text-xs text-white">
                  {/* Read from PLAN_FEATURES so this can never promise
                      something the plans page does not sell. It used to list
                      "Advanced analytics", "Basic analytics" and "Priority
                      support" as ACTIVE benefits; none of the three is built. */}
                  {PLAN_FEATURES[activeListing.plan_slug === "pro" ? "pro" : "premium"].map((f) => (
                    <li key={f.label}>✓ {f.label}</li>
                  ))}
                </ul>
              </div>
              <Link
                href="/owner/premium/upgrade"
                className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-[11px] font-semibold text-white hover:bg-white/30"
              >
                Compare plans
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm text-gold-100">No active premium listing.</p>
              <p className="mt-1 text-xs text-gold-200">
                Premium halls appear higher in search results with a featured badge.
              </p>
              <Link
                href="/owner/premium/upgrade"
                className="mt-3 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-gold-700 hover:bg-gold-50"
              >
                <Sparkles className="h-3 w-3" /> See plans
              </Link>
            </>
          )}
        </div>

        {/* How to get premium */}
        {!activeListing && (
          <div className="rounded-2xl bg-white shadow-card p-5 space-y-3">
            <h3 className="font-serif text-sm font-semibold text-charcoal-900">How to get Premium</h3>
            {/* This used to say "contact support" and "complete payment via the
                secure link provided" — there was no link and no payment step
                anywhere in the product. Owners now buy a plan themselves. */}
            <ol className="space-y-2 text-sm text-charcoal-600">
              <li className="flex gap-2"><span className="font-bold text-maroon-600">1.</span> Pick a plan and the hall you want to promote</li>
              <li className="flex gap-2"><span className="font-bold text-maroon-600">2.</span> Pay by UPI, card, net banking or wallet</li>
              <li className="flex gap-2"><span className="font-bold text-maroon-600">3.</span> Your hall is boosted the moment the payment is confirmed</li>
            </ol>
            <Link
              href="/owner/premium/upgrade"
              className={buttonVariants({ variant: "gold", size: "sm" })}
            >
              <Sparkles className="h-4 w-4" /> See plans
            </Link>
          </div>
        )}

        {/* Listing history */}
        {listings.length > 0 && (
          <section>
            <h2 className="font-serif text-sm font-semibold text-charcoal-900 mb-3">
              Premium History
            </h2>
            <div className="space-y-2.5">
              {listings.map((l) => {
                const live = l.is_active && isActive(l.start_date, l.end_date);
                return (
                  <div key={l.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card">
                    <Sparkles className={`h-5 w-5 shrink-0 ${live ? "text-gold-500" : "text-charcoal-300"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-charcoal-900 truncate">{l.hall_name}</p>
                      <p className="text-xs text-charcoal-500">
                        {fmtDate(l.start_date)} → {fmtDate(l.end_date)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right space-y-1">
                      <p className="text-sm font-bold text-charcoal-900">{formatPrice(l.amount)}</p>
                      <Badge variant={live ? "gold" : "secondary"} size="sm">
                        {live ? "Active" : "Expired"}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {listings.length === 0 && (
          <EmptyState
            icon={<Sparkles className="h-8 w-8" />}
            title="No premium history"
            description="Your premium listing purchases will appear here."
            size="sm"
          />
        )}
      </div>
    </div>
  );
}
