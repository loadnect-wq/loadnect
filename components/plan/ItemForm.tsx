"use client";

// One category of a plan: where it stands, who is chosen, the money and the
// next payment. The hall category picks from the family's saved halls (or a
// hall not on Hallnect); catering can work its cost out from the plan's guest
// count. Every figure is the family's own; a hall's listed price is offered,
// never filled in silently.

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useSavedHalls } from "@/lib/hooks/useSavedHalls";
import { fetchSavedHalls } from "@/app/saved/actions";
import { updateItemAction } from "@/app/plan/actions";
import { ITEM_STATUSES, STATUS_LABEL, type ItemStatus } from "@/lib/plan";
import { budget as workOut, toAmount } from "@/lib/budget";
import { formatPrice } from "@/lib/mock-data";
import { formatHallPrice } from "@/lib/booking-mode";

export type ItemFormValues = {
  status: ItemStatus;
  hallId: string;
  vendorName: string;
  vendorPhone: string;
  notes: string;
  plannedAmount: string;
  quotedAmount: string;
  paidAmount: string;
  nextDueDate: string;
  nextDueAmount: string;
};

type HallOption = { id: string; name: string; city: string; price: number | null };

export function ItemForm({
  planId,
  category,
  initial,
  chosenHall,
  guests,
  findHallsHref,
}: {
  planId: string;
  category: string;
  initial: ItemFormValues;
  /** The hall currently chosen, when it is still listed. */
  chosenHall: HallOption | null;
  guests: number | null;
  findHallsHref: string;
}) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (patch: Partial<ItemFormValues>) => setV((s) => ({ ...s, ...patch }));
  const isHall = category === "hall";
  const isCatering = category === "catering";

  // Saved halls, for the hall category.
  const { ids } = useSavedHalls();
  const [saved, setSaved] = useState<HallOption[] | null>(null);
  useEffect(() => {
    if (!isHall || ids.length === 0) return;
    let cancelled = false;
    fetchSavedHalls(ids)
      .then((r) => {
        if (!cancelled) setSaved(r.halls.map((h) => ({ id: h.id, name: h.name, city: h.city, price: h.price_per_day })));
      })
      .catch(() => { if (!cancelled) setSaved([]); });
    return () => { cancelled = true; };
  }, [isHall, ids]);
  const options: HallOption[] = [
    ...(chosenHall ? [chosenHall] : []),
    ...(ids.length === 0 ? [] : (saved ?? [])).filter((h) => h.id !== chosenHall?.id),
  ];
  const selected = options.find((h) => h.id === v.hallId) ?? null;

  // Catering: guests × per plate × meals.
  const [perPlate, setPerPlate] = useState("");
  const [meals, setMeals] = useState("1");
  const cateringTotal = isCatering && guests
    ? workOut({ hallRent: null, guests, perPlate: toAmount(perPlate, 1_00_000), meals: Number(meals), decoration: null, other: null, addGst: false }).total
    : 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const res = await updateItemAction({ planId, category, ...v });
      if (res.ok) router.push(`/plan/${planId}`);
      else setError(res.error);
    });
  }

  const input = "mt-1 block min-h-[44px] w-full rounded-xl border border-border bg-white px-3 text-sm";
  const label = "block text-sm font-semibold text-charcoal-900";

  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
        <legend className="sr-only">Where it stands</legend>
        <p aria-hidden className="text-sm font-semibold text-charcoal-900">Where it stands</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ITEM_STATUSES.map((s) => (
            <label
              key={s}
              className={`flex min-h-[40px] cursor-pointer items-center rounded-full border px-3 text-xs font-semibold ${
                v.status === s ? "border-maroon-700 bg-maroon-50 text-maroon-800" : "border-border text-charcoal-700"
              }`}
            >
              <input type="radio" name="status" value={s} checked={v.status === s} onChange={() => set({ status: s })} className="sr-only" />
              {STATUS_LABEL[s]}
            </label>
          ))}
        </div>
      </fieldset>

      {isHall && (
        <fieldset className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
          <legend className="sr-only">The hall</legend>
          <p aria-hidden className="text-sm font-semibold text-charcoal-900">The hall</p>
          {options.length === 0 ? (
            <p className="mt-1 text-sm text-charcoal-700">
              Tap the heart on halls you like and they appear here to choose from.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {options.map((h) => (
                <li key={h.id}>
                  <label className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${v.hallId === h.id ? "border-maroon-700 bg-maroon-50" : "border-border"}`}>
                    <input type="radio" name="hall" checked={v.hallId === h.id} onChange={() => set({ hallId: h.id })} className="h-4 w-4 accent-maroon-700" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-charcoal-900">{h.name}</span>
                      <span className="block text-xs text-charcoal-600">{h.city} · {formatHallPrice(h.price)}</span>
                    </span>
                  </label>
                </li>
              ))}
              {v.hallId && (
                <li>
                  <button type="button" onClick={() => set({ hallId: "" })} className="min-h-[40px] text-sm font-semibold text-charcoal-700 hover:underline">
                    No hall chosen yet
                  </button>
                </li>
              )}
            </ul>
          )}
          {selected?.price != null && selected.price > 0 && !v.plannedAmount && (
            <button
              type="button"
              onClick={() => set({ plannedAmount: String(selected.price) })}
              className="mt-2 min-h-[40px] text-sm font-semibold text-maroon-700 hover:underline"
            >
              Use its listed price, {formatPrice(selected.price)}, as the planned amount
            </button>
          )}
          <Link href={findHallsHref} className="mt-2 block min-h-[40px] text-sm font-semibold text-maroon-700 hover:underline">
            Find halls for your date
          </Link>
        </fieldset>
      )}

      <fieldset className="space-y-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
        <legend className="sr-only">{isHall ? "Or a hall not on Hallnect" : "Who you are using"}</legend>
        <p aria-hidden className="text-sm font-semibold text-charcoal-900">{isHall ? "Or a hall not on Hallnect" : "Who you are using"}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={label}>
            Name
            <input id="item-vendor" maxLength={120} value={v.vendorName} onChange={(e) => set({ vendorName: e.target.value })} placeholder={isHall ? "Hall name" : "Vendor's name"} className={input} />
          </label>
          <label className={label}>
            Phone
            <input id="item-phone" inputMode="tel" maxLength={20} value={v.vendorPhone} onChange={(e) => set({ vendorPhone: e.target.value })} placeholder="Optional" className={input} />
          </label>
        </div>
        <label className={label}>
          Notes
          <textarea id="item-notes" rows={3} maxLength={1000} value={v.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Menu, package, what is included…" className="mt-1 block w-full rounded-xl border border-border px-3 py-2 text-sm" />
        </label>
      </fieldset>

      {isCatering && (
        <fieldset className="rounded-2xl bg-ivory-50 p-4 ring-1 ring-border">
          <legend className="sr-only">Work out the cost</legend>
          <p aria-hidden className="text-sm font-semibold text-charcoal-900">Work out the cost</p>
          {guests ? (
            <>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className={label}>
                  Per plate (₹)
                  <input id="item-per-plate" inputMode="numeric" value={perPlate} onChange={(e) => setPerPlate(e.target.value)} placeholder="Ask for a rate" className={input} />
                </label>
                <label className={label}>
                  Meals
                  <select id="item-meals" value={meals} onChange={(e) => setMeals(e.target.value)} className={input}>
                    <option value="1">1</option><option value="2">2</option><option value="3">3</option>
                  </select>
                </label>
              </div>
              {cateringTotal > 0 && (
                <button
                  type="button"
                  onClick={() => set(v.status === "booked" ? { quotedAmount: String(cateringTotal) } : { plannedAmount: String(cateringTotal) })}
                  className="mt-2 min-h-[40px] text-sm font-semibold text-maroon-700 hover:underline"
                >
                  {guests.toLocaleString("en-IN")} guests: {formatPrice(cateringTotal)}. Use it as the {v.status === "booked" ? "agreed" : "planned"} amount
                </button>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-charcoal-700">Add the number of guests to the plan to work this out.</p>
          )}
        </fieldset>
      )}

      <fieldset className="space-y-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
        <legend className="sr-only">Money</legend>
        <p aria-hidden className="text-sm font-semibold text-charcoal-900">Money</p>
        <div className="grid grid-cols-3 gap-3">
          <label className={label}>
            Planned (₹)
            <input id="item-planned" inputMode="numeric" value={v.plannedAmount} onChange={(e) => set({ plannedAmount: e.target.value })} className={input} />
          </label>
          <label className={label}>
            {v.status === "booked" ? "Agreed (₹)" : "Quoted (₹)"}
            <input id="item-quoted" inputMode="numeric" value={v.quotedAmount} onChange={(e) => set({ quotedAmount: e.target.value })} className={input} />
          </label>
          <label className={label}>
            Paid (₹)
            <input id="item-paid" inputMode="numeric" value={v.paidAmount} onChange={(e) => set({ paidAmount: e.target.value })} className={input} />
          </label>
        </div>
        <p className="text-sm font-semibold text-charcoal-900">Next payment</p>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Amount (₹)
            <input id="item-due-amount" inputMode="numeric" value={v.nextDueAmount} onChange={(e) => set({ nextDueAmount: e.target.value })} className={input} />
          </label>
          <label className={label}>
            Due on
            <input id="item-due-date" type="date" value={v.nextDueDate} onChange={(e) => set({ nextDueDate: e.target.value })} className={input} />
          </label>
        </div>
      </fieldset>

      {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-maroon-700 text-sm font-semibold text-white hover:bg-maroon-800 disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Save
      </button>
    </form>
  );
}
