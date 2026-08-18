// ─────────────────────────────────────────────────────────────────────────────
// lib/dates.ts — business-timezone date helpers for the booking system.
//
// THE BUG THIS FIXES (off-by-one-day): date strings were derived with
// `new Date(...).toISOString().slice(0, 10)`, which converts to UTC FIRST.
// Hallnect's market is India (IST, UTC+05:30), where local midnight is
// *yesterday 18:30 UTC* — so a tile labelled "17 August" (local getDate())
// carried the VALUE "2026-08-16". Customers picked one date and the system
// checked/booked the previous one. The server had the mirror-image problem:
// "today" computed in UTC let customers book *yesterday IST* until 05:30, and
// the 60-day availability window was shifted.
//
// STRATEGY: all date-only values in the booking domain are computed in ONE
// fixed business timezone (Asia/Kolkata) on both server and client, so Vercel's
// region and the visitor's device timezone are both irrelevant. Date-only
// arithmetic is done on Y/M/D parts via Date.UTC — never through toISOString().
// ─────────────────────────────────────────────────────────────────────────────

export const BUSINESS_TIME_ZONE = "Asia/Kolkata";

// en-CA formats as YYYY-MM-DD, which is exactly the wire format we store.
const businessDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The date (YYYY-MM-DD) a given instant falls on in the business timezone. */
export function formatDateInBusinessTz(instant: Date): string {
  return businessDateFmt.format(instant);
}

/** Today's date (YYYY-MM-DD) in the business timezone — server and client agree. */
export function todayInBusinessTz(): string {
  return formatDateInBusinessTz(new Date());
}

/** Pure date arithmetic on an ISO date string. No timezone is involved:
 *  the Y/M/D parts are treated as a calendar date via Date.UTC. */
export function addDaysToIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + days));
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${t.getUTCFullYear()}-${mm}-${dd}`;
}

/** Inclusive list of ISO dates from `fromIso` to `toIso` (parts-based, safe). */
export function isoDateRange(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  let cur = fromIso;
  // Hard cap prevents an inverted range from looping forever.
  for (let i = 0; i < 400 && cur <= toIso; i++) {
    out.push(cur);
    cur = addDaysToIsoDate(cur, 1);
  }
  return out;
}

/** Inclusive day count between two ISO dates: 15th→18th = 4. */
export function daysBetweenInclusive(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const a = Date.UTC(fy, (fm ?? 1) - 1, fd ?? 1);
  const b = Date.UTC(ty, (tm ?? 1) - 1, td ?? 1);
  return Math.round((b - a) / 86_400_000) + 1;
}

/** A Date whose UTC parts equal the ISO date — for LABELS ONLY. Render it with
 *  timeZone:"UTC" so weekday/day/month always match the ISO value. */
export function isoDateToLabelDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

/** Formats an ISO date for display without any timezone drift. */
export function formatIsoDateLabel(
  iso: string,
  options: Intl.DateTimeFormatOptions,
  locale = "en-IN",
): string {
  return isoDateToLabelDate(iso).toLocaleDateString(locale, {
    ...options,
    timeZone: "UTC",
  });
}

/** "15–18 Sep 2026 · 4 days" for ranges; single-date label otherwise. */
export function formatBookingDates(startIso: string, endIso?: string | null): string {
  const end = endIso && endIso !== startIso ? endIso : null;
  if (!end) {
    return formatIsoDateLabel(startIso, { day: "numeric", month: "short", year: "numeric" });
  }
  const days = daysBetweenInclusive(startIso, end);
  const startLbl = formatIsoDateLabel(startIso, { day: "numeric", month: "short" });
  const endLbl   = formatIsoDateLabel(end, { day: "numeric", month: "short", year: "numeric" });
  return `${startLbl} – ${endLbl} · ${days} days`;
}
