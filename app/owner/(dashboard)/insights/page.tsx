// ─────────────────────────────────────────────────────────────────────────────
// /owner/insights — a month of Hallnect for the owner's halls (2026-10-14).
// How many families opened the page, how many asked, what came of it.
// Numbers are counts of real rows (lib/owner-insights.ts); a section whose
// read failed says so rather than showing a zero.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, ChevronLeft, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerRow, fetchOwnerHalls } from "@/lib/owner";
import { todayInBusinessTz } from "@/lib/dates";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { isMonthKey, monthLabel, monthOf, shiftMonth, summarise, type MonthKey } from "@/lib/owner-insights";
import { fetchInsightRows, firstCountedViewDate } from "@/lib/owner-insights.server";
import { Totals } from "./_components/InsightCards";

export const metadata: Metadata = { title: "Insights" };

type Props = { searchParams: Promise<{ month?: string }> };

export default async function OwnerInsightsPage({ searchParams }: Props) {
  await requireRole(["owner_approved"]);
  const ownerRow = await fetchOwnerRow();
  const thisMonth = monthOf(todayInBusinessTz());
  const asked = (await searchParams).month;
  // A future month has nothing in it yet; an unreadable one falls back to now.
  const month: MonthKey = isMonthKey(asked) && asked <= thisMonth ? asked : thisMonth;

  const halls = ownerRow ? await fetchOwnerHalls(ownerRow.id) : [];
  const live = halls.filter((h) => h.status === "approved");

  if (!ownerRow || live.length === 0) {
    return (
      <div className="min-h-screen bg-ivory-100">
        <AppHeader title="Insights" notificationsHref="/owner/notifications" heading />
        <div className="px-4 py-8">
          <EmptyState
            icon={<BarChart3 className="h-8 w-8" />}
            title="Insights start when a hall is live"
            description="Once our team approves your hall, you will see here how many families open its page, ask for a quote and book."
            action={<Link href="/owner/halls" className={buttonVariants({ variant: "gold", size: "sm" })}>My halls</Link>}
          />
        </div>
      </div>
    );
  }

  const hallIds = live.map((h) => h.id);
  const [rows, firstView] = await Promise.all([fetchInsightRows(hallIds, month), firstCountedViewDate(hallIds)]);
  const total = summarise(rows, hallIds);
  const perHall = live.length > 1 ? live.map((h) => ({ hall: h, s: summarise(rows, [h.id]) })) : [];
  const showBookings = halls.some((h) => h.booking_mode === "DIRECT_BOOKING") || (total.bookings?.count ?? 0) > 0;

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Insights" notificationsHref="/owner/notifications" heading />
      <div className="max-w-2xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        <nav aria-label="Month" className="flex items-center justify-between rounded-2xl bg-white p-2 shadow-card">
          <Link
            href={`/owner/insights?month=${shiftMonth(month, -1)}`}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-charcoal-700 hover:bg-ivory-100"
            aria-label={`Previous month, ${monthLabel(shiftMonth(month, -1))}`}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </Link>
          <h2 className="font-serif text-lg font-bold text-charcoal-900">{monthLabel(month)}</h2>
          {month < thisMonth ? (
            <Link
              href={`/owner/insights?month=${shiftMonth(month, 1)}`}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-charcoal-700 hover:bg-ivory-100"
              aria-label={`Next month, ${monthLabel(shiftMonth(month, 1))}`}
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </Link>
          ) : (
            <span className="min-w-[44px]" aria-hidden />
          )}
        </nav>

        <Totals s={total} month={month} firstView={firstView} showBookings={showBookings} />

        {perHall.length > 0 && (
          <section aria-labelledby="by-hall" className="rounded-2xl bg-white p-4 shadow-card">
            <h2 id="by-hall" className="text-base font-bold text-charcoal-900">By hall</h2>
            <ul className="mt-2 divide-y divide-border">
              {perHall.map(({ hall, s }) => (
                <li key={hall.id} className="py-2.5">
                  <p className="text-sm font-semibold text-charcoal-900">{hall.name}</p>
                  <p className="mt-0.5 text-xs text-charcoal-600">
                    {s.views ?? "—"} views · {s.enquiries?.received ?? "—"} enquiries · {s.enquiries?.booked ?? "—"} booked
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="px-1 text-[11px] leading-relaxed text-charcoal-500">
          Views count each browser once a day and leave out search engines and your own visits. Enquiries are counted in
          the month the family asked, then followed to where they stand now. Times are India time.
        </p>
      </div>
    </div>
  );
}
