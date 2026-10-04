"use client";

// The comparison's bottom line: each hall's full-day price plus catering for
// the family's guests, from the same remembered numbers the venue pages use.
// "Lowest total" follows the comparison's rule — only halls with a published
// price compete, and a tie has no winner. See lib/budget.ts and lib/compare.ts.

import { Calculator } from "lucide-react";
import { useBudgetInputs } from "@/lib/hooks/useBudgetInputs";
import { MAX_GUESTS, budget, hallTotals, toAmount } from "@/lib/budget";
import { formatPrice } from "@/lib/mock-data";
import { PRICE_ON_REQUEST } from "@/lib/booking-mode";

export function CompareBudget({ halls }: { halls: { id: string; name: string; pricePerDay: number | null }[] }) {
  const { fields, set } = useBudgetInputs();
  const guests = toAmount(fields.guests, MAX_GUESTS);
  const perPlate = toAmount(fields.perPlate, 1_00_000);
  const meals = Number(fields.meals) || 1;
  const catering = guests != null && perPlate != null ? budget({ hallRent: null, guests, perPlate, meals, decoration: null, other: null, addGst: false }).total : null;

  const { totals, lowest: low } = hallTotals(halls.map((h) => h.pricePerDay), catering);
  const cols = { gridTemplateColumns: `repeat(${Math.max(halls.length, 1)}, minmax(0, 1fr))` };
  const input = "mt-1 block min-h-[44px] w-full rounded-xl border border-border bg-white px-3 text-sm";

  return (
    <div className="mt-4 rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
      <h2 className="flex items-center gap-2 text-base font-bold text-charcoal-900">
        <Calculator className="h-4 w-4 text-maroon-700" aria-hidden /> Hall and food together
      </h2>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <label className="block text-xs font-semibold text-charcoal-900">
          Guests
          <input inputMode="numeric" value={fields.guests} onChange={(e) => set({ guests: e.target.value })} placeholder="400" className={input} />
        </label>
        <label className="block text-xs font-semibold text-charcoal-900">
          Per plate (₹)
          <input inputMode="numeric" value={fields.perPlate} onChange={(e) => set({ perPlate: e.target.value })} placeholder="350" className={input} />
        </label>
        <label className="block text-xs font-semibold text-charcoal-900">
          Meals
          <select value={fields.meals} onChange={(e) => set({ meals: e.target.value })} className={input}>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
        </label>
      </div>

      {catering == null ? (
        <p className="mt-3 text-sm text-charcoal-600">Add guests and a per-plate rate to see each hall&apos;s total.</p>
      ) : (
        <>
          <p className="mt-3 text-xs text-charcoal-600">Food: {formatPrice(catering)} at every hall. Full-day hall price added:</p>
          <div className="mt-1 grid gap-3" style={cols}>
            {halls.map((h, i) => (
              <div key={h.id} className="min-w-0 text-sm text-charcoal-900">
                <p className="truncate text-xs text-charcoal-600">{h.name}</p>
                {totals[i] != null ? (
                  <p className="font-serif text-base font-bold text-maroon-700">{formatPrice(totals[i] as number)}</p>
                ) : (
                  <p className="text-sm">{PRICE_ON_REQUEST} + {formatPrice(catering)}</p>
                )}
                {low != null && totals[i] === low && (
                  <span className="mt-0.5 inline-block rounded-full bg-gold-50 px-2 py-0.5 text-[10px] font-semibold text-gold-800 ring-1 ring-gold-300/70">
                    Lowest total
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      <p className="mt-3 text-[11px] text-charcoal-500">An estimate from listed prices and your numbers, not a quote. Ask each hall for its per-plate rate.</p>
    </div>
  );
}
