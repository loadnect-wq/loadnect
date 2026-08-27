"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { expirePremiumListingsAction } from "@/app/admin/actions";

export function RunPremiumExpiry() {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await expirePremiumListingsAction();
      if ("error" in r) { setError(r.error); return; }
      const s = r.summary;
      setResult(
        s.deactivated === 0 && s.hallsRecomputed === 0
          ? "Nothing to expire — every promoted hall has a live listing behind it."
          : `Retired ${s.deactivated} expired listing(s) · corrected ${s.hallsRecomputed} stale hall tier(s).`,
      );
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-charcoal-900">Expire lapsed listings</p>
          <p className="text-xs text-charcoal-500">
            Retires listings past their end date and clears any hall still ranking as Premium or Pro
            without a live listing behind it. Runs daily on its own; safe to run repeatedly.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-charcoal-800 px-3 py-2 text-xs font-semibold text-white hover:bg-charcoal-900 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Run now
        </button>
      </div>
      {result && <p className="mt-2 rounded-lg bg-green-50 p-2 text-xs text-green-800">{result}</p>}
      {error &&  <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
