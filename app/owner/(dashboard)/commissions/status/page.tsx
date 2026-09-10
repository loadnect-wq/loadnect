import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { verifyAndApplyCommissionPayment, isCommissionOrderId } from "@/lib/commission-payments";
import { AppHeader } from "@/components/app/AppHeader";
import { buttonVariants } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Commission payment" };

// Cashfree returns the owner here after checkout. THE URL'S CLAIM IS NEVER
// TRUSTED: this page re-reads the order from Cashfree's own API server-side and
// compares the amount to what we stored, and that same call is what marks the
// commission settled. Dynamic so a cached page can never show a stale "paid".
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ order_id?: string }> };

export default async function CommissionPaymentStatusPage({ searchParams }: Props) {
  await requireRole(["owner_approved"]);
  const { order_id: orderId } = await searchParams;

  // Refuse an order id from another namespace rather than handing a booking or
  // plan order to the commission verifier.
  const result =
    orderId && isCommissionOrderId(orderId)
      ? await verifyAndApplyCommissionPayment(orderId)
      : ({ state: "not_found" } as const);

  const view = {
    paid: {
      icon: <CheckCircle2 className="h-10 w-10 text-green-600" aria-hidden />,
      tone: "border-green-200 bg-green-50",
      title: "Commission paid",
      body: "Thank you — this commission is settled and nothing further is due on it. Your payment history below shows the reference.",
    },
    pending: {
      icon: <Clock className="h-10 w-10 text-amber-500" aria-hidden />,
      tone: "border-amber-200 bg-amber-50",
      title: "Payment not completed",
      body: "The payment window closed before the money left your account. Nothing has been charged — you can try again from your commissions page.",
    },
    failed: {
      icon: <XCircle className="h-10 w-10 text-red-500" aria-hidden />,
      tone: "border-red-200 bg-red-50",
      title: "Payment failed",
      body: "Your bank or UPI app did not complete the payment, and nothing has been charged. Please try again.",
    },
    // MONEY TAKEN, COMMISSION NOT MARKED. Never reported as success. The
    // webhook retries this same verification on Cashfree's schedule, so it
    // usually resolves itself — but the owner is told the truth in the
    // meantime, and told not to pay twice.
    unsettled: {
      icon: <AlertTriangle className="h-10 w-10 text-amber-600" aria-hidden />,
      tone: "border-amber-300 bg-amber-50",
      title: "Payment received — we are still recording it",
      body: "Your payment went through, but we could not mark the commission settled just yet. Please do NOT pay again. This normally clears within a few minutes; refresh this page, and contact Hallnect support if it persists.",
    },
    not_found: {
      icon: <AlertTriangle className="h-10 w-10 text-charcoal-400" aria-hidden />,
      tone: "border-border bg-ivory-50",
      title: "We could not find that payment",
      body: "This payment reference does not match anything on your account. If you were charged, contact Hallnect support with the reference from your bank statement.",
    },
    error: {
      icon: <AlertTriangle className="h-10 w-10 text-amber-600" aria-hidden />,
      tone: "border-amber-200 bg-amber-50",
      title: "We could not confirm this payment",
      body: "We could not reach the payment gateway to check. Please do NOT pay again — refresh this page in a moment, and contact Hallnect support if it does not resolve.",
    },
  }[result.state];

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Commission payment" notificationsHref="/owner/notifications" />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className={`mx-auto max-w-lg rounded-2xl border p-6 text-center shadow-card ${view.tone}`}>
          <div className="flex justify-center">{view.icon}</div>
          <h1 className="mt-3 font-serif text-lg font-bold text-charcoal-900">{view.title}</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-charcoal-600">{view.body}</p>
          <Link
            href="/owner/commissions"
            className={`${buttonVariants({ variant: "gold", size: "lg" })} mt-5`}
          >
            Back to commissions
          </Link>
        </div>
      </div>
    </div>
  );
}
