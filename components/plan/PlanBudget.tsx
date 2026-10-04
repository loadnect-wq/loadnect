// The plan's money at a glance: what the function is expected to cost (booked
// plus still to book), what has been paid, what booked vendors are still owed,
// and how that sits against the budget. Every figure is the family's own.

import { formatPrice } from "@/lib/mock-data";
import type { PlanTotals } from "@/lib/plan";

export function PlanBudget({ totals, budget }: { totals: PlanTotals; budget: number | null }) {
  const scale = Math.max(budget ?? 0, totals.expected, 1);
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / scale) * 100))}%`;
  const paidOfBooked = Math.min(totals.paid, totals.booked);
  const over = totals.left != null && totals.left < 0;

  return (
    <section aria-labelledby="budget-heading" className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="budget-heading" className="text-base font-bold text-charcoal-900">Budget</h2>
        <span className="text-sm text-charcoal-700">
          {budget != null ? <>Budget {formatPrice(budget)}</> : "No budget set"}
        </span>
      </div>

      {totals.expected === 0 ? (
        <p className="mt-2 text-sm text-charcoal-600">
          Add a planned amount or a quote to any category and the total appears here.
        </p>
      ) : (
        <>
          {/* Booked (paid part darker), then still to book, against the budget. */}
          <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-ivory-200" aria-hidden>
            <div className="absolute inset-y-0 left-0 bg-maroon-300" style={{ width: pct(totals.booked) }} />
            <div className="absolute inset-y-0 left-0 bg-maroon-700" style={{ width: pct(paidOfBooked) }} />
            <div
              className="absolute inset-y-0 bg-gold-300"
              style={{ left: pct(totals.booked), width: pct(totals.toBook) }}
            />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="flex items-center gap-1.5 text-xs text-charcoal-600"><span className="h-2 w-2 rounded-full bg-maroon-300" aria-hidden />Booked</dt>
              <dd className="font-semibold text-charcoal-900">{formatPrice(totals.booked)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs text-charcoal-600"><span className="h-2 w-2 rounded-full bg-maroon-700" aria-hidden />Paid</dt>
              <dd className="font-semibold text-charcoal-900">{formatPrice(totals.paid)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs text-charcoal-600"><span className="h-2 w-2 rounded-full bg-gold-300" aria-hidden />Still to book</dt>
              <dd className="font-semibold text-charcoal-900">{formatPrice(totals.toBook)}</dd>
            </div>
            <div>
              <dt className="text-xs text-charcoal-600">Still to pay</dt>
              <dd className="font-semibold text-charcoal-900">{formatPrice(totals.stillToPay)}</dd>
            </div>
          </dl>
          <p className={`mt-3 text-sm font-semibold ${over ? "text-red-700" : "text-charcoal-900"}`}>
            Expected cost {formatPrice(totals.expected)}
            {totals.left != null && (over ? ` · ${formatPrice(-totals.left)} over budget` : ` · ${formatPrice(totals.left)} left`)}
          </p>
        </>
      )}
    </section>
  );
}
