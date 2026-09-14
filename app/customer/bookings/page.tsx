import { formatBookingDates } from "@/lib/dates";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CalendarCheck, ChevronRight, Clock, Inbox, MapPin } from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import { fetchMyBookings, type BookingTab } from "@/lib/customer";
import { formatPrice } from "@/lib/mock-data";

export const metadata: Metadata = { title: "My Bookings" };

type BadgeVariant = "success" | "warning" | "secondary" | "destructive" | "default";

const STATUS_CONFIG: Record<string, { label: string; variant: BadgeVariant }> = {
  pending_payment:   { label: "Payment Pending", variant: "warning"     },
  payment_success:   { label: "Paid",            variant: "success"     },
  booking_requested: { label: "Requested",       variant: "default"     },
  owner_confirmed:   { label: "Confirmed",       variant: "success"     },
  owner_rejected:    { label: "Rejected",        variant: "destructive" },
  cancelled:         { label: "Cancelled",       variant: "secondary"   },
  completed:         { label: "Completed",       variant: "secondary"   },
  refunded:          { label: "Refunded",        variant: "secondary"   },
};

function fmtSlot(slot: string) {
  return slot === "full_day" ? "Full Day" : slot === "morning" ? "Morning" : "Evening";
}

type Props = { searchParams: Promise<{ tab?: string }> };

export default async function CustomerBookingsPage({ searchParams }: Props) {
  const { tab: rawTab } = await searchParams;
  const tab = (["upcoming", "past", "all"].includes(rawTab ?? "")
    ? rawTab
    : "upcoming") as BookingTab;

  const bookings = await fetchMyBookings(tab);

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="My Bookings" />

      {/* ENQUIRIES LIVE NEXT DOOR, and this link is how a phone user reaches
          them at all: the tab bar is capped at five and cannot carry a sixth,
          so without this a customer who sent an enquiry had no route back to
          it on mobile. Shown unconditionally rather than only when they have
          one — a customer looking for an enquiry they sent needs the signpost
          most when the list they are staring at does not contain it. */}
      <div className="px-4 pt-3 sm:px-6 lg:px-8">
        <Link
          href="/customer/enquiries"
          className="flex items-center gap-2.5 rounded-2xl border border-border bg-white px-3.5 py-2.5 shadow-card active:bg-ivory-50"
        >
          <Inbox className="h-4 w-4 shrink-0 text-maroon-600" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-charcoal-900">My enquiries</span>
            <span className="block text-[11px] text-charcoal-500">
              Requests you sent to venues that take enquiries
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-charcoal-400" aria-hidden />
        </Link>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-3 sm:px-6 lg:px-8">
        <div className="flex rounded-2xl bg-ivory-200 p-1 text-xs font-semibold">
          {(["upcoming", "past", "all"] as BookingTab[]).map((t) => (
            <Link
              key={t}
              href={`?tab=${t}`}
              className={
                "flex-1 rounded-xl py-2 text-center capitalize " +
                (tab === t
                  ? "bg-white text-maroon-700 shadow-card"
                  : "text-charcoal-600")
              }
            >
              {t}
            </Link>
          ))}
        </div>
      </div>

      <section className="px-4 py-4 sm:px-6 lg:px-8">
        {bookings.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck className="h-8 w-8" />}
            title={tab === "upcoming" ? "No upcoming bookings" : "No bookings found"}
            description="Find a venue and your bookings will appear here."
            action={
              <Link href="/halls" className={buttonVariants({ variant: "gold", size: "sm" })}>
                Browse Halls
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {bookings.map((b) => {
              const cfg = STATUS_CONFIG[b.status] ?? { label: b.status, variant: "secondary" as BadgeVariant };
              return (
                <li key={b.id}>
                  <Link
                    href={`/customer/bookings/${b.id}`}
                    className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card active:scale-[0.99] transition-transform"
                  >
                    {/* Hall thumbnail */}
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-maroon-50">
                      {b.hall_cover_url && (
                        // next/image, not <img>: these covers are full-size venue photos
                        // in Supabase storage, and a raw <img> downloaded every megabyte
                        // of one to paint it 56px wide.
                        <Image
                          src={b.hall_cover_url}
                          alt=""
                          fill
                          sizes="56px"
                          className="object-cover"
                        />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 font-serif text-sm font-semibold text-charcoal-900">
                        {b.hall_name}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-charcoal-500">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {b.hall_city}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-charcoal-500">
                        <Clock className="h-3 w-3 shrink-0" />
                        {formatBookingDates(b.event_date, b.end_date)} · {fmtSlot(b.slot)}
                      </p>
                      <p className="mt-1 text-[11px] font-bold text-charcoal-800">
                        {formatPrice(b.total_amount)}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>
                      <ChevronRight className="h-4 w-4 text-charcoal-400" />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
