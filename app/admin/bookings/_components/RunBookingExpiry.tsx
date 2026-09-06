"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { expireOverdueBookingsAction } from "@/app/admin/actions";

/**
 * The manual trigger for the nightly booking-expiry sweep.
 *
 * expireOverdueBookingsAction existed, was admin-gated, and recorded an audit
 * entry — and NOTHING IMPORTED IT. A repo-wide grep returned exactly one hit:
 * its own definition. Its docblock said "this button is for running it now",
 * and the button was never built, while the sibling premium job had one.
 *
 * That matters more here than it would for most jobs. This sweep cancels
 * bookings and records the refunds customers are owed, so "did it run, and what
 * did it do" is a question about money. Without a trigger the only way to find
 * out was to wait for the cron and read the logs — on a plan that does not keep
 * them.
 *
 * ERRORS ARE SHOWN, NOT JUST COUNTS. The summary carries a per-row error list,
 * and reporting only "expired N" would present a run where every row failed as
 * a quiet success — which is exactly how a customer ends up never refunded.
 */
export function RunBookingExpiry() {
  const [result, setResult] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [error, setError]   = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    setResult(null);
    setErrors([]);
    startTransition(async () => {
      const r = await expireOverdueBookingsAction();
      if ("error" in r) { setError(r.error); return; }
      const s = r.summary;
      setErrors(s.errors ?? []);
      setResult(
        s.found === 0
          ? "Nothing overdue — every booking request is still inside its response window."
          : `Found ${s.found} overdue · cancelled ${s.expired} · recorded ${s.refundsRecorded} refund(s).`,
      );
    });
  }

  const failed = errors.length > 0;

  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-charcoal-900">Expire unanswered requests</p>
          <p className="text-xs text-charcoal-500">
            Cancels booking requests the venue never answered in time, records the refund
            each customer is owed, and frees the dates. Runs daily on its own; safe to run
            repeatedly.
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

      {result && (
        <p className={`mt-2 rounded-lg p-2 text-xs ${
          failed ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-800"
        }`}>
          {result}
        </p>
      )}

      {/* A run that touched rows and failed on some of them is NOT a success,
          and the count alone would read like one. */}
      {failed && (
        <div className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-800">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {errors.length} booking{errors.length === 1 ? "" : "s"} could not be processed —
            those customers have no refund recorded.
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          {errors.length > 10 && (
            <p className="mt-1">…and {errors.length - 10} more. See the server logs.</p>
          )}
        </div>
      )}

      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
