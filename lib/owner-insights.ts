// ─────────────────────────────────────────────────────────────────────────────
// lib/owner-insights.ts — the owner's monthly Insights: what a month of
// Hallnect looked like for their halls. Pure and safe for the client; the
// reads are lib/owner-insights.server.ts.
//
// EVERY NUMBER IS A COUNT OF REAL ROWS for the month, in India time:
//   views       hall_page_views (0117): browsers that opened the page, once a day
//   qrScans     hall_qr_scans (0107): scans of the printed standee
//   enquiries   leads created that month, followed through to where they stand
//   visits      site_visits requested that month
//   reviews     reviews written that month
//   bookings    online bookings made that month (direct-booking halls)
// Nothing is estimated, extrapolated or compared with other venues.
// ─────────────────────────────────────────────────────────────────────────────

export type MonthKey = `${number}-${string}`; // "2026-10"

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonthKey(v: unknown): v is MonthKey {
  return typeof v === "string" && MONTH.test(v);
}

/** "2026-10" for an ISO date "2026-10-14". */
export function monthOf(isoDate: string): MonthKey {
  return isoDate.slice(0, 7) as MonthKey;
}

export function shiftMonth(m: MonthKey, by: number): MonthKey {
  const [y, mo] = m.split("-").map(Number);
  const t = y * 12 + (mo - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}` as MonthKey;
}

/** The month as dates ("2026-10-01" up to but not including "2026-11-01"). */
export function monthRange(m: MonthKey): { start: string; end: string } {
  return { start: `${m}-01`, end: `${shiftMonth(m, 1)}-01` };
}

/** The same range as timestamps at midnight India time, for created_at filters. */
export function monthTimestamps(m: MonthKey): { from: string; to: string } {
  const { start, end } = monthRange(m);
  return { from: `${start}T00:00:00+05:30`, to: `${end}T00:00:00+05:30` };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthLabel(m: MonthKey): string {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTHS[mo - 1]} ${y}`;
}

// ── Rows, as read ────────────────────────────────────────────────────────────

export type ViewRow = { hall_id: string; views: number };
export type ScanRow = { hall_id: string; scans: number };
export type LeadRow = {
  hall_id: string;
  status: string;
  created_at: string;
  quoted_at: string | null;
  accepted_at: string | null;
};
export type VisitRow = { hall_id: string; status: string };
export type ReviewRow = { hall_id: string; rating: number };
export type BookingRow = { hall_id: string; status: string; total_amount: number | string | null };

/** A section that could not be read is null, never zero (see fail-open reads). */
export type InsightRows = {
  views: ViewRow[] | null;
  scans: ScanRow[] | null;
  leads: LeadRow[] | null;
  visits: VisitRow[] | null;
  reviews: ReviewRow[] | null;
  bookings: BookingRow[] | null;
};

// ── The summary ──────────────────────────────────────────────────────────────

export type Enquiries = {
  received: number;
  /** Still waiting for the hall's quote. */
  awaitingReply: number;
  quoted: number;
  accepted: number;
  booked: number;
  declined: number;
  expired: number;
  /** Median hours from enquiry to quote, over the quoted ones; null when none. */
  medianReplyHours: number | null;
};

export type HallInsights = {
  views: number | null;
  qrScans: number | null;
  enquiries: Enquiries | null;
  visits: { requested: number; confirmed: number } | null;
  reviews: { count: number; average: number | null } | null;
  bookings: { count: number; value: number } | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The month for the given halls (one hall, or all of them for the total).
 * Leads still awaiting the family's phone check are not enquiries yet: the
 * hall never sees them.
 */
export function summarise(rows: InsightRows, hallIds: readonly string[]): HallInsights {
  const mine = <T extends { hall_id: string }>(list: T[] | null) =>
    list === null ? null : list.filter((r) => hallIds.includes(r.hall_id));

  const views = mine(rows.views);
  const scans = mine(rows.scans);
  const leads = mine(rows.leads)?.filter((l) => l.status !== "awaiting_verification") ?? null;
  const visits = mine(rows.visits);
  const reviews = mine(rows.reviews);
  const bookings = mine(rows.bookings);

  return {
    views: views === null ? null : views.reduce((t, r) => t + Number(r.views), 0),
    qrScans: scans === null ? null : scans.reduce((t, r) => t + Number(r.scans), 0),
    enquiries: leads === null ? null : {
      received: leads.length,
      awaitingReply: leads.filter((l) => l.status === "pending").length,
      quoted: leads.filter((l) => l.quoted_at).length,
      accepted: leads.filter((l) => l.accepted_at).length,
      booked: leads.filter((l) => l.status === "confirmed").length,
      declined: leads.filter((l) => l.status === "rejected").length,
      expired: leads.filter((l) => l.status === "expired").length,
      medianReplyHours: median(
        leads
          .filter((l) => l.quoted_at)
          .map((l) => (Date.parse(l.quoted_at!) - Date.parse(l.created_at)) / 3_600_000)
          .filter((h) => Number.isFinite(h) && h >= 0),
      ),
    },
    visits: visits === null ? null : {
      requested: visits.length,
      confirmed: visits.filter((v) => v.status === "confirmed").length,
    },
    reviews: reviews === null ? null : {
      count: reviews.length,
      average: reviews.length ? reviews.reduce((t, r) => t + r.rating, 0) / reviews.length : null,
    },
    bookings: bookings === null ? null : {
      count: bookings.length,
      value: bookings.reduce((t, b) => t + Number(b.total_amount ?? 0), 0),
    },
  };
}

/** "within 3 hours", "within a day", "2 days". */
export function replyTimeLabel(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
