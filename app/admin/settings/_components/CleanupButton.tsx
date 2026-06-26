"use client";

import { useState, useTransition } from "react";
import { Wand2 } from "lucide-react";
import { cleanupExpiredBookings } from "../../actions";

export function CleanupButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      const r = await cleanupExpiredBookings();
      if ("error" in r) setResult(`Error: ${r.error}`);
      else setResult(`Cleaned ${r.cleaned} expired booking${r.cleaned === 1 ? "" : "s"}.`);
    });
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-charcoal-300 bg-white px-3 py-1.5 text-xs font-semibold text-charcoal-700 hover:bg-charcoal-50 disabled:opacity-60"
      >
        <Wand2 className="h-3.5 w-3.5" />
        {pending ? "Running…" : "Run cleanup now"}
      </button>
      {result && <p className="text-[11px] text-charcoal-600">{result}</p>}
    </div>
  );
}
