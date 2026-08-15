"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { createPremiumListing } from "../../actions";

type HallOption = { id: string; name: string; slug: string };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function plusDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function CreateListingForm({ halls }: { halls: HallOption[] }) {
  const start = todayIso();
  const [hallId,   setHallId]   = useState("");
  const [plan,     setPlan]     = useState<"premium" | "pro">("premium");
  const [startDate, setStartDate] = useState(start);
  const [endDate,   setEndDate]   = useState(plusDays(start, 30));
  const [amount,   setAmount]   = useState("999");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    if (!hallId) { setMsg({ ok: false, text: "Choose a hall." }); return; }
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) { setMsg({ ok: false, text: "Invalid amount." }); return; }

    startTransition(async () => {
      const r = await createPremiumListing({
        hallId, planSlug: plan, startDate, endDate, amount: n,
      });
      if ("error" in r) setMsg({ ok: false, text: r.error });
      else {
        setMsg({ ok: true, text: "Premium listing created." });
        setHallId("");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-4 shadow-card space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-gold-600" />
        <h3 className="font-serif text-sm font-semibold text-charcoal-900">Grant premium manually</h3>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Hall</span>
          <select
            value={hallId}
            onChange={(e) => setHallId(e.target.value)}
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
            required
          >
            <option value="">Pick an approved hall…</option>
            {halls.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Plan</span>
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value as "premium" | "pro")}
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
          >
            <option value="premium">Premium</option>
            <option value="pro">Pro</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Amount (₹)</span>
          <input
            type="number" min="0" step="0.01"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Start date</span>
          <input
            type="date"
            value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">End date</span>
          <input
            type="date"
            value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none"
            required
          />
        </label>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-charcoal-500">
          The hall&apos;s premium tier syncs automatically once the listing is active.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-maroon-600 px-4 py-2 text-xs font-semibold text-white hover:bg-maroon-700 disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create listing"}
        </button>
      </div>

      {msg && (
        <p className={`text-[11px] font-semibold ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}
    </form>
  );
}
