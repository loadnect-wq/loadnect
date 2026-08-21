import { formatBookingDates } from "@/lib/dates";
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, CalendarDays, Clock, Users } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerRow, fetchOwnerHalls, fetchOwnerBookings } from "@/lib/owner";
import { formatPrice } from "@/lib/mock-data";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { AppHeader } from "@/components/app/AppHeader";
import { BookingActions, ResponseDeadline } from "./_components/BookingActions";

export const metadata: Metadata = { title: "Bookings" };

type BadgeVar = "success" | "warning" | "secondary" | "destructive" | "default";

const STATUS_CFG: Record<string, { label: string; variant: BadgeVar }> = {
  pending_payment:   { label: "Payment Pending", variant: "warning"     },
  payment_success:   { label: "Paid",            variant: "success"     },
  booking_requested: { label: "New Request",     variant: "default"     },
  owner_confirmed:   { label: "Confirmed",       variant: "success"     },
  owner_rejected:    { label: "Rejected",        variant: "destructive" },
  cancelled:         { label: "Cancelled",       variant: "secondary"   },
  completed:         { label: "Completed",       variant: "secondary"   },
  refunded:          { label: "Refunded",        variant: "secondary"   },
};

const SLOT_LABELS: Record<string, string> = {
  full_day: "Full Day",
  morning:  "Morning",
  evening:  "Evening",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

type Props = { searchParams: Promise<{ tab?: string }> };

const TABS = [
  { key: "active",    label: "Active",    statuses: ["booking_requested", "owner_confirmed", "payment_success"] },
  { key: "past",      label: "Past",      statuses: ["completed", "cancelled", "owner_rejected", "refunded"]   },
  { key: "all",       label: "All",       statuses: []                                                          },
];

export default async function OwnerBookingsPage({ searchParams }: Props) {
  await requireRole(["owner_approved"]);
  const { tab: rawTab } = await searchParams;
  const currentTab = TABS.find((t) => t.key === rawTab) ?? TABS[0];

  const ownerRow = await fetchOwnerRow();
  if (!ownerRow) {
    return (
      <div className="min-h-screen bg-ivory-100">
        <AppHeader title="Bookings" />
        <div className="px-4 py-8">
          <EmptyState
            icon={<CalendarDays className="h-8 w-8" />}
            title="No business profile"
            description="Complete your owner profile to start receiving bookings."
            action={<Link href="/owner/profile" className={buttonVariants({ variant: "gold", size: "sm" })}>Complete Profile</Link>}
          />
        </div>
      </div>
    );
  }

  const halls   = await fetchOwnerHalls(ownerRow.id);
  const hallIds = halls.map((h) => h.id);

  // Fetch all bookings then filter client-side for tabs
  const allBookings = await fetchOwnerBookings(hallIds);
  const bookings = currentTab.statuses.length > 0
    ? allBookings.filter((b) => currentTab.statuses.includes(b.status))
    : allBookings;

  const pendingCount = allBookings.filter((b) => b.status === "booking_requested").length;

  // Conflict detection: a pending REQUEST whose dates overlap a booking that is
  // already committed on the same hall. Accepting it would double-book the
  // venue, so the owner is warned before they tap Accept. (The database still
  // refuses the overlap — this makes the refusal predictable instead of a
  // surprise error after the customer has been told yes.)
  const COMMITTED = new Set(["owner_confirmed", "completed"]);
  const conflictIds = new Set(
    allBookings
      .filter((b) => b.status === "booking_requested")
      .filter((req) =>
        allBookings.some(
          (other) =>
            other.id !== req.id &&
            other.hall_id === req.hall_id &&
            COMMITTED.has(other.status) &&
            // inclusive date-range overlap
            req.event_date <= other.end_date &&
            other.event_date <= req.end_date,
        ),
      )
      .map((b) => b.id),
  );

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Bookings" />

      <div className="px-4 py-4 sm:px-6 lg:px-8">
        {/* Tabs */}
        <div className="flex rounded-2xl bg-ivory-200 p-1 text-xs font-semibold mb-4">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`?tab=${t.key}`}
              className={[
                "flex-1 rounded-xl py-2 text-center relative",
                currentTab.key === t.key
                  ? "bg-white text-maroon-700 shadow-card"
                  : "text-charcoal-600",
              ].join(" ")}
            >
              {t.label}
              {t.key === "active" && pendingCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-maroon-600 text-[9px] font-bold text-white">
                  {pendingCount}
                </span>
              )}
            </Link>
          ))}
        </div>

        {bookings.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck className="h-8 w-8" />}
            title="No bookings"
            description={currentTab.key === "active"
              ? "No active booking requests. Approved halls show up in search."
              : "No bookings in this category yet."
            }
            size="sm"
          />
        ) : (
          <div className="space-y-3">
            {bookings.map((booking) => {
              const cfg = STATUS_CFG[booking.status] ?? { label: booking.status, variant: "secondary" as BadgeVar };
              return (
                <div key={booking.id} className="rounded-2xl bg-white shadow-card overflow-hidden">
                  <div className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-serif text-sm font-semibold text-charcoal-900 truncate">
                          {booking.hall_name}
                        </p>
                        <p className="mt-0.5 text-[11px] font-mono text-charcoal-400">
                          #{booking.id.slice(0, 8).toUpperCase()}
                        </p>
                      </div>
                      <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>
                    </div>

                    {/* Details grid */}
                    <div className="grid grid-cols-2 gap-2 text-xs text-charcoal-600">
                      <div className="flex items-center gap-1.5">
                        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-charcoal-400" />
                        {formatBookingDates(booking.event_date, booking.end_date)}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 shrink-0 text-charcoal-400" />
                        {SLOT_LABELS[booking.slot] ?? booking.slot}
                      </div>
                      {booking.guest_count && (
                        <div className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 shrink-0 text-charcoal-400" />
                          {booking.guest_count} guests
                        </div>
                      )}
                      <div className="font-semibold text-charcoal-900">
                        {formatPrice(booking.total_amount)}
                      </div>
                    </div>

                    {/* Money: what has actually reached Hallnect vs what the
                        owner still collects at the venue. Only a verified
                        gateway payment counts as received. */}
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-ivory-100 p-2.5 text-[11px] sm:grid-cols-3">
                      <div>
                        <p className="text-charcoal-500">Advance received</p>
                        <p className="font-semibold text-green-700">
                          {booking.amount_paid > 0 ? formatPrice(booking.amount_paid) : "Not paid yet"}
                        </p>
                      </div>
                      <div>
                        <p className="text-charcoal-500">Balance at venue</p>
                        <p className="font-semibold text-charcoal-900">
                          {formatPrice(Math.max(0, booking.total_amount - booking.amount_paid))}
                        </p>
                      </div>
                      {booking.contact_phone && (
                        <div>
                          <p className="text-charcoal-500">Customer</p>
                          <a
                            href={`tel:${booking.contact_phone}`}
                            className="font-semibold text-maroon-700 hover:underline"
                          >
                            {booking.contact_phone}
                          </a>
                        </div>
                      )}
                    </div>

                    {booking.status === "booking_requested" && (
                      <ResponseDeadline dueAt={booking.owner_response_due_at} />
                    )}

                    {booking.customer_notes && (
                      <p className="rounded-xl bg-ivory-100 px-3 py-2 text-xs text-charcoal-600 italic">
                        &ldquo;{booking.customer_notes}&rdquo;
                      </p>
                    )}

                    {booking.owner_notes && booking.status === "owner_rejected" && (
                      <p className="rounded-xl bg-red-50 px-3 py-2 text-[11px] text-red-800">
                        <span className="font-semibold">Your reason:</span> {booking.owner_notes}
                      </p>
                    )}

                    {/* Actions */}
                    <BookingActions
                      bookingId={booking.id}
                      status={booking.status}
                      customerLabel={booking.contact_phone ?? undefined}
                      hasConflict={conflictIds.has(booking.id)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
