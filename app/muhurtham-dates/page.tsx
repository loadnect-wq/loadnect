// ─────────────────────────────────────────────────────────────────────────────
// /muhurtham-dates — Tamil wedding muhurtham dates, with how many halls on
// Hallnect already have each one booked. The Tamil twin is /ta/muhurtham-dates;
// the two name each other with hreflang. Everything is in
// components/muhurtham/MuhurthamPage.tsx.
//
// A CONTENT PAGE, indexable whenever it lists a date. It does not depend on
// inventory the way city pages do: the dates are useful on their own, and the
// booked counts are an addition, not the page.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { MuhurthamPage, MUHURTHAM_PATH, muhurthamLanguageAlternates, muhurthamMeta } from "@/components/muhurtham/MuhurthamPage";
import { buildMetadata } from "@/lib/seo/metadata";
import { todayInBusinessTz } from "@/lib/dates";
import { upcomingMuhurthamDates } from "@/lib/muhurtham";
import { fetchMuhurthamBookings } from "@/lib/muhurtham.server";

// Counts move as venues fill their diaries; ten minutes keeps them fresh
// without a database round trip per visitor. "Today" can lag by the same ten
// minutes, which only matters in the ten minutes after midnight.
export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  const { title, description, hasDates } = muhurthamMeta("en", todayInBusinessTz());
  return buildMetadata({
    title,
    description,
    path: MUHURTHAM_PATH.en,
    indexable: hasDates,
    languages: muhurthamLanguageAlternates(),
  });
}

export default async function MuhurthamDatesPage() {
  const today = todayInBusinessTz();
  const bookings = await fetchMuhurthamBookings(upcomingMuhurthamDates(today));
  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Muhurtham dates" />
      <MuhurthamPage lang="en" today={today} bookings={bookings} />
    </div>
  );
}
