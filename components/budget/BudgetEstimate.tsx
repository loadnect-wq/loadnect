"use client";

// ─────────────────────────────────────────────────────────────────────────────
// "Plan your budget" on the venue page: the hall's listed price plus the
// family's own numbers. See lib/budget.ts for what is and is not claimed.
// Guests, per-plate rate, meals and the other costs are remembered in this
// browser (useBudgetInputs), so the next hall starts from the same numbers.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { Calculator, MessageCircle } from "lucide-react";
import { useBudgetInputs } from "@/lib/hooks/useBudgetInputs";
import { HALL_GST_PERCENT, MAX_GUESTS, SLOT_LABEL, budget, budgetSummary, toAmount, type HallSlot } from "@/lib/budget";
import { formatPrice } from "@/lib/mock-data";
import { absoluteUrl } from "@/lib/seo/config";
import { whatsappShareUrl } from "@/lib/shortlist";

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

  const input = "mt-1 block min-h-[44px] w-full rounded-xl border border-border bg-white px-3 text-sm";

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
              className={input}
            />
          </label>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold text-charcoal-900">
            Guests
            <input
              inputMode="numeric"
              value={fields.guests}
              onChange={(e) => set({ guests: e.target.value })}
              placeholder="e.g. 400"
              className={input}
            />
          </label>
          <label className="block text-sm font-semibold text-charcoal-900">
            Food per plate (₹)
            <input
              inputMode="numeric"
              value={fields.perPlate}
              onChange={(e) => set({ perPlate: e.target.value })}
              placeholder="Ask for a rate"
              className={input}
            />
          </label>
        </div>
        {guests != null && guests > capacityMax && (
          <p className="mt-1 text-xs font-medium text-amber-800">
            More than this hall&apos;s {capacityMax.toLocaleString("en-IN")} guests.
          </p>
        )}
        <p className="mt-1 text-xs text-charcoal-600">
          {inHouseCatering
            ? "This hall lists in-house catering. Ask it for its per-plate rate."
            : "Ask the hall or your caterer for a per-plate rate."}
        </p>

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
                <input type="radio" name="meals" value={m} checked={fields.meals === m} onChange={() => set({ meals: m })} className="sr-only" />
                {m}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold text-charcoal-900">
            Decoration (₹)
            <input inputMode="numeric" value={fields.decoration} onChange={(e) => set({ decoration: e.target.value })} placeholder="Optional" className={input} />
          </label>
          <label className="block text-sm font-semibold text-charcoal-900">
            Other costs (₹)
            <input inputMode="numeric" value={fields.other} onChange={(e) => set({ other: e.target.value })} placeholder="Photos, music…" className={input} />
          </label>
        </div>

        {hallRent != null && (
          <label className="mt-3 flex min-h-[40px] items-center gap-2 text-sm text-charcoal-800">
            <input type="checkbox" checked={addGst} onChange={(e) => setAddGst(e.target.checked)} className="h-4 w-4 accent-maroon-700" />
            The hall&apos;s price is before GST (add {HALL_GST_PERCENT}%)
          </label>
        )}

        <div className="mt-4 rounded-xl bg-ivory-100 p-3" aria-live="polite">
          {result.lines.length === 0 ? (
            <p className="text-sm text-charcoal-600">Add guests and a per-plate rate to see the full picture.</p>
          ) : (
            <>
              <dl className="space-y-1.5 text-sm">
                {result.lines.map((l) => (
                  <div key={l.key} className="flex items-start justify-between gap-3">
                    <dt className="text-charcoal-700">
                      {l.key === "hall" ? `Hall (${SLOT_LABEL[slot].toLowerCase()})` : l.label}
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
                  {hallRent == null ? "Add the hall's quote" : "Add guests and a per-plate rate"} for the full picture.
                </p>
              )}
            </>
          )}
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-charcoal-500">
          An estimate from the hall&apos;s listed price and your numbers, not a quote. The hall and your caterer give you the real figures.
        </p>

        {/* Only a real budget is worth sending: the hall's price alone is
            already on the page the family would share. */}
        {result.complete && (
          <a
            href={share}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1f8f4e] px-4 text-sm font-semibold text-white hover:bg-[#19773f]"
          >
            <MessageCircle className="h-4 w-4" aria-hidden /> Send this estimate to the family
          </a>
        )}
      </div>
    </section>
  );
}
