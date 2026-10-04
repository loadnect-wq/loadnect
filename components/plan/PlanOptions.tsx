"use client";

// The family vote for one category: the options being weighed (halls on
// Hallnect or any vendor by name, with the price they gave), one vote each,
// and — for people who can edit — adding, removing and choosing. Choosing
// puts the option on the board; the vote itself changes nothing but the count.

import { useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Plus } from "lucide-react";
import { useSavedHalls } from "@/lib/hooks/useSavedHalls";
import { fetchSavedHalls } from "@/app/saved/actions";
import { addOptionAction, chooseOptionAction, removeOptionAction, voteAction } from "@/app/plan/family-actions";
import { MAX_OPTIONS, votersByOption } from "@/lib/plan";
import { formatPrice } from "@/lib/mock-data";

export type OptionView = {
  id: string;
  name: string;
  hallId: string | null;
  /** The hall's page, while it is still listed. */
  hallSlug: string | null;
  /** A hall option whose hall is no longer listed (known, not merely unread). */
  hallGone: boolean;
  price: number | null;
  note: string | null;
};

export function PlanOptions({
  planId,
  category,
  me,
  canEdit,
  options,
  votes,
  names,
  chosen,
}: {
  planId: string;
  category: string;
  me: string;
  canEdit: boolean;
  options: OptionView[];
  votes: { optionId: string; userId: string }[];
  /** userId → how to show them ("You" for the viewer). */
  names: Record<string, string>;
  /** What the board has chosen: a hall id, or a vendor's name. */
  chosen: { hallId: string | null; vendorName: string | null };
}) {
  const isHall = category === "hall";
  const serverVote = votes.find((v) => v.userId === me)?.optionId ?? null;
  // The tick moves at once; when the save (and the refresh it triggers) ends,
  // React swaps in the server's answer — which on a failure is the old vote.
  const [current, setCurrent] = useOptimistic<string | null>(serverVote);
  const [armed, setArmed] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const tally = useMemo(() => {
    // The viewer's own vote counts where they just put it, not where it was.
    const others = votes.filter((v) => v.userId !== me);
    return votersByOption(current ? [...others, { optionId: current, userId: me }] : others);
  }, [votes, me, current]);

  const vote = (optionId: string) => {
    const next = current === optionId ? null : optionId;
    setError("");
    start(async () => {
      setCurrent(next);
      const res = await voteAction({ planId, category, optionId: next ?? "" });
      if (!res.ok) setError(res.error);
    });
  };

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError("");
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong. Please try again.");
      setArmed(null);
    });
  };

  // Adding: a saved hall, or anything by name.
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    act(async () => {
      const res = await addOptionAction({ planId, category, name, price, note });
      if (res.ok) {
        setName("");
        setPrice("");
        setNote("");
      }
      return res;
    });
  };

  const { ids } = useSavedHalls();
  const [saved, setSaved] = useState<{ id: string; name: string; price: number | null }[] | null>(null);
  useEffect(() => {
    if (!isHall || !canEdit || ids.length === 0) return;
    let cancelled = false;
    fetchSavedHalls(ids)
      .then((r) => { if (!cancelled) setSaved(r.halls.map((h) => ({ id: h.id, name: h.name, price: h.price_per_day }))); })
      .catch(() => { if (!cancelled) setSaved([]); });
    return () => { cancelled = true; };
  }, [isHall, canEdit, ids]);
  const savedToAdd = (ids.length === 0 ? [] : (saved ?? [])).filter((h) => !options.some((o) => o.hallId === h.id));
  const full = options.length >= MAX_OPTIONS;

  const isChosen = (o: OptionView) =>
    o.hallId ? chosen.hallId === o.hallId : chosen.hallId == null && chosen.vendorName === o.name;

  const row = (o: OptionView) => {
    const voters = tally.get(o.id) ?? [];
    const mine = current === o.id;
    const voterNames = voters.map((u) => names[u] ?? "A family member");
    return (
      <li key={o.id} className="py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {o.hallSlug ? (
                <Link href={`/halls/${o.hallSlug}`} className="font-semibold text-charcoal-900 hover:text-maroon-700">{o.name}</Link>
              ) : (
                <span className="font-semibold text-charcoal-900">{o.name}</span>
              )}
              {isChosen(o) && (
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-800">Chosen</span>
              )}
            </div>
            <p className="text-xs text-charcoal-600">
              {[o.price != null ? formatPrice(o.price) : null, o.hallGone ? "No longer on Hallnect" : null].filter(Boolean).join(" · ")}
            </p>
            {o.note && <p className="mt-0.5 text-sm text-charcoal-700">{o.note}</p>}
            <p className="mt-1 text-xs text-charcoal-700">
              {voters.length === 0 ? "No votes yet" : `${voters.length} ${voters.length === 1 ? "vote" : "votes"}: ${voterNames.join(", ")}`}
            </p>
          </div>
          <button
            type="button"
            aria-pressed={mine}
            onClick={() => vote(o.id)}
            disabled={pending}
            className={`inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-semibold disabled:opacity-60 ${
              mine ? "border-maroon-700 bg-maroon-700 text-white" : "border-border text-charcoal-800 hover:border-maroon-300"
            }`}
          >
            {mine && <Check className="h-3.5 w-3.5" aria-hidden />}
            {mine ? "Your vote" : "Vote"}
          </button>
        </div>
        {canEdit && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {!isChosen(o) && (
              <button
                type="button"
                disabled={pending}
                onClick={() => act(() => chooseOptionAction(planId, category, o.id))}
                className="min-h-[36px] text-xs font-semibold text-maroon-700 hover:underline disabled:opacity-50"
              >
                Choose this one
              </button>
            )}
            {armed === o.id ? (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => removeOptionAction(planId, category, o.id))}
                  className="min-h-[36px] rounded-lg bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                >
                  Tap to remove{voters.length ? ` and its ${voters.length === 1 ? "vote" : "votes"}` : ""}
                </button>
                <button type="button" onClick={() => setArmed(null)} className="min-h-[36px] text-xs text-charcoal-600 hover:underline">Cancel</button>
              </>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => setArmed(o.id)}
                aria-label={`Remove ${o.name} from the options`}
                className="min-h-[36px] text-xs font-semibold text-charcoal-600 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
        )}
      </li>
    );
  };

  const input = "mt-1 block min-h-[44px] w-full rounded-xl border border-border bg-white px-3 text-sm";

  return (
    <section aria-labelledby="options-heading" className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
      <h2 id="options-heading" className="text-base font-bold text-charcoal-900">Family vote</h2>
      <p className="mt-0.5 text-xs text-charcoal-600">
        Everyone in the plan has one vote{options.length > 1 ? "; tap another option to move yours" : ""}.
      </p>

      {options.length === 0 ? (
        <p className="mt-3 text-sm text-charcoal-700">
          {canEdit
            ? `No options yet. Add the ${isHall ? "halls" : "vendors"} you are choosing between, and the family can vote.`
            : "No options yet. Someone who can edit the plan adds them, and then everyone can vote."}
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-border">{options.map(row)}</ul>
      )}

      {canEdit && !full && (
        <div className="mt-3 border-t border-border pt-3">
          {isHall && savedToAdd.length > 0 && (
            <div className="mb-3">
              <p className="text-sm font-semibold text-charcoal-900">From your saved halls</p>
              <ul className="mt-2 space-y-2">
                {savedToAdd.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-charcoal-900">{h.name}</span>
                      {h.price != null && <span className="block text-xs text-charcoal-600">{formatPrice(h.price)} listed</span>}
                    </span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => act(() => addOptionAction({ planId, category, hallId: h.id, price: h.price ?? "" }))}
                      className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-lg border border-maroon-200 px-3 text-xs font-semibold text-maroon-700 hover:bg-maroon-50 disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden /> Add
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <form onSubmit={add} className="space-y-3">
            <p className="text-sm font-semibold text-charcoal-900">{isHall ? "Or a hall not on Hallnect" : "Add an option"}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem]">
              <label className="block text-sm font-semibold text-charcoal-900">
                Name
                <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={isHall ? "Hall name" : "Vendor's name"} className={input} />
              </label>
              <label className="block text-sm font-semibold text-charcoal-900">
                Price (₹)
                <input value={price} inputMode="numeric" onChange={(e) => setPrice(e.target.value)} placeholder="Optional" className={input} />
              </label>
            </div>
            <label className="block text-sm font-semibold text-charcoal-900">
              Note
              <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="What is included, who suggested it…" className={input} />
            </label>
            <button
              type="submit"
              disabled={pending || !name.trim()}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden /> Add option
            </button>
          </form>
        </div>
      )}
      {canEdit && full && (
        <p className="mt-3 border-t border-border pt-3 text-xs text-charcoal-600">
          This category has {MAX_OPTIONS} options. Remove one you have ruled out to add another.
        </p>
      )}

      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </section>
  );
}
