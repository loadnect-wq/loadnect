"use client";

// The plan's details: name, occasion, date, city, guests and budget. Used to
// start a plan and to edit one. Only the name and occasion are required — a
// family often starts planning before the astrologer has fixed the date.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { SERVICE_AREA_CITIES } from "@/lib/seo/service-areas";
import { createPlanAction, updatePlanAction } from "@/app/plan/actions";

export type PlanFormValues = {
  title: string;
  occasion: string;
  eventDate: string;
  city: string;
  guests: string;
  budget: string;
};

export function PlanDetailsForm({
  occasions,
  initial,
  planId,
}: {
  occasions: { slug: string; name: string }[];
  initial: PlanFormValues;
  /** Present when editing an existing plan. */
  planId?: string;
}) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (patch: Partial<PlanFormValues>) => setV((s) => ({ ...s, ...patch }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const res = planId ? await updatePlanAction(planId, v) : await createPlanAction(v);
      // Creating redirects on success, so only a failure comes back here.
      if (!res.ok) setError(res.error);
      else if (planId) router.push(`/plan/${planId}`);
    });
  }

  const input = "mt-1.5 block min-h-[44px] w-full rounded-xl border border-border bg-white px-3 text-sm";
  const label = "block text-sm font-semibold text-charcoal-900";

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-5 shadow-card ring-1 ring-border">
      <label className={label}>
        Name of the function
        <input
          id="plan-title"
          required
          maxLength={80}
          value={v.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="e.g. Priya and Karthik's wedding"
          className={input}
        />
      </label>

      <label className={label}>
        Occasion
        <select id="plan-occasion" required value={v.occasion} onChange={(e) => set({ occasion: e.target.value })} className={input}>
          <option value="" disabled>Choose one</option>
          {occasions.map((o) => (
            <option key={o.slug} value={o.slug}>{o.name}</option>
          ))}
        </select>
      </label>

      <div>
        <label className={label}>
          Date <span className="font-normal text-charcoal-600">(leave blank if it is not fixed yet)</span>
          <input id="plan-date" type="date" value={v.eventDate} onChange={(e) => set({ eventDate: e.target.value })} className={input} />
        </label>
        <p className="mt-1 text-xs text-charcoal-600">
          Waiting for a muhurtham? <Link href="/muhurtham-dates" className="font-semibold text-maroon-700 hover:underline">See the dates</Link>
        </p>
      </div>

      <label className={label}>
        City
        <input
          id="plan-city"
          list="plan-cities"
          maxLength={80}
          value={v.city}
          onChange={(e) => set({ city: e.target.value })}
          placeholder="e.g. Madurai"
          className={input}
        />
        <datalist id="plan-cities">
          {SERVICE_AREA_CITIES.map((c) => <option key={c} value={c} />)}
        </datalist>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          Guests
          <input id="plan-guests" inputMode="numeric" value={v.guests} onChange={(e) => set({ guests: e.target.value })} placeholder="e.g. 400" className={input} />
        </label>
        <label className={label}>
          Budget (₹)
          <input id="plan-budget" inputMode="numeric" value={v.budget} onChange={(e) => set({ budget: e.target.value })} placeholder="Optional" className={input} />
        </label>
      </div>

      {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-maroon-700 text-sm font-semibold text-white hover:bg-maroon-800 disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {planId ? "Save changes" : "Start the plan"}
      </button>
      {!planId && (
        <p className="text-center text-xs text-charcoal-600">Only you can see this plan. You can change everything later.</p>
      )}
    </form>
  );
}
