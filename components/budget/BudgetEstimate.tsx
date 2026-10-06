"use client";

// ─────────────────────────────────────────────────────────────────────────────
// "Plan your budget" on the venue page: the hall's listed price plus the
// family's own numbers. See lib/budget.ts for what is and is not claimed.
// Guests, per-plate rate, meals and the other costs are remembered in this
// browser (useBudgetInputs), so the next hall — and the standalone calculator
// at /budget — start from the same numbers. The fields and the breakdown are
// shared with that calculator (./budget-parts).
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import Link from "next/link";
import { Calculator, MessageCircle } from "lucide-react";
import { useBudgetInputs } from "@/lib/hooks/useBudgetInputs";
import { HALL_GST_PERCENT, MAX_GUESTS, SLOT_LABEL, budget, budgetSummary, toAmount, type HallSlot } from "@/lib/budget";
import { BUDGET_PATH } from "@/lib/family-tools";
import { formatPrice } from "@/lib/mock-data";
import { absoluteUrl } from "@/lib/seo/config";
import { whatsappShareUrl } from "@/lib/shortlist";
import { BUDGET_INPUT_CLASS, BudgetBreakdown, ExtraFields, FoodFields, HALL_ESTIMATE_DISCLAIMER } from "./budget-parts";

export function BudgetEstimate({
  hallName,
  hallSlug,
  prices,
  capacityMax,
  inHouseCatering,
}: {
  hallName: string;
  hallSlug: string;
  prices: { full_day: number | null; morning: number | null; evening: number | null };
  capacityMax: number;
  inHouseCatering: boolean;
}) {
  const { fields, set } = useBudgetInputs();
  const slots = (Object.keys(prices) as HallSlot[]).filter((s) => prices[s] != null && (prices[s] as number) > 0);
  const [slot, setSlot] = useState<HallSlot>(slots[0] ?? "full_day");
  const [quote, setQuote] = useState("");
  const [addGst, setAddGst] = useState(false);

  const listed = prices[slot] != null && (prices[slot] as number) > 0 ? (prices[slot] as number) : null;
  const hallRent = listed ?? toAmount(quote);
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
  const share = whatsappShareUrl(budgetSummary(hallName, slot, result, absoluteUrl(`/halls/${hallSlug}`)));

  return (
    <section className="mt-6" aria-labelledby="budget-title">
      <h2 id="budget-title" className="flex items-center gap-2 font-serif text-base font-semibold text-charcoal-900">
        <Calculator className="h-4 w-4 text-maroon-700" aria-hidden /> Plan your budget
      </h2>
      <div className="mt-3 rounded-2xl bg-white p-4 shadow-card">
        <p className="text-sm text-charcoal-700">
          The hall is only part of the cost. Add your numbers to see the whole function.
        </p>

        {slots.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Hall booking">
            {slots.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={slot === s}
                onClick={() => setSlot(s)}
                className={`min-h-[40px] rounded-xl border px-3 text-xs font-semibold ${
                  slot === s ? "border-maroon-700 bg-maroon-50 text-maroon-800" : "border-border text-charcoal-700"
                }`}
              >
                {SLOT_LABEL[s]} · {formatPrice(prices[s] as number)}
              </button>
            ))}
          </div>
        )}

        {slots.length === 0 && (
          <label className="mt-3 block text-sm font-semibold text-charcoal-900">
            The hall&apos;s quote (₹)
            <input
              inputMode="numeric"
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              placeholder="This hall gives its price on request"
              className={BUDGET_INPUT_CLASS}
            />
          </label>
        )}

        <div className="mt-3">
          <FoodFields
            fields={fields}
            set={set}
            capacityMax={capacityMax}
            cateringHint={
              inHouseCatering
                ? "This hall lists in-house catering. Ask it for its per-plate rate."
                : "Ask the hall or your caterer for a per-plate rate."
            }
          />
        </div>

        <div className="mt-3">
          <ExtraFields fields={fields} set={set} />
        </div>

        {hallRent != null && (
          <label className="mt-3 flex min-h-[40px] items-center gap-2 text-sm text-charcoal-800">
            <input type="checkbox" checked={addGst} onChange={(e) => setAddGst(e.target.checked)} className="h-4 w-4 accent-maroon-700" />
            The hall&apos;s price is before GST (add {HALL_GST_PERCENT}%)
          </label>
        )}

        <div className="mt-4">
          <BudgetBreakdown
            result={result}
            hallLabel={`Hall (${SLOT_LABEL[slot].toLowerCase()})`}
            missingHall={hallRent == null ? "Add the hall's quote" : null}
          />
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-charcoal-500">{HALL_ESTIMATE_DISCLAIMER}</p>

        {/* Only a real budget is worth sending: the hall's price alone is
            already on the page the family would share. */}
        {result.complete && (
          <a
            href={share}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1a7f45] px-4 text-sm font-semibold text-white hover:bg-[#166b3a]"
          >
            <MessageCircle className="h-4 w-4" aria-hidden /> Send this estimate to the family
          </a>
        )}

        {/* The same numbers, without a hall: for the family still deciding. */}
        <p className="mt-3 text-xs text-charcoal-600">
          Still choosing a hall?{" "}
          <Link href={BUDGET_PATH} className="font-semibold text-maroon-700 hover:underline">
            Open the budget calculator
          </Link>
          . Your numbers come with you.
        </p>
      </div>
    </section>
  );
}
