import { formatBookingDates, todayInBusinessTz } from "@/lib/dates";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowLeft, CalendarDays, CheckCircle2, Clock,
  CreditCard, FileText, MapPin, MessageSquare, Users, XCircle,
} from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { Badge } from "@/components/ui/Badge";
import {
  fetchBookingById, fetchMyReviewForHall, fetchInvoiceForBooking,
  CANCELLABLE_STATUSES, type CustomerBooking,
} from "@/lib/customer";
import { formatPrice } from "@/lib/mock-data";
import { CancelButton } from "./_components/CancelButton";
import { ReviewForm } from "./_components/ReviewForm";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const booking = await fetchBookingById(id);
  if (!booking) return {};
  return { title: `Booking — ${booking.hall_name}` };
}

// ── Status display config ─────────────────────────────────────────────────────

type BadgeV = "success" | "warning" | "secondary" | "destructive" | "default";
const STATUS_CFG: Record<string, { label: string; variant: BadgeV; description: string }> = {
  pending_payment:   { label: "Payment Pending", variant: "warning",     description: "Complete payment to confirm your booking." },
  payment_success:   { label: "Paid",            variant: "success",     description: "Payment received. Awaiting booking confirmation." },
  booking_requested: { label: "Requested",       variant: "default",     description: "Your booking request has been sent to the venue." },
  owner_confirmed:   { label: "Confirmed",       variant: "success",     description: "The venue has confirmed your booking. See you there!" },
  owner_rejected:    { label: "Rejected",        variant: "destructive", description: "The venue was unable to accept this booking." },
  cancelled:         { label: "Cancelled",       variant: "secondary",   description: "This booking was cancelled." },
  completed:         { label: "Completed",       variant: "secondary",   description: "Your event has taken place." },
  refunded:          { label: "Refunded",        variant: "secondary",   description: "Your payment has been refunded." },
};

// The ordered status progression (happy path)
const STATUS_STEPS: { key: string; label: string }[] = [
  { key: "pending_payment",   label: "Payment" },
  { key: "payment_success",   label: "Paid" },
  { key: "booking_requested", label: "Requested" },
  { key: "owner_confirmed",   label: "Confirmed" },
  { key: "completed",         label: "Done" },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}
function fmtSlot(slot: string) {
  return slot === "full_day" ? "Full Day" : slot === "morning" ? "Morning Slot" : "Evening Slot";
}
function fmtShortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function BookingDetailPage({ params }: Props) {
  const { id } = await params;

  // Security: fetchBookingById filters by customer_id = auth.uid() AND RLS enforces the same.
  // A booking belonging to another customer returns null → 404.
  const booking = await fetchBookingById(id);
  if (!booking) notFound();

  const [existingReview, invoice] = await Promise.all([
    booking.status === "completed"
      ? fetchMyReviewForHall(booking.hall_id)
      : Promise.resolve(null),
    fetchInvoiceForBooking(booking.id),
  ]);

  const cfg = STATUS_CFG[booking.status] ?? {
    label: booking.status, variant: "secondary" as BadgeV, description: "",
  };

  const isTerminal = ["cancelled", "owner_rejected", "refunded"].includes(booking.status);
  const currentStepIndex = isTerminal
    ? -1
    : STATUS_STEPS.findIndex((s) => s.key === booking.status);

  return (
    <div className="min-h-screen bg-ivory-100 pb-8">
      <AppHeader title="Booking Detail" showBack />

      {/* Mobile back button (visible when AppHeader back is hidden on desktop) */}
      <div className="hidden lg:flex items-center gap-2 px-8 pt-6 pb-2">
        <Link
          href="/customer/bookings"
          className="flex items-center gap-1.5 text-sm font-medium text-charcoal-600 hover:text-charcoal-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Bookings
        </Link>
      </div>

      <div className="px-4 py-4 sm:px-6 lg:px-8 space-y-4">

        {/* ── Hall header ──────────────────────────────────────────
            A SQUARE THUMBNAIL, not a full-width band. This was
            `h-36 w-full object-cover`, which measured 343x144 on a phone but
            864x144 from 1440 up — a 6:1 strip, because the height was pinned
            while the width followed the layout. object-cover then showed 9.4%
            of a portrait photo's height and 17% averaged over the nine real
            photos on the platform: the worst crop in the product, on the screen
            a customer lands on immediately after paying an advance. It was also
            a raw <img> with no srcset, so the full Supabase original — up to
            the 3060x4080, 1.1MB file — downloaded to fill a 144px strip.

            A band cannot be rescued by picking a better ratio: with
            object-cover, lifting a 9:16 photo above ~50% visible needs a box
            aspect near 1.0, and an 864x864 hero on a confirmation screen is
            absurd. A square thumbnail is orientation-agnostic (56% of a 9:16
            and of a 16:9 alike, 85% averaged over the nine), matches the
            pattern the bookings LIST uses one screen earlier, and lifts the
            status and the money higher up the page. */}
        <div className="rounded-2xl bg-white shadow-card overflow-hidden">
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                {/* Rendered ONLY when there is a photo. An always-present
                    coloured square would take 92px out of a 311px row at 375px
                    and say nothing; without it the heading reclaims the width. */}
                {booking.hall_cover_url && (
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-maroon-100 sm:h-28 sm:w-28">
                    <Image
                      src={booking.hall_cover_url}
                      /* alt="" — DECORATIVE. The <h1> beside this is the venue's
                         name; repeating it here makes a screen reader announce
                         it twice in a row. Same choice the bookings list makes
                         for the same thumbnail-beside-the-name pattern. */
                      alt=""
                      fill
                      /* 224/160, NOT 112/80 — and the difference is visible. object-cover scales until both axes are covered:
                         s = max(boxW/w, boxH/h). A SQUARE box is therefore
                         HEIGHT-bound for any landscape photo, so what has to be
                         sharp is not the box width but boxHeight x photoAspect
                         — 112 x 16/9 = 199px for the sm+ thumbnail, and
                         80 x 16/9 = 142px on mobile. Declaring the BOX WIDTH
                         instead makes the browser fetch the 112-wide candidate,
                         the optimizer returns 112x63 for a 16:9 cover, and cover
                         then blows it up 1.78x — worse than the band this
                         replaced. Declaring 224/160 picks the 256 candidate and
                         the worst case becomes 0.80x, a downscale for all nine
                         real photos at DPR 1, 2 and 3.

                         16/9 IS AN ASSUMPTION, not a guarantee — owners upload
                         what they like. The binding case is sm+ at DPR 3 (the
                         750 candidate against a 336px requirement), which holds
                         up to a source aspect of 2.23:1. A true panorama cover
                         would upscale about 1.34x; nothing in the current
                         inventory is wider than 1.78.

                         No vw token anywhere in the value, also deliberately:
                         Next's srcset generator only offers the small imageSizes
                         candidates (32-384) when `sizes` has no vw unit. With
                         one, the floor is 640 and this thumbnail would pull a
                         640-wide file. */
                      sizes="(min-width: 640px) 224px, 160px"
                      className="object-cover"
                    />
                </div>
                )}
                {/* break-words, NOT just min-w-0. min-w-0 is needed so the
                    flex child can shrink below its content, but it also removes
                    the min-content floor that used to keep this column wide
                    enough — after which a long compound venue name (Tamil names
                    are routinely one 17+ character word) overflowed its ~131px
                    column at 375px and painted underneath the status badge,
                    which has an opaque background and comes later in DOM order.
                    overflow-wrap is inherited, so one class here covers the
                    heading, the city line and the address. */}
                <div className="min-w-0 break-words">
                  <h1 className="font-serif text-lg font-bold text-charcoal-900">
                    {booking.hall_name}
                  </h1>
                  <p className="mt-0.5 flex items-center gap-1 text-sm text-charcoal-500">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-maroon-500" />
                    {booking.hall_city}{booking.hall_state ? `, ${booking.hall_state}` : ""}
                  </p>
                  {booking.hall_address && (
                    <p className="mt-0.5 text-xs text-charcoal-400">{booking.hall_address}</p>
                  )}
                </div>
              </div>
              <Badge variant={cfg.variant}>{cfg.label}</Badge>
            </div>
            {cfg.description && (
              <p className="mt-3 rounded-xl bg-ivory-100 px-3 py-2 text-xs text-charcoal-600">
                {cfg.description}
              </p>
            )}
          </div>
        </div>

        {/* ── Status timeline ─────────────────────────────────────── */}
        {!isTerminal ? (
          <div className="rounded-2xl bg-white shadow-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-charcoal-500">
              Progress
            </p>
            <div className="flex items-start gap-0">
              {STATUS_STEPS.map((step, i) => {
                const done   = i < currentStepIndex;
                const active = i === currentStepIndex;
                const last   = i === STATUS_STEPS.length - 1;
                return (
                  <div key={step.key} className="flex flex-1 flex-col items-center">
                    <div className="flex w-full items-center">
                      <div
                        className={
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold " +
                          (done || active
                            ? "bg-maroon-600 text-white"
                            : "bg-ivory-200 text-charcoal-400")
                        }
                      >
                        {done ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <span>{i + 1}</span>
                        )}
                      </div>
                      {!last && (
                        <div
                          className={
                            "h-0.5 flex-1 " +
                            (done ? "bg-maroon-600" : "bg-ivory-200")
                          }
                        />
                      )}
                    </div>
                    <p
                      className={
                        "mt-1.5 text-[10px] font-medium text-center leading-tight " +
                        (active ? "text-maroon-700" : done ? "text-charcoal-600" : "text-charcoal-400")
                      }
                    >
                      {step.label}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-white shadow-card p-4 flex items-center gap-3">
            <XCircle className="h-5 w-5 shrink-0 text-charcoal-400" />
            <p className="text-sm text-charcoal-600">{cfg.description}</p>
          </div>
        )}

        {/* ── Booking details ──────────────────────────────────────── */}
        <div className="rounded-2xl bg-white shadow-card p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
            Booking Details
          </p>
          <BookingRow
            icon={<CalendarDays className="h-4 w-4" />}
            label="Event Date"
            value={formatBookingDates(booking.event_date, booking.end_date)}
          />
          <BookingRow
            icon={<Clock className="h-4 w-4" />}
            label="Slot"
            value={fmtSlot(booking.slot)}
          />
          {booking.guest_count != null && (
            <BookingRow
              icon={<Users className="h-4 w-4" />}
              label="Guests"
              value={`${booking.guest_count.toLocaleString("en-IN")} guests`}
            />
          )}
          <BookingRow
            icon={<span className="text-[11px] font-bold text-charcoal-500">#</span>}
            label="Booking ID"
            value={<span className="font-mono text-xs">{booking.id.slice(0, 12).toUpperCase()}…</span>}
          />
          <BookingRow
            icon={<Clock className="h-4 w-4" />}
            label="Booked On"
            value={fmtShortDate(booking.created_at)}
          />
        </div>

        {/* ── Amount breakdown ─────────────────────────────────────── */}
        <div className="rounded-2xl bg-white shadow-card overflow-hidden">
          <p className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">
            Amount
          </p>
          {/* The customer pays the hall price + the flat ₹200 platform fee
              (disclosed at checkout, collected with the advance). Hallnect's
              internal commission is settled with the VENUE, never billed to
              the customer — so it is deliberately not a line here. */}
          <AmountRow label="Hall price" amount={booking.base_amount} />
          {booking.advance_amount != null && (
            // advance_amount is snapshotted when the booking is CREATED, before
            // any money moves — so it is only "paid" once a payment actually
            // succeeded. Otherwise it is the amount still payable.
            <AmountRow
              label={booking.payment?.status === "payment_success" ? "Advance paid" : "Advance payable"}
              amount={booking.advance_amount}
            />
          )}
          {booking.platform_fee_amount != null && (
            <AmountRow
              label={
                booking.platform_fee_amount > 0
                  ? "Platform fee"
                  : `Platform fee — waived${booking.coupon_code ? ` (${booking.coupon_code})` : ""}`
              }
              amount={booking.platform_fee_amount}
            />
          )}
          {/* Only when tax was actually charged. Bookings that predate GST
              registration carry null here, and a ₹0 tax line on them would
              imply a charge that was never made. */}
          {booking.platform_fee_gst != null && booking.platform_fee_gst > 0 && (
            <AmountRow label="GST on platform fee" amount={booking.platform_fee_gst} />
          )}
          <div className="border-t border-border px-4 py-3 bg-ivory-50">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-charcoal-900">Hall total</span>
              <span className="text-base font-bold text-maroon-700">
                {formatPrice(booking.total_amount)}
              </span>
            </div>
            {booking.advance_amount != null && (
              <p className="mt-1 text-[11px] text-charcoal-500">
                Balance {formatPrice(Math.max(0, booking.total_amount - booking.advance_amount))} is
                payable directly at the venue.
                {booking.platform_fee_amount != null && booking.platform_fee_amount > 0
                  ? " The platform fee is separate from the hall total and non-refundable."
                  : ""}
              </p>
            )}
          </div>

          {/* The GST invoice for Hallnect's fee. Rendered only when one has
              actually been issued — a link to a document that does not exist is
              worse than no link, and bookings that predate GST registration
              legitimately have none. */}
          {invoice ? (
            <div className="border-t border-border px-4 py-3">
              <Link
                href={`/invoice/${invoice.id}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-maroon-700 hover:underline"
              >
                <FileText className="h-4 w-4" aria-hidden="true" />
                Tax invoice {invoice.invoice_number}
              </Link>
              <p className="mt-1 text-[11px] text-charcoal-500">
                Covers the platform fee and its GST. The advance is the venue&apos;s
                supply and is not invoiced by Hallnect.
              </p>
            </div>
          ) : null}
        </div>

        {/* ── Payment ──────────────────────────────────────────────── */}
        {booking.payment && (
          <div className="rounded-2xl bg-white shadow-card p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
              Payment
            </p>
            <BookingRow
              icon={<CreditCard className="h-4 w-4" />}
              label="Total paid"
              value={formatPrice(booking.payment.amount)}
            />
            {booking.payment.advance_amount != null && booking.payment.platform_fee_amount != null && (
              <BookingRow
                icon={<CreditCard className="h-4 w-4" />}
                label="Breakdown"
                value={
                  booking.payment.platform_fee_amount > 0
                    ? `${formatPrice(booking.payment.advance_amount)} advance + ${formatPrice(booking.payment.platform_fee_amount)} platform fee`
                    : `${formatPrice(booking.payment.advance_amount)} advance · platform fee waived`
                }
              />
            )}
            {/* "Refunded" only when the money has ACTUALLY been sent.
                refund_amount is written the moment a cancellation records what
                is OWED, so labelling it "Refunded" told customers their money
                was already back while it was still sitting in Hallnect's
                account — the complaint that writes itself. */}
            {booking.payment.refund_amount != null && booking.payment.refund_amount > 0 && (
              <BookingRow
                icon={<CreditCard className="h-4 w-4" />}
                label={
                  booking.payment.refund_state === "completed" ? "Refunded"
                    : booking.payment.refund_state === "processing" ? "Refund in progress"
                    : "Refund due"
                }
                value={formatPrice(booking.payment.refund_amount)}
              />
            )}
            {booking.payment.payment_method && (
              <BookingRow
                icon={<CreditCard className="h-4 w-4" />}
                label="Method"
                value={booking.payment.payment_method}
              />
            )}
            <BookingRow
              icon={<Clock className="h-4 w-4" />}
              label="Date"
              value={fmtShortDate(booking.payment.created_at)}
            />
            <div className="flex items-center justify-between">
              <span className="text-sm text-charcoal-600">Status</span>
              <Badge
                variant={booking.payment.status === "payment_success" ? "success" : "warning"}
                size="sm"
              >
                {booking.payment.status.replace(/_/g, " ")}
              </Badge>
            </div>
          </div>
        )}

        {/* ── Owner notes ──────────────────────────────────────────── */}
        {booking.owner_notes && (
          <div className="rounded-2xl bg-white shadow-card p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">
              Message from Venue
            </p>
            <div className="flex items-start gap-2">
              <MessageSquare className="h-4 w-4 shrink-0 mt-0.5 text-charcoal-400" />
              <p className="text-sm text-charcoal-700 leading-relaxed">{booking.owner_notes}</p>
            </div>
          </div>
        )}

        {/* ── Customer notes ───────────────────────────────────────── */}
        {booking.customer_notes && (
          <div className="rounded-2xl bg-white shadow-card p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">
              Your Notes
            </p>
            <p className="text-sm text-charcoal-700 leading-relaxed">{booking.customer_notes}</p>
          </div>
        )}

        {/* ── Cancel booking ───────────────────────────────────────── */}
        {CANCELLABLE_STATUSES.has(booking.status) && (
          <div className="rounded-2xl bg-white shadow-card p-4">
            <CancelButton
              bookingId={booking.id}
              eventDate={booking.event_date}
              todayIso={todayInBusinessTz()}
              advancePaid={booking.payment?.advance_amount ?? booking.advance_amount}
              platformFeePaid={booking.payment?.platform_fee_amount ?? booking.platform_fee_amount}
            />
          </div>
        )}

        {/* ── Review ──────────────────────────────────────────────── */}
        {booking.status === "completed" && (
          <div className="rounded-2xl bg-white shadow-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-charcoal-500">
              Leave a Review
            </p>
            {existingReview ? (
              <div className="flex items-center gap-2 text-sm text-charcoal-600">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                You&apos;ve already reviewed this venue.{" "}
                <Link href="/customer/reviews" className="text-maroon-600 underline underline-offset-2">
                  View it
                </Link>
              </div>
            ) : (
              <ReviewForm
                hallId={booking.hall_id}
                bookingId={booking.id}
                hallName={booking.hall_name}
              />
            )}
          </div>
        )}

        {/* ── Hall link ────────────────────────────────────────────── */}
        {booking.hall_slug && (
          <Link
            href={`/halls/${booking.hall_slug}`}
            className="block rounded-2xl bg-white shadow-card p-4 text-center text-sm font-medium text-maroon-700 hover:bg-maroon-50"
          >
            View Hall Page →
          </Link>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function BookingRow({
  icon, label, value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ivory-100 text-charcoal-500">
        {icon}
      </span>
      <span className="flex-1 text-sm text-charcoal-600">{label}</span>
      <span className="text-sm font-semibold text-charcoal-900">{value}</span>
    </div>
  );
}

function AmountRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2.5 last:border-b-0">
      <span className="text-sm text-charcoal-600">{label}</span>
      <span className="text-sm text-charcoal-900">{formatPrice(amount)}</span>
    </div>
  );
}
