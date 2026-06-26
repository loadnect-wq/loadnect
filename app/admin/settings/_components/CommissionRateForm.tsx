"use client";

import { useState, useTransition } from "react";
import { Percent } from "lucide-react";
import { updateCommissionPercent } from "../../actions";

export function CommissionRateForm({ initialPercent }: { initialPercent: number }) {
  const [value, setValue]   = useState(initialPercent.toString());
  const [msg,   setMsg]     = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      setMsg({ ok: false, text: "Enter a number between 0 and 100." });
      return;
    }
    startTransition(async () => {
      const r = await updateCommissionPercent(n);
      if ("error" in r) setMsg({ ok: false, text: r.error });
      else setMsg({ ok: true, text: `Saved. New commission is ${n}%.` });
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <label htmlFor="commission_percent" className="block text-xs font-semibold text-charcoal-700">
        Commission percentage
      </label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            id="commission_percent"
            name="commission_percent"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 pr-8 text-sm focus:border-maroon-500 focus:outline-none"
            disabled={pending}
          />
          <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-charcoal-400" />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-maroon-600 px-4 py-2 text-xs font-semibold text-white hover:bg-maroon-700 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="text-[11px] text-charcoal-500">
        Applied to new bookings only. Existing commissions keep the rate that was
        active at booking time.
      </p>
      {msg && (
        <p className={`text-[11px] font-semibold ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}
    </form>
  );
}
