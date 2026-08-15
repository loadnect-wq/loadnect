"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { runOverdueCommissionCheckAction } from "@/app/admin/actions";

export function RunOverdueCheck() {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await runOverdueCommissionCheckAction();
      if ("error" in r) { setError(r.error); return; }
      const s = r.summary;
      setResult(
        s.autoAdjustEnabled
          ? `Marked ${s.markedOverdue} overdue · ${s.adjustmentsCreated} new adjustment(s) · ${s.adjustmentsSkipped} already adjusted.`
          : `Marked ${s.markedOverdue} overdue. Auto-adjustment is disabled — enable it in Settings to deduct from owner settlement.`,
      );
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-charcoal-900">Overdue commission check</p>
          <p className="text-xs text-charcoal-500">
            Marks unpaid commissions past their due date as overdue and (if enabled) deducts them
            from the owner&apos;s settlement. Safe to run repeatedly — never double-deducts.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-charcoal-800 px-3 py-2 text-xs font-semibold text-white hover:bg-charcoal-900 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Run check
        </button>
      </div>
      {result && <p className="mt-2 rounded-lg bg-green-50 p-2 text-xs text-green-800">{result}</p>}
      {error &&  <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
