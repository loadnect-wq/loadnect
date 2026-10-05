// ─────────────────────────────────────────────────────────────────────────────
// The muhurtham dates page, in English (/muhurtham-dates) or Tamil
// (/ta/muhurtham-dates). A server component; both routes are thin wrappers.
//
// WHY. A Tamil wedding starts with a date from the family astrologer, and
// families look these dates up constantly — in English and in Tamil. Every
// calendar site lists them; this list also says how many halls on Hallnect
// already have each date booked, with a one-tap search for halls that day.
// Nobody else can show that, because nobody else holds the venues' diaries.
//
// HONESTY RULES, enforced here and in lib/muhurtham.server.ts:
//   * counts are BOOKED, never "free" — a hall not keeping its diary here may
//     be taken, and the page says each hall confirms the date;
//   * a failed count read shows dates without counts, never zeros;
//   * the date list is only what two published calendars agree on, and the
//     page says so and defers to the family astrologer;
//   * every FAQ answer is computed from the same data the page lists, so the
//     FAQPage markup cannot drift from what is visible.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { CalendarHeart, Languages, Search } from "lucide-react";
import {
  MUHURTHAM_CHECKED,
  busiestMonth,
  countInYear,
  groupByMonth,
  upcomingMuhurthamDates,
} from "@/lib/muhurtham";
import type { MuhurthamBookings } from "@/lib/muhurtham.server";
import { formatDiaryDay, formatMonthTitle, type DiaryLang } from "@/lib/diary";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbJsonLd, faqJsonLd, jsonLdGraph } from "@/lib/seo/jsonld";
import { MoreFamilyTools } from "@/components/tools/FamilyTools";

export const MUHURTHAM_PATH = { en: "/muhurtham-dates", ta: "/ta/muhurtham-dates" } as const;

export function muhurthamLanguageAlternates(): Record<string, string> {
  return { "en-IN": MUHURTHAM_PATH.en, "ta-IN": MUHURTHAM_PATH.ta, "x-default": MUHURTHAM_PATH.en };
}

/** "2026–2027", or "2027" once the 2026 dates have passed. */
export function yearSpan(dates: readonly string[]): string {
  if (dates.length === 0) return "";
  const first = dates[0].slice(0, 4);
  const last = dates[dates.length - 1].slice(0, 4);
  return first === last ? first : `${first}–${last}`;
}

/** Title and description for either twin. Kept under buildMetadata's 158-char clamp so the snippet is never cut mid-sentence. */
export function muhurthamMeta(lang: DiaryLang, today: string): { title: string; description: string; hasDates: boolean } {
  const dates = upcomingMuhurthamDates(today);
  const span = yearSpan(dates);
  const from = dates.length ? formatMonthTitle(lang, dates[0].slice(0, 7)) : "";
  const to = dates.length ? formatMonthTitle(lang, dates[dates.length - 1].slice(0, 7)) : "";
  if (lang === "ta") {
    return {
      title: `முகூர்த்த நாட்கள் ${span} | திருமண தேதிகள்`,
      description: dates.length
        ? `${from} முதல் ${to} வரை எல்லா திருமண முகூர்த்த நாட்களும், ஒவ்வொரு நாளும் Hallnect-இல் ஏற்கனவே முன்பதிவான மண்டபங்களுடன்.`
        : "திருமண முகூர்த்த நாட்களும், ஒவ்வொரு நாளிலும் ஏற்கனவே முன்பதிவான மண்டபங்களும்.",
      hasDates: dates.length > 0,
    };
  }
  return {
    title: `Tamil Muhurtham Dates ${span} | Wedding Dates`,
    description: dates.length
      ? `Every Tamil wedding muhurtham date from ${from} to ${to}, with how many halls on Hallnect already have each date booked.`
      : "Tamil wedding muhurtham dates, with how many halls on Hallnect already have each date booked.",
    hasDates: dates.length > 0,
  };
}

function daysBetween(fromIso: string, toIso: string): number {
  const [a, b] = [fromIso, toIso].map((d) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  });
  return Math.round((b - a) / 86_400_000);
}

const T = {
  en: {
    home: "Home",
    crumb: "Muhurtham dates",
    h1: "Tamil Muhurtham Dates",
    intro:
      "Wedding muhurtham days from the Tamil calendar, with how many halls on Hallnect already have each date booked. Halls fill on these days first, so it pays to look early.",
    next: "Next muhurtham",
    today: "today",
    tomorrow: "tomorrow",
    inDays: (n: number) => `in ${n} days`,
    findForDate: "Find a hall for this date",
    findHalls: "Find halls",
    booked: (b: number, n: number) => `${b} of ${n} ${n === 1 ? "hall" : "halls"} already booked`,
    noneBooked: "None booked on Hallnect yet",
    countsNote:
      "Counts are bookings recorded on Hallnect. A hall that does not keep its diary here may already be taken, so each hall confirms your date with you.",
    dateCount: (n: number) => (n === 1 ? "1 date" : `${n} dates`),
    methodTitle: "How we choose these dates",
    method: (checked: string) =>
      `We list a date only when two independently published Tamil calendars agree on it. Panchangam traditions differ, so some calendars carry a few more days. Your family astrologer has the final word on your date. Last checked ${checked}.`,
    faqTitle: "Questions about muhurtham dates",
    jumpLabel: "Jump to a month",
    switchLabel: "தமிழில் படிக்க",
    switchLang: "ta" as const,
    empty: "New muhurtham dates are added as each year's calendars are published. Please check back soon.",
  },
  ta: {
    home: "முகப்பு",
    crumb: "முகூர்த்த நாட்கள்",
    h1: "முகூர்த்த நாட்கள்",
    intro:
      "தமிழ் நாட்காட்டியின் திருமண முகூர்த்த நாட்கள், ஒவ்வொரு நாளிலும் Hallnect-இல் ஏற்கனவே எத்தனை மண்டபங்கள் முன்பதிவாகியுள்ளன என்பதுடன். முகூர்த்த நாட்களில்தான் மண்டபங்கள் முதலில் நிரம்புகின்றன; அதனால் முன்கூட்டியே பாருங்கள்.",
    next: "அடுத்த முகூர்த்தம்",
    today: "இன்று",
    tomorrow: "நாளை",
    inDays: (n: number) => `${n} நாட்களில்`,
    findForDate: "இந்தத் தேதிக்கு மண்டபம் தேடுங்கள்",
    findHalls: "மண்டபங்களைத் தேடு",
    booked: (b: number, n: number) => `${n} மண்டபங்களில் ${b} ஏற்கனவே முன்பதிவு`,
    noneBooked: "Hallnect-இல் இதுவரை முன்பதிவு இல்லை",
    countsNote:
      "எண்ணிக்கைகள் Hallnect-இல் பதிவான முன்பதிவுகள் மட்டுமே. இங்கு டைரி வைக்காத மண்டபம் ஏற்கனவே முன்பதிவாகியிருக்கலாம்; அதனால் ஒவ்வொரு மண்டபமும் உங்கள் தேதியை உங்களுடன் உறுதி செய்யும்.",
    dateCount: (n: number) => (n === 1 ? "1 நாள்" : `${n} நாட்கள்`),
    methodTitle: "இந்த நாட்களை எப்படித் தேர்ந்தெடுக்கிறோம்",
    method: (checked: string) =>
      `வெளியிடப்பட்ட இரண்டு தமிழ் நாட்காட்டிகளும் ஒப்புக்கொள்ளும் நாட்களை மட்டுமே இங்கு பட்டியலிடுகிறோம். பஞ்சாங்க மரபுகள் வேறுபடுவதால், சில நாட்காட்டிகளில் இன்னும் சில நாட்கள் இருக்கலாம். உங்கள் தேதியைக் குடும்ப ஜோதிடரிடம் உறுதி செய்யுங்கள். கடைசியாகச் சரிபார்த்தது: ${checked}.`,
    faqTitle: "முகூர்த்த நாட்கள் பற்றிய கேள்விகள்",
    jumpLabel: "மாதத்திற்குச் செல்ல",
    switchLabel: "Read in English",
    switchLang: "en" as const,
    empty: "ஒவ்வொரு ஆண்டின் நாட்காட்டிகளும் வெளியானதும் புதிய முகூர்த்த நாட்கள் சேர்க்கப்படும்.",
  },
} as const;

/** Questions answered from the list itself. Shared by the page and its FAQPage markup. */
export function muhurthamFaqs(lang: DiaryLang, today: string): { q: string; a: string }[] {
  const year = Number(today.slice(0, 4));
  const fullYear = countInYear(year + 1) > 0 ? year + 1 : year;
  const n = countInYear(fullYear);
  const busiest = busiestMonth(fullYear);
  const busiestName = busiest ? formatMonthTitle(lang, busiest.month).split(" ")[0] : "";

  if (lang === "ta") {
    return [
      {
        q: `${fullYear}-இல் எத்தனை முகூர்த்த நாட்கள் உள்ளன?`,
        a: `எங்கள் பட்டியலில் ${fullYear}-இல் ${n} முகூர்த்த நாட்கள் உள்ளன — வெளியிடப்பட்ட இரண்டு தமிழ் நாட்காட்டிகளும் ஒப்புக்கொள்ளும் நாட்கள். சில நாட்காட்டிகளில் இன்னும் சில நாட்கள் இருக்கலாம்; உங்கள் தேதியைக் குடும்ப ஜோதிடரிடம் உறுதி செய்யுங்கள்.`,
      },
      ...(busiest
        ? [{
            q: `${fullYear}-இல் எந்த மாதத்தில் அதிக முகூர்த்த நாட்கள்?`,
            a: `${busiestName} மாதத்தில், ${busiest.count} நாட்கள். அந்த மாதத்தின் மண்டபங்கள் முதலில் நிரம்பும்.`,
          }]
        : []),
      {
        q: "ஆடி, புரட்டாசி, மார்கழி மாதங்களில் ஏன் முகூர்த்த நாட்கள் இல்லை?",
        a: "தமிழ் மரபில் இந்த மாதங்களில் திருமணங்கள் நடத்தப்படுவதில்லை; அதனால் நாட்காட்டிகள் இவற்றில் முகூர்த்த நாட்களைக் குறிப்பதில்லை.",
      },
      {
        q: "முகூர்த்த நாளுக்கு மண்டபத்தை எப்போது முன்பதிவு செய்ய வேண்டும்?",
        a: "தேதி முடிவானவுடனேயே. முகூர்த்த நாட்கள்தான் முதலில் நிரம்பும். Hallnect-இல் அந்தத் தேதியில் எந்த மண்டபங்கள் ஏற்கனவே முன்பதிவாகியுள்ளன என்று பார்த்து, அன்றே விசாரிக்கலாம்.",
      },
    ];
  }
  return [
    {
      q: `How many muhurtham dates are there in ${fullYear}?`,
      a: `Our list has ${n} muhurtham dates in ${fullYear}: the days on which two independently published Tamil calendars agree. Some calendars carry a few more, so confirm yours with your family astrologer.`,
    },
    ...(busiest
      ? [{
          q: `Which month in ${fullYear} has the most muhurtham dates?`,
          a: `${busiestName}, with ${busiest.count} dates. Halls for that month are the first to fill.`,
        }]
      : []),
    {
      q: "Why are there no muhurtham dates in Aadi, Purattasi and Margazhi?",
      a: "Tamil weddings are traditionally not held in these months, so the calendars list no muhurtham days in them.",
    },
    {
      q: "How early should we book a hall for a muhurtham date?",
      a: "As soon as your date is fixed, because muhurtham days fill first. On Hallnect you can see which halls already have the date booked and send an enquiry the same day.",
    },
  ];
}

export function MuhurthamPage({
  lang,
  today,
  bookings,
}: {
  lang: DiaryLang;
  /** Today in India, from the server. */
  today: string;
  /** Null when the count read failed: the dates still show, the counts do not. */
  bookings: MuhurthamBookings | null;
}) {
  const t = T[lang];
  const dates = upcomingMuhurthamDates(today);
  const months = groupByMonth(dates);
  const next = dates[0];
  const faqs = muhurthamFaqs(lang, today);
  const path = MUHURTHAM_PATH[lang];

  // The callout always says where the next date stands; a list row speaks only
  // when a hall is booked — seventy copies of "none booked" read as an empty
  // marketplace, not as good news.
  const bookedLine = (d: string, { quietWhenNone = false } = {}) => {
    if (!bookings || bookings.listedHalls === 0) return null;
    const b = bookings.bookedByDate.get(d) ?? 0;
    if (b > 0) return t.booked(b, bookings.listedHalls);
    return quietWhenNone ? null : t.noneBooked;
  };

  const away = (d: string) => {
    const n = daysBetween(today, d);
    return n === 0 ? t.today : n === 1 ? t.tomorrow : t.inDays(n);
  };

  return (
    <div className="container-app max-w-3xl pb-16 pt-3">
      <JsonLd
        data={jsonLdGraph(
          breadcrumbJsonLd([
            { name: t.home, path: "/" },
            { name: t.crumb, path },
          ]),
          ...(dates.length ? [faqJsonLd(faqs)] : []),
        )}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label={lang === "ta" ? "வழிச்சுவடு" : "Breadcrumb"}>
          <ol className="flex flex-wrap items-center gap-1 text-xs text-charcoal-600">
            <li><Link href="/" className="hover:text-maroon-700">{t.home}</Link></li>
            <li aria-hidden="true">/</li>
            <li className="font-medium text-charcoal-800" aria-current="page">{t.crumb}</li>
          </ol>
        </nav>
        <Link
          href={MUHURTHAM_PATH[t.switchLang]}
          hrefLang={t.switchLang === "ta" ? "ta-IN" : "en-IN"}
          lang={t.switchLang}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-maroon-700 hover:underline"
        >
          <Languages className="h-3.5 w-3.5" aria-hidden />
          {t.switchLabel}
        </Link>
      </div>

      <h1 className="mt-1 text-2xl font-bold leading-snug text-charcoal-900 lg:text-3xl">
        {t.h1} <span className="whitespace-nowrap">{yearSpan(dates)}</span>
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-charcoal-700">{t.intro}</p>

      {!next ? (
        <p className="mt-6 rounded-2xl bg-white p-5 text-sm text-charcoal-700 shadow-card">{t.empty}</p>
      ) : (
        <>
          {/* ── The next one ─────────────────────────────────────────── */}
          <section aria-label={t.next} className="mt-5 rounded-3xl bg-maroon-700 p-5 text-white shadow-maroon">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gold-300">
              <CalendarHeart className="h-4 w-4" aria-hidden /> {t.next}
            </p>
            <p className="mt-1 text-2xl font-bold">{formatDiaryDay(lang, next, { year: true })}</p>
            <p className="text-sm text-white/85">
              {away(next)}
              {bookedLine(next) && <> · {bookedLine(next)}</>}
            </p>
            <Link
              href={`/halls?date=${next}`}
              className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-maroon-800 hover:bg-ivory-100"
            >
              <Search className="h-4 w-4" aria-hidden /> {t.findForDate}
            </Link>
          </section>

          {bookings && bookings.listedHalls > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-charcoal-600">{t.countsNote}</p>
          )}

          {/* ── Jump to a month ──────────────────────────────────────────
              Seventy dates in one column is a long scroll on a phone to reach
              next May. One chip per month, with how many dates it has. */}
          {months.size > 1 && (
            <nav aria-label={t.jumpLabel} className="no-scrollbar -mx-4 mt-5 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
              <ul className="flex w-max gap-2 pb-1">
                {[...months.entries()].map(([key, ds]) => (
                  <li key={key}>
                    <a
                      href={`#month-${key}`}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-white px-3.5 text-xs font-semibold text-charcoal-800 shadow-card ring-1 ring-border hover:ring-maroon-300"
                    >
                      {formatMonthTitle(lang, key)}
                      <span className="rounded-full bg-maroon-50 px-1.5 text-[11px] text-maroon-700">{ds.length}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {/* ── Every date, by month ─────────────────────────────────── */}
          <div className="mt-6 space-y-5">
            {[...months.entries()].map(([key, ds]) => (
              <section key={key} id={`month-${key}`} aria-labelledby={`m-${key}`} className="scroll-mt-20 rounded-2xl bg-white p-4 shadow-card lg:scroll-mt-24">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id={`m-${key}`} className="text-base font-bold text-charcoal-900">{formatMonthTitle(lang, key)}</h2>
                  <span className="text-xs text-charcoal-600">{t.dateCount(ds.length)}</span>
                </div>
                <ul className="mt-2 divide-y divide-border">
                  {ds.map((d) => (
                    <li key={d} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-charcoal-900">{formatDiaryDay(lang, d)}</span>
                        {bookedLine(d, { quietWhenNone: true }) && (
                          <span className="block text-xs font-medium text-maroon-700">
                            {bookedLine(d, { quietWhenNone: true })}
                          </span>
                        )}
                      </span>
                      <Link
                        href={`/halls?date=${d}`}
                        className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold text-maroon-700 ring-1 ring-maroon-200 hover:bg-maroon-50"
                      >
                        {t.findHalls} →
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <section className="mt-8">
            <h2 className="text-lg font-bold text-charcoal-900">{t.methodTitle}</h2>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-700">
              {t.method(formatDiaryDay(lang, MUHURTHAM_CHECKED, { year: true }))}
            </p>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-bold text-charcoal-900">{t.faqTitle}</h2>
            <dl className="mt-3 space-y-4">
              {faqs.map((f) => (
                <div key={f.q}>
                  <dt className="text-sm font-semibold text-charcoal-900">{f.q}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-charcoal-700">{f.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}

      {/* The next steps once the date is fixed. English only: the cards are
          written in English, and the Tamil page should not switch language
          at its foot. */}
      {lang === "en" && <MoreFamilyTools current="muhurtham" />}
    </div>
  );
}
