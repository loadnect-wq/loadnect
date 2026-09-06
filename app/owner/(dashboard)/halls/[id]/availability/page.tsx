import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerHall } from "@/lib/owner";
import { fetchOwnerCalendar } from "@/lib/owner-calendar";
import { fetchOfflineBookings } from "@/lib/offline-bookings";
import { todayInBusinessTz, addDaysToIsoDate, formatBookingDates } from "@/lib/dates";
import { AppHeader } from "@/components/app/AppHeader";
import { InventoryCalendar } from "./_components/InventoryCalendar";

export const metadata: Metadata = { title: "Availability" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ m?: string }>;
};

// ── Month arithmetic on the ISO string itself ────────────────────────────────
// Never via Date: `new Date(y, m, 1)` is constructed in the SERVER's timezone,
// and every date this page renders has to be the one an owner in India sees.
// lib/dates.ts exists because that mistake was already shipped once here.

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Last day of a month, found by stepping back one day from the next month. */
function monthEnd(key: string): string {
  return addDaysToIsoDate(`${addMonths(key, 1)}-01`, -1);
}

// One month back so a venue can reconcile last month's diary, twelve forward
// because that is how far ahead weddings are actually booked. Bounded so the
// month parameter cannot be walked to year 9999 and made to fetch nothing
// expensive but pointless.
const MONTHS_BACK = 1;
const MONTHS_FORWARD = 11;

export default async function AvailabilityPage({ params, searchParams }: Props) {
  await requireRole(["owner_approved"]);
  const { id } = await params;
  const { m } = await searchParams;

  const hall = await fetchOwnerHall(id);
  if (!hall) notFound();

  const today = todayInBusinessTz();
  const thisMonth = today.slice(0, 7);
  const earliest = addMonths(thisMonth, -MONTHS_BACK);
  const latest = addMonths(thisMonth, MONTHS_FORWARD);

  // Clamped rather than 404'd: a bookmarked link to a month that has since
  // scrolled out of range should land the owner somewhere useful.
  let month = m && MONTH_KEY.test(m) ? m : thisMonth;
  if (month < earliest) month = earliest;
  if (month > latest) month = latest;

  const [days, offline] = await Promise.all([
    fetchOwnerCalendar(id, `${month}-01`, monthEnd(month)),
    fetchOfflineBookings(id),
  ]);

  const upcoming = offline.filter((o) => o.end_date >= today).slice(0, 12);

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Availability" notificationsHref="/owner/notifications" />

      <div className="max-w-2xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        <div>
          <h1 className="font-serif text-xl font-bold text-charcoal-900">{hall.name}</h1>
          <p className="mt-0.5 text-sm text-charcoal-500">
            Every date is bookable unless something holds it. You only need to come
            here when you take a booking off Hallnect — tap the date and block it.
          </p>
        </div>

        <InventoryCalendar
          hallId={id}
          monthStart={`${month}-01`}
          days={days}
          today={today}
          prevMonth={month > earliest ? addMonths(month, -1) : null}
          nextMonth={month < latest ? addMonths(month, 1) : null}
        />

        {upcoming.length > 0 && (
          <section className="rounded-2xl bg-white p-4 shadow-card">
            <h2 className="text-sm font-bold text-charcoal-900">Your offline bookings</h2>
            <p className="mt-0.5 text-xs text-charcoal-500">
              Everything you have blocked from today onwards. Open the month to release one.
            </p>
            <ul className="mt-3 divide-y divide-border">
              {upcoming.map((o) => (
                <li key={o.id} className="py-2">
                  <Link
                    href={`/owner/halls/${id}/availability?m=${o.event_date.slice(0, 7)}`}
                    className="flex items-baseline justify-between gap-3 hover:underline"
                  >
                    <span className="text-sm font-semibold text-charcoal-900">
                      {formatBookingDates(o.event_date, o.end_date)}
                    </span>
                    <span className="shrink-0 text-xs text-charcoal-500">
                      {o.customer_name || "No name"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="rounded-2xl bg-white p-4 text-xs leading-relaxed text-charcoal-500 shadow-card">
          <strong className="text-charcoal-700">A green date is not a reservation.</strong>{" "}
          It means nothing held that date when this page was drawn. If a customer is
          paying for it at this moment, Hallnect will refuse whichever of you is second —
          the database decides, not this screen. That is also why there is nothing to
          save here: every change takes effect the instant you make it.
        </p>

        <Link
          href={`/owner/halls/${id}/edit`}
          className="flex items-center gap-1 text-sm text-charcoal-500 hover:text-charcoal-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to edit
        </Link>
      </div>
    </div>
  );
}
