// ─────────────────────────────────────────────────────────────────────────────
// app/booking/[id]/status/page.tsx
// Post-payment booking status page (Cashfree return_url target).
//
// SECURITY — the redirect is NOT trusted:
//   When the customer lands here after checkout, we call verifyAndApplyPayment()
//   which queries Cashfree's order API SERVER-SIDE and only then moves the
//   booking to `payment_success`.  A user manually visiting this URL with a fake
//   ?order_id cannot confirm a booking — the order id must match a real payment
//   row AND Cashfree must report it PAID.  fetchBookingById additionally enforces
//   that the booking belongs to the signed-in customer (RLS + customer_id).
// ─────────────────────────────────────────────────────────────────────────────

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
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

export const metadata: Metadata = { title: "Booking Status" };

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

  // ── Server-side verification (the authoritative step) ───────────────────────
  let verifyState: ApplyPaymentState | null = null;
  let verifyMessage: string | undefined;
  if (orderId) {
    try {
      const result = await verifyAndApplyPayment(orderId);
      verifyState   = result.state;
      verifyMessage = result.message;
    } catch (e) {
      console.error("[booking-status] verification failed:", e);
      verifyState = "error";
    }
  }

  // Load the (now-updated) booking for display. RLS + customer_id scoping ensure
  // a customer can only ever see their own booking.
  const booking = await fetchBookingById(id);
  if (!booking) notFound();

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
        title: "Payment confirmed!",
        body:  "Your advance has been received and your booking is confirmed. The venue will review your request.",
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
        : {
            icon:  <Clock className="h-9 w-9" />,
            ring:  "bg-amber-100 text-amber-600",
            badge: <Badge variant="warning">Awaiting payment</Badge>,
            title: "Payment pending",
            body:  "We haven't received your payment yet. If you just paid, refresh in a moment — confirmation can take a few seconds.",
          };

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
                    <Line label="Platform fee" value={formatPrice(booking.payment.platform_fee_amount ?? 0)} />
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
          {stillPending && booking.hall_slug && (
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
