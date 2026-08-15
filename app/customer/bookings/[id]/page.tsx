import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowLeft, CalendarDays, CheckCircle2, Clock,
  CreditCard, MapPin, MessageSquare, Users, XCircle,
} from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { Badge } from "@/components/ui/Badge";
import {
  fetchBookingById, fetchMyReviewForHall,
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

  const existingReview =
    booking.status === "completed"
      ? await fetchMyReviewForHall(booking.hall_id)
      : null;

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

        {/* ── Hall header ────────────────────────────────────────── */}
        <div className="rounded-2xl bg-white shadow-card overflow-hidden">
          {booking.hall_cover_url ? (
            <img
              src={booking.hall_cover_url}
              alt={booking.hall_name}
              className="h-36 w-full object-cover"
            />
          ) : (
            <div className="h-36 w-full bg-maroon-100" />
          )}
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
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
            value={fmtDate(booking.event_date)}
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
          <AmountRow label="Base amount"   amount={booking.base_amount}  />
          <AmountRow label="Platform fee"  amount={booking.platform_fee} />
          <div className="border-t border-border px-4 py-3 bg-ivory-50">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-charcoal-900">Total</span>
              <span className="text-base font-bold text-maroon-700">
                {formatPrice(booking.total_amount)}
              </span>
            </div>
          </div>
        </div>

        {/* ── Payment ──────────────────────────────────────────────── */}
        {booking.payment && (
          <div className="rounded-2xl bg-white shadow-card p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
              Payment
            </p>
            <BookingRow
              icon={<CreditCard className="h-4 w-4" />}
              label="Paid"
              value={formatPrice(booking.payment.amount)}
            />
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
            <CancelButton bookingId={booking.id} />
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
