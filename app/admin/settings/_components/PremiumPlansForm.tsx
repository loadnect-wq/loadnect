"use client";

import { useState, useTransition } from "react";
import type { PremiumPlan } from "@/lib/premium-plans";
import { updatePremiumPlan } from "../../actions";

export function PremiumPlansForm({ plans }: { plans: PremiumPlan[] }) {
  return (
    <div className="space-y-3">
      {plans
        .filter((p) => p.slug !== "free")
        .map((plan) => (
          <PlanRow key={plan.slug} plan={plan} />
        ))}
      <p className="text-[11px] text-charcoal-500">
        Free plan features are fixed in code. Premium/Pro feature lists are also code-driven;
        only price and duration are editable here.
      </p>
    </div>
  );
}

function PlanRow({ plan }: { plan: PremiumPlan }) {
  const [price,    setPrice]    = useState(plan.monthly_price.toString());
  const [duration, setDuration] = useState(plan.duration_days.toString());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const p = Number(price);
    const d = parseInt(duration, 10);
    if (!Number.isFinite(p) || p < 0) { setMsg({ ok: false, text: "Invalid price." }); return; }
    if (!Number.isInteger(d) || d <= 0) { setMsg({ ok: false, text: "Duration must be a positive integer." }); return; }

    startTransition(async () => {
      const r = await updatePremiumPlan({
        slug: plan.slug as "premium" | "pro",
        monthly_price: p,
        duration_days: d,
      });
      if ("error" in r) setMsg({ ok: false, text: r.error });
      else setMsg({ ok: true, text: "Saved." });
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-serif text-sm font-semibold text-charcoal-900">
          {plan.slug === "pro" ? "★" : "✦"} {plan.name}
        </p>
        <span className="rounded-full bg-ivory-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-charcoal-600">
          {plan.slug}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Price (₹)</span>
          <input
            type="number" min="0" step="0.01"
            value={price} onChange={(e) => setPrice(e.target.value)}
            className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm focus:border-maroon-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Duration (days)</span>
          <input
            type="number" min="1" step="1"
            value={duration} onChange={(e) => setDuration(e.target.value)}
            className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm focus:border-maroon-500 focus:outline-none"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-maroon-600 px-3 py-2 text-xs font-semibold text-white hover:bg-maroon-700 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {msg && (
        <p className={`text-[11px] font-semibold ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}
    </form>
  );
}
