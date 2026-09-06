// ─────────────────────────────────────────────────────────────────────────────
// app/booking/[id]/status/page.tsx
// Post-payment booking status page (Cashfree return_url target).
//
// SECURITY — the redirect is NOT trusted:
//   When the customer lands here after checkout, we call verifyAndApplyPayment()
//   which queries Cashfree's order API SERVER-SIDE and only then moves the
//   booking to `payment_success`.  A user manually visiting this URL with a fake
//   ?order_id cannot confirm a booking — the order id must match a real payment
//   row AND Cashfree must report it PAID.
//
//   AUTHORISE, THEN APPLY.  ?order_id is chosen by whoever opens the URL, and it
//   decides which booking verifyAndApplyPayment acts on — the one in the path
//   does not.  So the booking is loaded and authorised FIRST (fetchBookingById
//   scopes to auth.uid(), with RLS behind it), and the order is only applied if
//   it belongs to that same booking.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { noindexMetadata } from "@/lib/seo/metadata";
import {
  CheckCircle2, Clock, AlertTriangle, XCircle, RefreshCw, CreditCard,
} from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { getSession } from "@/lib/auth";
import { fetchBookingById } from "@/lib/customer";
import { verifyAndApplyPayment, type ApplyPaymentState } from "@/lib/payments";
import { formatPrice } from "@/lib/mock-data";
import { AdSlot } from "@/components/ads/AdSlot";

// SEO: private/transactional page — must never be indexed.
export const metadata: Metadata = noindexMetadata("Booking Status");

type Props = {
  params:       Promise<{ id: string }>;
  searchParams: Promise<{ order_id?: string | string[] }>;
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

export default async function BookingStatusPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const orderId = Array.isArray(sp.order_id) ? sp.order_id[0] : sp.order_id;

  // Auth required.
  const user = await getSession();
  if (!user) redirect(`/login?next=/booking/${id}/status`);

  // ── Authorisation FIRST, before anything is applied ─────────────────────────
  // This read is the gate, not just the display query: RLS + customer_id scoping
  // mean it returns a row only for the customer the booking belongs to. It ran
  // AFTER verification until now, so ?order_id was applied before the page knew
  // whose booking it had been handed — any signed-in visitor could name a
  // stranger's order and have its side effects (the payment_failed stamp, the
  // refund_state='owed' write, that customer's cancellation and failure
  // messages) run against a booking that was never theirs.
  let booking = await fetchBookingById(id);
  if (!booking) notFound();

  // ── Server-side verification (the authoritative step) ───────────────────────
  // expectedBookingId keeps the order and the authorised booking tied together:
  // the return_url Cashfree sends the customer back to always carries this
  // booking's own order (lib/payments.ts builds it that way), so the legitimate
  // return-from-gateway flow is untouched, and only a hand-edited order_id is
  // refused.
  let verifyState: ApplyPaymentState | null = null;
  let verifyMessage: string | undefined;
  if (orderId) {
    try {
      const result = await verifyAndApplyPayment(orderId, { expectedBookingId: id });
      verifyState   = result.state;
      verifyMessage = result.message;
    } catch (e) {
      console.error("[booking-status] verification failed:", e);
      verifyState = "error";
    }
    // Verification is what moves the booking to booking_requested, so re-read
    // it: the row fetched above was the one we authorised against, taken before
    // the write, and rendering that would show "Payment pending" to a customer
    // whose payment had just been applied.
    booking = (await fetchBookingById(id)) ?? booking;
  }

  const paid =
    booking.status === "payment_success" ||
    booking.status === "booking_requested" ||
    booking.status === "owner_confirmed" ||
    booking.status === "completed";

  const stillPending = booking.status === "pending_payment";
  const conflicted   = verifyState === "slot_conflict" || booking.status === "cancelled";

  // Pick the headline UI state.
  const ui = paid
    ? {
        icon:  <CheckCircle2 className="h-9 w-9" />,
        ring:  "bg-green-100 text-green-600",
        badge: <Badge variant="success">Payment successful</Badge>,
        title: "Payment received",
        body:  "Your advance is in. The venue now has 48 hours to accept — we will let you know as soon as they do. Your booking is not confirmed until they accept, and if they do not respond in time you are refunded in full, including the platform fee.",
      }
    : conflicted
      ? {
          icon:  <AlertTriangle className="h-9 w-9" />,
          ring:  "bg-amber-100 text-amber-600",
          badge: <Badge variant="warning">Refund due</Badge>,
          title: "Slot was just taken",
          body:  verifyMessage ?? "This slot was booked by someone else first. If you were charged, a refund will be initiated.",
        }
      : verifyState === "failed"
        ? {
            icon:  <XCircle className="h-9 w-9" />,
            ring:  "bg-red-100 text-red-600",
            badge: <Badge variant="destructive">Payment failed</Badge>,
            title: "Payment not completed",
            body:  verifyMessage ?? "Your payment did not go through. You can try again.",
          }
        // UNRESOLVED, NOT UNPAID. `error` and `not_found` used to fall through
        // to "Payment pending — we haven't received your payment yet", which is
        // a statement we cannot support: `error` is returned for any non-2xx or
        // network blip while verifying, AND for an amount mismatch where money
        // WAS captured. Telling that customer they have not paid, next to a
        // "Try payment again" button, is how one becomes two charges.
        : (verifyState === "error" || verifyState === "not_found")
          ? {
              icon:  <Clock className="h-9 w-9" />,
              ring:  "bg-amber-100 text-amber-600",
              badge: <Badge variant="warning">Confirming</Badge>,
              title: "We're confirming your payment",
              body:  verifyMessage
                ?? "We could not confirm this payment just yet. If money left your account, do NOT pay again — refresh this page in a minute, and contact Hallnect support if it has not cleared.",
            }
          : {
              icon:  <Clock className="h-9 w-9" />,
              ring:  "bg-amber-100 text-amber-600",
              badge: <Badge variant="warning">Awaiting payment</Badge>,
              title: "Payment pending",
              body:  "We haven't received your payment yet. If you just paid, refresh in a moment — confirmation can take a few seconds.",
            };

  // The retry button MUST NOT render while the outcome is unknown — that is the
  // exact state in which a captured payment can be paid for a second time.
  const safeToRetry = stillPending
    && verifyState !== "error"
    && verifyState !== "not_found";

  return (
    <div className="min-h-screen bg-ivory-100 pb-10">
      <AppHeader title="Booking Status" />

      <div className="container-app pt-6 lg:max-w-xl space-y-4">

        {/* Headline */}
        <div className="rounded-2xl bg-white p-6 text-center shadow-card">
          <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${ui.ring}`}>
            {ui.icon}
          </div>
          <div className="mt-4 flex justify-center">{ui.badge}</div>
          <h1 className="mt-3 font-serif text-xl font-bold text-charcoal-900">{ui.title}</h1>
          <p className="mt-1.5 text-sm text-charcoal-600">{ui.body}</p>
        </div>

        {/* Booking summary */}
        <div className="rounded-2xl bg-white p-4 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Booking</p>
          <p className="mt-1 font-serif text-base font-bold text-charcoal-900">{booking.hall_name}</p>
          <p className="text-sm text-charcoal-600">{fmtDate(booking.event_date)}</p>
          <p className="mt-1 font-mono text-[11px] text-charcoal-500">
            #{booking.id.slice(0, 8).toUpperCase()}
          </p>

          <div className="mt-3 border-t border-border pt-3 space-y-1.5">
            <Line label="Hall total" value={formatPrice(booking.total_amount)} />
            {booking.payment && (
              <>
                {/* payment.amount is the FULL charge (advance + ₹200 platform
                    fee) on new bookings — labelling it "advance paid" would
                    have the customer settle ₹200 too little at the venue.
                    Legacy payments have no breakdown and their amount WAS the
                    advance, so they keep the single line. */}
                {booking.payment.advance_amount != null ? (
                  <>
                    <Line label="Advance paid" value={formatPrice(booking.payment.advance_amount)} strong={paid} />
                    <Line
                      label={Number(booking.payment.platform_fee_amount ?? 0) > 0
                        ? "Platform fee"
                        : "Platform fee (waived)"}
                      value={formatPrice(booking.payment.platform_fee_amount ?? 0)}
                    />
                    <Line label="Total paid" value={formatPrice(booking.payment.amount)} strong={paid} />
                  </>
                ) : (
                  <Line label="Advance paid" value={formatPrice(booking.payment.amount)} strong={paid} />
                )}
              </>
            )}
            {booking.payment && (
              <div className="flex items-center justify-between pt-1 text-sm">
                <span className="flex items-center gap-1.5 text-charcoal-600">
                  <CreditCard className="h-3.5 w-3.5" /> Payment
                </span>
                <Badge
                  size="sm"
                  variant={booking.payment.status === "payment_success" ? "success" : "warning"}
                >
                  {booking.payment.status.replace(/_/g, " ")}
                </Badge>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2">
          {safeToRetry && booking.hall_slug && (
            <Link href={`/book/${booking.hall_slug}`} className="col-span-2">
              <Button variant="gold" className="w-full">Try payment again</Button>
            </Link>
          )}

          {stillPending && (
            <Link href={`/booking/${booking.id}/status${orderId ? `?order_id=${orderId}` : ""}`} className="col-span-2">
              <Button variant="outline" className="w-full">
                <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh status
              </Button>
            </Link>
          )}

          <Link href={`/customer/bookings/${booking.id}`}>
            <Button variant="outline" className="w-full">Booking details</Button>
          </Link>
          <Link href="/customer/bookings">
            <Button variant={paid ? "gold" : "outline"} className="w-full">My bookings</Button>
          </Link>
        </div>

        <p className="px-2 text-center text-[11px] text-charcoal-400">
          Payments are verified securely on our server with Cashfree. Your booking is
          confirmed only after that verification — never from this page alone.
        </p>

        {paid && <AdSlot placement="booking_confirmation" limit={1} />}
      </div>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-charcoal-600">{label}</span>
      <span className={strong ? "font-bold text-maroon-700" : "font-semibold text-charcoal-900"}>
        {value}
      </span>
    </div>
  );
}
