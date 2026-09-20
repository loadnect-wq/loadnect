// ─────────────────────────────────────────────────────────────────────────────
// components/venues/EventTypeBreakdown.tsx — "what is this venue booked for?"
//
// Used by the owner's dashboard and the admin's. Deliberately a bar list rather
// than a chart: the numbers here are small (a venue has tens of bookings, not
// thousands), and a pie chart of four values is decoration around a number the
// reader could have read directly.
//
// ════════════════════════════════════════════════════════════════════════════
// "NOT RECORDED" IS A ROW, NOT A GAP
// ════════════════════════════════════════════════════════════════════════════
// bookings.event_type is nullable and is never backfilled (migration 0102):
// every booking taken before the column existed, and every enquiry where the
// customer skipped the optional question, is null. Dropping those rows would
// turn "3 of your 50 bookings recorded an occasion" into a confident-looking
// chart that says all your bookings are weddings.
//
// This is the same failure this codebase keeps finding in other shapes — a
// swallowed absence rendering as good news — so the bucket is shown, labelled
// plainly, and styled so it does not compete with the real categories.
// ─────────────────────────────────────────────────────────────────────────────

import type { VenueCategory } from "@/lib/venue-categories";
import { CategoryIcon } from "@/components/venues/CategoryIcon";

export type EventTypeRow = {
  slug:      string | null;
  bookings:  number;
  enquiries: number;
};

export function EventTypeBreakdown({
  rows,
  catalogue,
  title = "Bookings by occasion",
}: {
  rows: EventTypeRow[];
  catalogue: VenueCategory[];
  title?: string;
}) {
  if (rows.length === 0) return null;

  const byslug = new Map(catalogue.map((c) => [c.slug, c]));
  const total = rows.reduce((n, r) => n + r.bookings + r.enquiries, 0);
  if (total === 0) return null;

  const recorded = rows
    .filter((r) => r.slug !== null)
    .reduce((n, r) => n + r.bookings + r.enquiries, 0);

  return (
    <section className="rounded-2xl border border-border bg-white p-4 shadow-card">
      <h2 className="font-serif text-base font-semibold text-charcoal-900">{title}</h2>

      <ul className="mt-3 space-y-2">
        {rows.map((r) => {
          const n = r.bookings + r.enquiries;
          const pct = Math.round((n / total) * 100);
          const category = r.slug ? byslug.get(r.slug) : null;
          // A slug with no catalogue row means the category was renamed away
          // or deactivated since. Printing the slug is ugly and honest; making
          // something up is neither.
          const label = r.slug ? (category?.name ?? r.slug) : "Not recorded";

          return (
            <li key={r.slug ?? "__none"}>
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    r.slug ? "bg-maroon-50 text-maroon-600" : "bg-charcoal-100 text-charcoal-400"
                  }`}
                >
                  <CategoryIcon name={category?.icon ?? null} className="h-3.5 w-3.5" />
                </span>
                <span
                  className={`flex-1 truncate text-xs font-medium ${
                    r.slug ? "text-charcoal-800" : "text-charcoal-500"
                  }`}
                >
                  {label}
                </span>
                <span className="shrink-0 text-xs font-semibold text-charcoal-900">{n}</span>
                <span className="w-9 shrink-0 text-right text-[11px] text-charcoal-400">{pct}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ivory-200">
                <div
                  className={`h-full rounded-full ${r.slug ? "bg-maroon-500" : "bg-charcoal-300"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {/* Only when both kinds exist, so a direct-booking venue is not
                  told "0 enquiries" on every row. */}
              {r.bookings > 0 && r.enquiries > 0 && (
                <p className="mt-0.5 text-[10px] text-charcoal-400">
                  {r.bookings} booking{r.bookings === 1 ? "" : "s"} · {r.enquiries} enquir
                  {r.enquiries === 1 ? "y" : "ies"}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {/* THE HONESTY LINE. Without it, a venue with 3 recorded occasions out of
          50 shows three neat bars and reads as a complete picture. */}
      {recorded < total && (
        <p className="mt-3 text-[11px] leading-relaxed text-charcoal-500">
          {recorded === 0
            ? "No occasion was recorded on any of these yet — this started being collected recently."
            : `${recorded} of ${total} recorded an occasion. Earlier ones were taken before this was collected.`}
        </p>
      )}
    </section>
  );
}
