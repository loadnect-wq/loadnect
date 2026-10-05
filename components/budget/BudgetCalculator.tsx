"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The standalone budget calculator at /budget: the same estimate as "Plan your
// budget" on a hall's page, for a family that has not chosen a hall yet. The
// hall's price is typed in; everything else is shared with every hall's page
// through useBudgetInputs, so the numbers carry over in both directions.
//
// The same honesty rules as lib/budget.ts: nothing here is a quote, and there
// is no default per-plate rate — a number we made up would read as a claim
// about what food costs.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { MessageCircle, RotateCcw, Search } from "lucide-react";
import { useBudgetInputs } from "@/lib/hooks/useBudgetInputs";
import { HALL_GST_PERCENT, MAX_GUESTS, budget, functionBudgetSummary, toAmount } from "@/lib/budget";
import { BUDGET_PATH } from "@/lib/family-tools";
import { formatPrice } from "@/lib/mock-data";
import { absoluteUrl } from "@/lib/seo/config";
import { whatsappShareUrl } from "@/lib/shortlist";
import { BUDGET_INPUT_CLASS, BudgetBreakdown, CALCULATOR_DISCLAIMER, ExtraFields, FoodFields } from "./budget-parts";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`budget-step-${n}`} className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border sm:p-5">
      <h2 id={`budget-step-${n}`} className="flex items-center gap-2.5 text-base font-bold text-charcoal-900">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-maroon-700 text-xs font-bold text-white" aria-hidden>
          {n}
        </span>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function BudgetCalculator() {
  const { fields, set } = useBudgetInputs();

  const hallRent = toAmount(fields.hallRent);
  const addGst = hallRent != null && fields.hallGst === "1";
  const guests = toAmount(fields.guests, MAX_GUESTS);
  const result = budget({
    hallRent,
    guests,
    perPlate: toAmount(fields.perPlate, 1_00_000),
    meals: Number(fields.meals) || 1,
    decoration: toAmount(fields.decoration),
    other: toAmount(fields.other),
    addGst,
  });
  const share = whatsappShareUrl(functionBudgetSummary(result, absoluteUrl(BUDGET_PATH)));
  const anything = Object.entries(fields).some(([k, v]) => (k === "meals" ? v !== "1" : v !== ""));

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-8">
      {/* THE TOTAL STAYS IN SIGHT ON A PHONE. The form is two screens tall, so
          the breakdown at the end would scroll away while the family types.
          A copy of the headline number rides under the app bar; the full,
          announced breakdown is the card further down (this strip is hidden
          from screen readers so the total is not read out twice). */}
      <div
        aria-hidden
        className="sticky top-14 z-20 -mx-4 mb-3 flex items-baseline justify-between gap-3 border-b border-border bg-ivory-100/95 px-4 py-2.5 sm:-mx-6 sm:px-6 lg:hidden"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-charcoal-600">
          {result.lines.length === 0 ? "Your estimate" : result.complete ? "Estimated total" : "Total so far"}
        </span>
        <span className="font-serif text-lg font-bold text-maroon-700">
          {result.lines.length === 0 ? "—" : formatPrice(result.total)}
          {result.perGuest != null && (
            <span className="ml-1.5 font-sans text-xs font-medium text-charcoal-600">· {formatPrice(result.perGuest)}/guest</span>
          )}
        </span>
      </div>

      <div className="space-y-4">
        <Step n={1} title="The hall">
          <label className="block text-sm font-semibold text-charcoal-900">
            Hall price (₹)
            <input
              inputMode="numeric"
              value={fields.hallRent}
              onChange={(e) => set({ hallRent: e.target.value })}
              placeholder="From the hall's page or its quote"
              className={BUDGET_INPUT_CLASS}
            />
          </label>
          <p className="mt-1 text-xs text-charcoal-600">
            Not chosen yet? Leave it blank, or{" "}
            <Link href="/halls" className="font-semibold text-maroon-700 hover:underline">see halls and their prices</Link>.
          </p>
          {hallRent != null && (
            <label className="mt-2 flex min-h-[40px] items-center gap-2 text-sm text-charcoal-800">
              <input
                type="checkbox"
                checked={addGst}
                onChange={(e) => set({ hallGst: e.target.checked ? "1" : "" })}
                className="h-4 w-4 accent-maroon-700"
              />
              The hall&apos;s price is before GST (add {HALL_GST_PERCENT}%)
            </label>
          )}
        </Step>

        <Step n={2} title="Food">
          <FoodFields fields={fields} set={set} cateringHint="Ask the hall or your caterer for a per-plate rate." />
        </Step>

        <Step n={3} title="Everything else">
          <ExtraFields fields={fields} set={set} />
        </Step>
      </div>

      <aside aria-labelledby="budget-result" className="mt-4 lg:sticky lg:top-24 lg:mt-0">
        <div className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border sm:p-5">
          <h2 id="budget-result" className="font-serif text-lg font-bold text-charcoal-900">Your estimate</h2>
          <div className="mt-3">
            <BudgetBreakdown result={result} hallLabel="Hall" missingHall={hallRent == null ? "Add the hall's price" : null} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-charcoal-500">{CALCULATOR_DISCLAIMER}</p>

          {result.complete && (
            <a
              href={share}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#1f8f4e] px-4 text-sm font-semibold text-white hover:bg-[#19773f]"
            >
              <MessageCircle className="h-4 w-4" aria-hidden /> Send this estimate to the family
            </a>
          )}
          {guests != null && (
            <Link
              href={`/halls?capacity=${guests}`}
              className="mt-2 flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800"
            >
              <Search className="h-4 w-4" aria-hidden /> Find halls for {guests.toLocaleString("en-IN")} guests
            </Link>
          )}

          <p className="mt-3 text-xs leading-relaxed text-charcoal-600">
            Your numbers stay on this device, and every hall&apos;s page fills them in for you, so you can see each hall&apos;s total.
          </p>
          {anything && (
            <button
              type="button"
              onClick={() => set({ guests: "", perPlate: "", meals: "1", decoration: "", other: "", hallRent: "", hallGst: "" })}
              className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-charcoal-600 hover:text-maroon-700"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Clear my numbers
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
