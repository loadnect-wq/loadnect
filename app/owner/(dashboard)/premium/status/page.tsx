import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle, AlertTriangle } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { verifyAndApplyPlanPurchase } from "@/lib/plan-payments";
import { AppHeader } from "@/components/app/AppHeader";
import { buttonVariants } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Plan payment" };

// Cashfree returns the owner here after checkout. The URL's claim of success is
// NEVER trusted: this page re-verifies the order against Cashfree server-side,
// and that same call is what activates the listing. Rendering is dynamic so a
// cached page can never show a stale "active".
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ order_id?: string }> };

function fmtDate(iso: string | undefined) {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });
}

export default async function PlanPaymentStatusPage({ searchParams }: Props) {
  await requireRole(["owner_approved"]);
  const { order_id: orderId } = await searchParams;

  const result = orderId
    ? await verifyAndApplyPlanPurchase(orderId)
    : ({ state: "not_found" } as const);

  const until = fmtDate("endDate" in result ? result.endDate : undefined);

  const view = {
    paid: {
      icon: <CheckCircle2 className="h-10 w-10 text-green-600" />,
      tone: "border-green-200 bg-green-50",
      title: "Your plan is active",
      body: until
        ? `Your hall is boosted straight away and stays boosted until ${until}.`
        : "Payment received. Your hall is boosted straight away — see your premium page for the exact dates.",
    },
    pending: {
      icon: <Clock className="h-10 w-10 text-amber-500" />,
      tone: "border-amber-200 bg-amber-50",
      title: "Payment is being verified",
      body: "Your bank has not confirmed this payment yet. Your plan activates automatically the moment it clears — if money left your account, do not pay again.",
    },
    failed: {
      icon: <XCircle className="h-10 w-10 text-red-600" />,
      tone: "border-red-200 bg-red-50",
      title: "Payment did not complete",
      body: "No money was taken and no plan was activated. You can try again from the plans page.",
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
      <AppHeader title="Plan payment" />
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
