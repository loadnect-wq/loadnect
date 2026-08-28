import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle, AlertTriangle } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { verifyAndApplyPlanPurchase } from "@/lib/plan-payments";
import { syncSubscription } from "@/lib/plan-subscriptions";
import { AppHeader } from "@/components/app/AppHeader";
import { buttonVariants } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Plan payment" };

// Cashfree returns the owner here after checkout. The URL's claim of success is
// NEVER trusted: this page re-verifies the order against Cashfree server-side,
// and that same call is what activates the listing. Rendering is dynamic so a
// cached page can never show a stale "active".
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ order_id?: string; subscription_id?: string }> };

/**
 * Collapses a subscription sync onto the same small set of states this page
 * already renders, so both journeys share one set of messages.
 *
 * 'unactivated' is preserved rather than flattened into success: it means a
 * charge WAS taken and the boost could not be granted, and the owner must never
 * be told that worked.
 */
function mapSubscription(r: Awaited<ReturnType<typeof syncSubscription>>):
  { state: "paid" | "pending" | "failed" | "unactivated" | "not_found" | "error" | "cancelled" | "awaiting_charge"; endDate?: string } {
  if (r.unactivated) return { state: "unactivated" };
  switch (r.state) {
    // AN AUTHORISED MANDATE IS NOT A PAID MONTH. Cashfree can report ACTIVE
    // before the first debit settles, and until money has moved there is no
    // listing and no promotion. Saying "your plan is active" on the strength of
    // the mandate alone is the same lie as calling an unauthorised attempt a
    // subscription — so the boost itself is what decides this.
    case "active":    return r.boosted
                        ? { state: "paid", endDate: r.endDate }
                        : { state: "awaiting_charge" };
    case "pending":   return { state: "pending" };
    case "cancelled": return { state: "cancelled" };
    case "failed":    return { state: "failed" };
    case "not_found": return { state: "not_found" };
    default:          return { state: "error" };
  }
}

function fmtDate(iso: string | undefined) {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });
}

export default async function PlanPaymentStatusPage({ searchParams }: Props) {
  await requireRole(["owner_approved"]);
  const { order_id: orderId, subscription_id: subscriptionId } = await searchParams;

  // Two ways an owner lands here: back from a MANDATE screen (subscription), or
  // back from a one-off order (the pre-subscription flow, kept so an old link
  // still resolves rather than 404-ing).
  const result = subscriptionId
    ? mapSubscription(await syncSubscription(subscriptionId))
    : orderId
      ? await verifyAndApplyPlanPurchase(orderId)
      : ({ state: "not_found" } as const);

  const until = fmtDate("endDate" in result ? result.endDate : undefined);

  const view = {
    paid: {
      icon: <CheckCircle2 className="h-10 w-10 text-green-600" />,
      tone: "border-green-200 bg-green-50",
      title: "Your plan is active",
      body: until
        ? `Your hall is boosted straight away, and renews automatically each month. Paid up to ${until}.`
        : "Your hall is boosted straight away and renews automatically each month. See your premium page for the exact dates.",
    },
    pending: {
      icon: <Clock className="h-10 w-10 text-amber-500" />,
      tone: "border-amber-200 bg-amber-50",
      title: "We are waiting on your bank",
      body: "Your mandate has not been confirmed yet. Some banks take a few minutes to approve an auto-pay instruction. Your plan starts by itself the moment it clears — do not set it up again.",
    },
    failed: {
      icon: <XCircle className="h-10 w-10 text-red-600" />,
      tone: "border-red-200 bg-red-50",
      title: "That did not go through",
      body: "The mandate was not set up and nothing has been charged. You can try again from the plans page.",
    },
    not_found: {
      icon: <XCircle className="h-10 w-10 text-charcoal-400" />,
      tone: "border-border bg-white",
      title: "Payment not found",
      body: "We could not find this payment. If you were charged, contact Hallnect support with the time of payment.",
    },
    // verifyAndApplyPlanPurchase could not finish (gateway unreachable). Never
    // claim either outcome — the server log carries the detail for support.
    error: {
      icon: <Clock className="h-10 w-10 text-amber-500" />,
      tone: "border-amber-200 bg-amber-50",
      title: "We could not confirm this yet",
      body: "Your payment may still have gone through. Please check your premium page in a few minutes, and contact Hallnect support if it has not appeared — do not pay again.",
    },
    // Mandate approved, first payment not settled yet. Honest middle state:
    // they have done their part, and the boost is not on until money moves.
    awaiting_charge: {
      icon: <Clock className="h-10 w-10 text-amber-500" />,
      tone: "border-amber-200 bg-amber-50",
      title: "Monthly billing is set up",
      body: "Thank you — your auto-pay is approved. Your hall is boosted as soon as the first payment settles, usually within a few minutes. Nothing more is needed from you.",
    },
    // The mandate was stopped (by the owner, or by Cashfree completing it).
    cancelled: {
      icon: <XCircle className="h-10 w-10 text-charcoal-400" />,
      tone: "border-border bg-white",
      title: "This subscription has ended",
      body: "No further monthly payments will be taken. Any month you have already paid for still runs to its end date.",
    },
    // MONEY TAKEN, LISTING NOT GRANTED. This must never render as success: the
    // whole point of the state is that the owner paid and did not get what they
    // paid for. Reloading re-runs activation, so it usually resolves itself.
    unactivated: {
      icon: <AlertTriangle className="h-10 w-10 text-red-600" />,
      tone: "border-red-200 bg-red-50",
      title: "Payment received — we are still activating your plan",
      body: "Your payment went through, but we could not switch the boost on just yet. Reload this page in a minute and it should complete. If it still has not, contact Hallnect support quoting this payment — you will not be charged again.",
    },
  }[result.state];

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Plan payment" notificationsHref="/owner/notifications" />
      <div className="mx-auto max-w-md px-4 py-8">
        <div className={`rounded-2xl border-2 p-6 text-center ${view.tone}`}>
          <div className="flex justify-center">{view.icon}</div>
          <h1 className="mt-3 font-serif text-xl font-bold text-charcoal-900">{view.title}</h1>
          <p className="mt-2 text-sm text-charcoal-600">{view.body}</p>

          <div className="mt-5 flex flex-col gap-2">
            <Link href="/owner/premium" className={buttonVariants({ variant: "gold", size: "sm" })}>
              View my plan
            </Link>
            <Link href="/owner/dashboard" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
