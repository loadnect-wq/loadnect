import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { verifyAndApplyCommissionPayment } from "@/lib/commission-payments";
import { AppHeader } from "@/components/app/AppHeader";
import { buttonVariants } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Commission payment" };

// Cashfree returns the owner here after checkout. The URL's claim of success is
// NEVER trusted: this page re-verifies the order against Cashfree server-side
// and only then reports it as paid. Rendering is dynamic so a cached page can
// never show a stale "paid".
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ order_id?: string }> };

export default async function CommissionPaymentStatusPage({ searchParams }: Props) {
  await requireRole(["owner_approved"]);
  const { order_id: orderId } = await searchParams;

  const result = orderId
    ? await verifyAndApplyCommissionPayment(orderId)
    : ({ state: "not_found" } as const);

  const view = {
    paid: {
      icon: <CheckCircle2 className="h-10 w-10 text-green-600" />,
      tone: "border-green-200 bg-green-50",
      title: "Commission paid",
      body: "Thank you — your commission is settled. Nothing further is owed for this booking.",
    },
    pending: {
      icon: <Clock className="h-10 w-10 text-amber-500" />,
      tone: "border-amber-200 bg-amber-50",
      title: "Payment is being verified",
      body: "Your bank has not confirmed this payment yet. This page updates once it clears — if money left your account it will settle shortly; you do not need to pay again.",
    },
    failed: {
      icon: <XCircle className="h-10 w-10 text-red-600" />,
      tone: "border-red-200 bg-red-50",
      title: "Payment did not complete",
      body: "No money was taken. You can try again from your commissions page.",
    },
    not_found: {
      icon: <XCircle className="h-10 w-10 text-charcoal-400" />,
      tone: "border-border bg-white",
      title: "Payment not found",
      body: "We could not find this payment. If you were charged, contact Hallnect support with the time of payment.",
    },
  }[result.state];

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Commission payment" />
      <div className="mx-auto max-w-md px-4 py-8">
        <div className={`rounded-2xl border-2 p-6 text-center ${view.tone}`}>
          <div className="flex justify-center">{view.icon}</div>
          <h1 className="mt-3 font-serif text-xl font-bold text-charcoal-900">{view.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-charcoal-700">{view.body}</p>

          {orderId && (
            <p className="mt-3 font-mono text-[10px] text-charcoal-400">Ref: {orderId}</p>
          )}

          <div className="mt-5 flex flex-col gap-2">
            <Link href="/owner/commissions" className={buttonVariants({ variant: "default" })}>
              Back to commissions
            </Link>
            {result.state === "pending" && (
              <Link
                href={`/owner/commissions/status?order_id=${encodeURIComponent(orderId ?? "")}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Check again
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
