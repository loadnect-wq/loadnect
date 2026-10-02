// ─────────────────────────────────────────────────────────────────────────────
// lib/muhurtham.ts — Tamil wedding muhurtham days, for marking the date picker.
//
// NO IMPORTS. The calendar is a client component; this is plain data.
//
// WHY THE SEARCH CARES. A Tamil wedding starts with a date from the family
// astrologer, and only then does the hunt for a free hall begin. Halls fill on
// muhurtham days months ahead, so these are the days a family is most likely
// to be searching for — marking them saves a trip to a calendar site.
//
// ═══ ONLY DATES TWO PUBLISHERS AGREE ON ═════════════════════════════════════
//
// Panchangam traditions differ, and the published lists differ with them. For
// 2027 the two independent lists checked (dailycalendartamil.com and
// tamildailycalendar.com) disagree on 13 dates, so a date is listed here ONLY
// if both carry it — 56 of 69. A third list (indianweddingplanners.in) matched
// dailycalendartamil.com line for line and was not counted as independent.
// For October–December 2026, dailycalendartamil.com and calendar.tamildot.com
// agreed on all 14 dates. Checked 2026-10-02.
//
// Sanity check that held: none falls in Aadi (mid-July to mid-August),
// Purattasi (mid-September to mid-October) or Margazhi (mid-December to
// mid-January), the months Tamil weddings avoid.
//
// A MARKER, NEVER ADVICE. The UI must say the family's own astrologer decides.
// A missing mark means "not on both lists", not "inauspicious".
//
// EXTENDING: add a year only after checking two independent publishers, and
// move MUHURTHAM_COVERAGE_END with it. lib/__tests__/muhurtham.test.ts pins the
// shape (sorted, unique, inside the coverage window).
// ─────────────────────────────────────────────────────────────────────────────

/** Last day the list covers. Past it, an unmarked day says nothing. */
export const MUHURTHAM_COVERAGE_END = "2027-12-31";

export const MUHURTHAM_DATES: readonly string[] = [
  // 2026 — Aippasi to Karthigai
  "2026-10-25", "2026-10-30",
  "2026-11-01", "2026-11-11", "2026-11-13", "2026-11-15", "2026-11-16", "2026-11-20", "2026-11-29",
  "2026-12-04", "2026-12-06", "2026-12-10", "2026-12-13", "2026-12-14",
  // 2027
  "2027-01-20", "2027-01-28",
  "2027-02-08", "2027-02-10", "2027-02-11", "2027-02-18", "2027-02-25", "2027-02-26",
  "2027-03-04", "2027-03-10", "2027-03-11", "2027-03-17", "2027-03-18", "2027-03-24", "2027-03-25",
  "2027-04-01", "2027-04-04", "2027-04-11", "2027-04-12", "2027-04-18", "2027-04-23", "2027-04-26",
  "2027-05-03", "2027-05-09", "2027-05-12", "2027-05-16", "2027-05-17", "2027-05-23", "2027-05-26", "2027-05-27",
  "2027-06-07", "2027-06-10", "2027-06-13", "2027-06-24", "2027-06-25",
  "2027-07-05", "2027-07-09", "2027-07-14",
  "2027-08-20", "2027-08-29",
  "2027-09-03", "2027-09-05", "2027-09-12", "2027-09-13",
  "2027-10-20", "2027-10-22", "2027-10-27",
  "2027-11-01", "2027-11-05", "2027-11-10", "2027-11-11", "2027-11-18", "2027-11-25",
  "2027-12-02", "2027-12-08", "2027-12-09",
];

const SET: ReadonlySet<string> = new Set(MUHURTHAM_DATES);

export function isMuhurtham(iso: string): boolean {
  return SET.has(iso);
}

/** The first `count` muhurtham days on or after `fromIso`, in order. */
export function nextMuhurthamDates(fromIso: string, count = 1): string[] {
  return MUHURTHAM_DATES.filter((d) => d >= fromIso).slice(0, count);
}
