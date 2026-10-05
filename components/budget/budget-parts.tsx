"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The pieces both budget surfaces share: "Plan your budget" on a hall's page
// (BudgetEstimate) and the standalone calculator at /budget (BudgetCalculator).
// Same fields, same wording, same breakdown — and the same remembered numbers
// (useBudgetInputs), so what a family types in one appears in the other.
// ─────────────────────────────────────────────────────────────────────────────

import { useId } from "react";
import type { BudgetFields } from "@/lib/hooks/useBudgetInputs";
import { MAX_GUESTS, toAmount, type Budget } from "@/lib/budget";
import { formatPrice } from "@/lib/mock-data";

export const BUDGET_INPUT_CLASS = "mt-1 block min-h-[44px] w-full rounded-xl border border-border bg-white px-3 text-sm";

type FieldProps = {
  fields: BudgetFields;
  set: (patch: Partial<BudgetFields>) => void;
};

/** Guests, food per plate and meals: the numbers that decide most budgets. */
export function FoodFields({
  fields,
  set,
  capacityMax,
  cateringHint,
}: FieldProps & {
  /** The hall's own limit, on a hall's page; absent on the standalone calculator. */
  capacityMax?: number;
  cateringHint: string;
}) {
  const meals = useId();
  const guests = toAmount(fields.guests, MAX_GUESTS);
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-semibold text-charcoal-900">
          Guests
          <input
            inputMode="numeric"
            value={fields.guests}
            onChange={(e) => set({ guests: e.target.value })}
            placeholder="e.g. 400"
            className={BUDGET_INPUT_CLASS}
          />
        </label>
        <label className="block text-sm font-semibold text-charcoal-900">
          Food per plate (₹)
          <input
            inputMode="numeric"
            value={fields.perPlate}
            onChange={(e) => set({ perPlate: e.target.value })}
            placeholder="Ask for a rate"
            className={BUDGET_INPUT_CLASS}
          />
        </label>
      </div>
      {capacityMax != null && guests != null && guests > capacityMax && (
        <p className="mt-1 text-xs font-medium text-amber-800">
          More than this hall&apos;s {capacityMax.toLocaleString("en-IN")} guests.
        </p>
      )}
      <p className="mt-1 text-xs text-charcoal-600">{cateringHint}</p>

      <fieldset className="mt-3">
        <legend className="text-sm font-semibold text-charcoal-900">Meals per guest</legend>
        <div className="mt-1 flex gap-2">
          {["1", "2", "3"].map((m) => (
            <label
              key={m}
              className={`flex min-h-[40px] min-w-[52px] cursor-pointer items-center justify-center rounded-xl border px-3 text-sm font-semibold ${
                fields.meals === m ? "border-maroon-700 bg-maroon-50 text-maroon-800" : "border-border text-charcoal-700"
              }`}
            >
              <input type="radio" name={meals} value={m} checked={fields.meals === m} onChange={() => set({ meals: m })} className="sr-only" />
              {m}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

/** Decoration and the rest. */
export function ExtraFields({ fields, set }: FieldProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-sm font-semibold text-charcoal-900">
        Decoration (₹)
        <input inputMode="numeric" value={fields.decoration} onChange={(e) => set({ decoration: e.target.value })} placeholder="Optional" className={BUDGET_INPUT_CLASS} />
      </label>
      <label className="block text-sm font-semibold text-charcoal-900">
        Other costs (₹)
        <input inputMode="numeric" value={fields.other} onChange={(e) => set({ other: e.target.value })} placeholder="Photos, music…" className={BUDGET_INPUT_CLASS} />
      </label>
    </div>
  );
}

/** Each line, the total and the cost per guest — or what is still missing. */
export function BudgetBreakdown({
  result,
  hallLabel,
  missingHall,
}: {
  result: Budget;
  /** "Hall (full day)" on a hall's page, "Hall" on the calculator. */
  hallLabel: string;
  /** What to ask for while the hall's price is unknown ("Add the hall's quote"); null once it is known. */
  missingHall: string | null;
}) {
  return (
    <div className="rounded-xl bg-ivory-100 p-3" aria-live="polite">
      {result.lines.length === 0 ? (
        <p className="text-sm text-charcoal-600">Add guests and a per-plate rate to see the full picture.</p>
      ) : (
        <>
          <dl className="space-y-1.5 text-sm">
            {result.lines.map((l) => (
              <div key={l.key} className="flex items-start justify-between gap-3">
                <dt className="text-charcoal-700">
                  {l.key === "hall" ? hallLabel : l.label}
                  {l.detail && <span className="block text-xs text-charcoal-500">{l.detail}</span>}
                </dt>
                <dd className="shrink-0 font-medium text-charcoal-900">{formatPrice(l.amount)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
            <span className="text-sm font-semibold text-charcoal-900">{result.complete ? "Estimated total" : "Total so far"}</span>
            <span className="font-serif text-lg font-bold text-maroon-700">{formatPrice(result.total)}</span>
          </div>
          {result.perGuest != null && (
            <p className="text-right text-xs text-charcoal-600">About {formatPrice(result.perGuest)} a guest</p>
          )}
          {!result.complete && (
            <p className="mt-1 text-xs text-charcoal-600">
              {missingHall ?? "Add guests and a per-plate rate"} for the full picture.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Under the hall page's estimate, where the hall's price is the listed one. */
export const HALL_ESTIMATE_DISCLAIMER =
  "An estimate from the hall's listed price and your numbers, not a quote. The hall and your caterer give you the real figures.";

/** Under the calculator, where every number is the family's own. */
export const CALCULATOR_DISCLAIMER =
  "An estimate from your own numbers, not a quote. The hall and your caterer give you the real figures.";
