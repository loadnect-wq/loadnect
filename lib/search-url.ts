// ─────────────────────────────────────────────────────────────────────────────
// lib/search-url.ts — the one place a hall search becomes a /halls URL, plus
// the calendar maths both search UIs need.
//
// Shared by the desktop hero pill and the mobile search sheet so the two can
// never disagree about what a search means.
//
// DATES ARE STRINGS, AND THE MATHS IS UTC. Every date here is a YYYY-MM-DD
// string in the business timezone, starting from the server's `today`. Adding
// days or finding a weekday goes through Date.UTC, never the visitor's local
// clock: a browser in another timezone would otherwise be off by a day around
// midnight — the drift lib/dates.ts exists to prevent.
// ─────────────────────────────────────────────────────────────────────────────

export type HallSearch = {
  city?: string;
  /** YYYY-MM-DD — the first day the hall must be free. */
  date?: string;
  /** YYYY-MM-DD — the last day. Only meaningful after `date`. */
  dateTo?: string;
  /** Minimum guests the hall must hold. */
  capacity?: string;
};

/** A city with live inventory, and how many halls it holds. Server-supplied. */
export type SearchCity = { city: string; venueCount: number };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Guest-count minimums both search UIs offer — the same steps as the /halls capacity filter. */
export const GUEST_PRESETS = ["100", "200", "300", "500", "750", "1000"] as const;

/**
 * Builds the /halls URL for a search. Every parameter is one /halls reads:
 * city, date, dateTo, capacity.
 *
 * A range is sent only when it is a real range. `dateTo` without `date` would
 * silently do nothing (the availability query keys off `date`), and a `dateTo`
 * on or before `date` is ignored by /halls anyway — so it is dropped here
 * rather than put in a URL that pretends otherwise.
 */
export function buildHallSearchHref(search: HallSearch): string {
  const params = new URLSearchParams();

  const city = search.city?.trim();
  if (city) params.set("city", city);

  if (search.date && ISO_DATE.test(search.date)) {
    params.set("date", search.date);
    if (search.dateTo && ISO_DATE.test(search.dateTo) && search.dateTo > search.date) {
      params.set("dateTo", search.dateTo);
    }
  }

  const capacity = search.capacity?.trim();
  if (capacity && /^\d+$/.test(capacity) && Number(capacity) > 0) {
    params.set("capacity", String(Number(capacity)));
  }

  const qs = params.toString();
  return `/halls${qs ? `?${qs}` : ""}`;
}

// ── Date maths on YYYY-MM-DD strings ─────────────────────────────────────────

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

function toUtc(iso: string): Date {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(iso: string): number {
  return toUtc(iso).getUTCDay();
}

/**
 * The weekend a visitor means by "this weekend" or "next weekend".
 *
 *   Mon-Fri   this = the coming Saturday and Sunday
 *   Saturday  this = today and tomorrow
 *   Sunday    this = today only (Saturday has already gone)
 *   next      always the Saturday and Sunday seven days after "this" Saturday
 */
export function weekendRange(today: string, which: "this" | "next"): { date: string; dateTo: string } {
  const dow = dayOfWeek(today);
  const thisSaturday = dow === 0 ? addDays(today, -1) : addDays(today, 6 - dow);
  if (which === "next") {
    const saturday = addDays(thisSaturday, 7);
    return { date: saturday, dateTo: addDays(saturday, 1) };
  }
  const start = thisSaturday < today ? today : thisSaturday;
  return { date: start, dateTo: addDays(thisSaturday, 1) };
}

const SHORT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const WITH_WEEKDAY = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const FULL = new Intl.DateTimeFormat("en-IN", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const MONTH = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** "20 Nov". */
export function formatShort(iso: string): string {
  return SHORT.format(toUtc(iso));
}

/** "Fri, 20 Nov". */
export function formatWithWeekday(iso: string): string {
  return WITH_WEEKDAY.format(toUtc(iso));
}

/** "Friday, 20 November 2026" — for screen readers. */
export function formatFull(iso: string): string {
  return FULL.format(toUtc(iso));
}

/** "November 2026". */
export function formatMonth(year: number, month: number): string {
  return MONTH.format(new Date(Date.UTC(year, month - 1, 1)));
}

/**
 * What a search field shows for a date choice.
 *   nothing        → null (the field shows its placeholder)
 *   one day        → "Fri, 20 Nov"
 *   a range        → "20 Nov – 22 Nov"
 */
export function formatDateChoice(date?: string, dateTo?: string): string | null {
  if (!date) return null;
  if (!dateTo || dateTo <= date) return formatWithWeekday(date);
  return `${formatShort(date)} – ${formatShort(dateTo)}`;
}

/**
 * One month as calendar rows, Sunday first. Cells outside the month are null,
 * so every row has exactly seven entries and the grid never shifts.
 */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array(first.getUTCDay()).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** The month after (or before, with -1) a year/month pair. */
export function shiftMonth(year: number, month: number, by: number): [number, number] {
  const d = new Date(Date.UTC(year, month - 1 + by, 1));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1];
}
