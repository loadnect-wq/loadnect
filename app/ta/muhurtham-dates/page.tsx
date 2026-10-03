// ─────────────────────────────────────────────────────────────────────────────
// /ta/muhurtham-dates — the Tamil twin of /muhurtham-dates. Same data, same
// rules, paired by hreflang. "முகூர்த்த நாட்கள்" is searched far more than its
// English form, and against far fewer pages that also say which halls are
// already booked.
//
// The root layout's <html> is en-IN, so the wrapper carries lang="ta". Inter
// stays first in the font stack for Latin and digits; Tamil falls through to
// the self-hosted Noto Sans Tamil (app/fonts/noto-sans-tamil/font.ts — never
// next/font/google, which broke a production build).
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { MuhurthamPage, MUHURTHAM_PATH, muhurthamLanguageAlternates, muhurthamMeta } from "@/components/muhurtham/MuhurthamPage";
import { notoSansTamil } from "@/app/fonts/noto-sans-tamil/font";
import { buildMetadata } from "@/lib/seo/metadata";
import { todayInBusinessTz } from "@/lib/dates";
import { upcomingMuhurthamDates } from "@/lib/muhurtham";
import { fetchMuhurthamBookings } from "@/lib/muhurtham.server";

export const revalidate = 600;

const FONT_STACK = "var(--font-inter), var(--font-tamil), system-ui, sans-serif";

export async function generateMetadata(): Promise<Metadata> {
  const { title, description, hasDates } = muhurthamMeta("ta", todayInBusinessTz());
  return buildMetadata({
    title,
    description,
    path: MUHURTHAM_PATH.ta,
    indexable: hasDates,
    languages: muhurthamLanguageAlternates(),
    locale: "ta_IN",
  });
}

export default async function TamilMuhurthamDatesPage() {
  const today = todayInBusinessTz();
  const bookings = await fetchMuhurthamBookings(upcomingMuhurthamDates(today));
  return (
    <div lang="ta" className={`${notoSansTamil.variable} min-h-screen bg-ivory-100`} style={{ fontFamily: FONT_STACK }}>
      <AppHeader title="முகூர்த்த நாட்கள்" />
      <MuhurthamPage lang="ta" today={today} bookings={bookings} />
    </div>
  );
}
