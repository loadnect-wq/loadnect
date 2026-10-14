// The Insights cards (/owner/insights). Server-rendered, presentational only:
// the page reads the rows and passes the month's summary in.

import Link from "next/link";
import { CalendarCheck, Eye, Inbox, IndianRupee, QrCode, Star } from "lucide-react";
import { formatDiaryDay } from "@/lib/diary";
import { formatPrice } from "@/lib/mock-data";
import { monthOf, replyTimeLabel, type HallInsights, type MonthKey } from "@/lib/owner-insights";

function Unavailable() {
  return <p className="mt-1 text-sm text-charcoal-500">Couldn&apos;t load this just now. Refresh to try again.</p>;
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl bg-ivory-50 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">{label}</p>
      <p className="mt-0.5 font-serif text-2xl font-bold text-charcoal-900">{value}</p>
      {sub && <p className="text-[11px] text-charcoal-500">{sub}</p>}
    </div>
  );
}

function Card({ id, title, icon, children }: { id: string; title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-2xl bg-white p-4 shadow-card">
      <h2 id={id} className="flex items-center gap-2 text-base font-bold text-charcoal-900">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Totals({ s, month, firstView, showBookings }: { s: HallInsights; month: MonthKey; firstView: string | null; showBookings: boolean }) {
  const e = s.enquiries;
  // Views began being counted on 14 Oct 2026. A month before the first counted
  // day would show a misleading 0, so it says so instead.
  const countingStartedLater = firstView === null || monthOf(firstView) > month;
  return (
    <>
      <Card id="views" title="Families who opened your page" icon={<Eye className="h-4 w-4 text-maroon-600" aria-hidden />}>
        {s.views === null ? <Unavailable /> : countingStartedLater && s.views === 0 ? (
          <p className="mt-1 text-sm text-charcoal-600">
            {firstView
              ? `Views were not counted yet in this month. Counting started on ${formatDiaryDay("en", firstView, { year: true })}.`
              : "No views counted yet. They appear here from the day families start opening your page."}
          </p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Stat label="Page views" value={s.views.toLocaleString("en-IN")} />
            <Stat label="QR standee scans" value={s.qrScans === null ? "—" : s.qrScans.toLocaleString("en-IN")} />
          </div>
        )}
        {firstView && !countingStartedLater && monthOf(firstView) === month && (
          <p className="mt-2 text-[11px] text-charcoal-500">Counting started on {formatDiaryDay("en", firstView, { year: true })}.</p>
        )}
      </Card>

      <Card id="enquiries" title="Enquiries" icon={<Inbox className="h-4 w-4 text-maroon-600" aria-hidden />}>
        {e === null ? <Unavailable /> : e.received === 0 ? (
          <p className="mt-1 text-sm text-charcoal-600">No enquiries this month.</p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Received" value={e.received} />
              <Stat label="Quoted" value={e.quoted} />
              <Stat label="Accepted" value={e.accepted} />
              <Stat label="Booked" value={e.booked} />
            </div>
            <ul className="mt-3 space-y-1 text-sm text-charcoal-700">
              {e.awaitingReply > 0 && (
                <li>
                  <Link href="/owner/leads" className="font-semibold text-maroon-700 hover:underline">
                    {e.awaitingReply} waiting for your quote
                  </Link>
                </li>
              )}
              {e.medianReplyHours !== null && <li>Your typical reply time: {replyTimeLabel(e.medianReplyHours)}</li>}
              {e.declined > 0 && <li>{e.declined} you declined</li>}
              {e.expired > 0 && <li>{e.expired} expired without a reply</li>}
            </ul>
          </>
        )}
      </Card>

      <Card id="visits" title="Site visits" icon={<CalendarCheck className="h-4 w-4 text-maroon-600" aria-hidden />}>
        {s.visits === null ? <Unavailable /> : (
          <p className="mt-1 text-sm text-charcoal-700">
            {s.visits.requested === 0
              ? "No visit requests this month."
              : `${s.visits.requested} asked to see your hall · ${s.visits.confirmed} confirmed`}
          </p>
        )}
      </Card>

      <Card id="reviews" title="Reviews" icon={<Star className="h-4 w-4 text-maroon-600" aria-hidden />}>
        {s.reviews === null ? <Unavailable /> : (
          <p className="mt-1 text-sm text-charcoal-700">
            {s.reviews.count === 0
              ? "No new reviews this month."
              : `${s.reviews.count} new review${s.reviews.count === 1 ? "" : "s"} · average ${s.reviews.average!.toFixed(1)} of 5`}
          </p>
        )}
      </Card>

      {showBookings && (
        <Card id="bookings" title="Online bookings" icon={<IndianRupee className="h-4 w-4 text-maroon-600" aria-hidden />}>
          {s.bookings === null ? <Unavailable /> : (
            <p className="mt-1 text-sm text-charcoal-700">
              {s.bookings.count === 0
                ? "No online bookings this month."
                : `${s.bookings.count} booking${s.bookings.count === 1 ? "" : "s"} · ${formatPrice(s.bookings.value)} in hall bookings`}
            </p>
          )}
        </Card>
      )}

      <p className="flex items-center gap-1.5 px-1 text-xs text-charcoal-500">
        <QrCode className="h-3.5 w-3.5" aria-hidden />
        Print your hall&apos;s QR standee from <Link href="/owner/halls" className="font-semibold text-maroon-700 hover:underline">My Halls</Link> to count walk-ins too.
      </p>
    </>
  );
}
