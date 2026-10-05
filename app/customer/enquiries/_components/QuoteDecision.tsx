"use client";

// The family's answer to a venue's quote (0112). Accepting is the moment the
// venue gets their phone number, so it is a two-step control that says so in
// words before it happens. Turning a quote down ends the enquiry, and the
// venue never gets the number.

import { useState, useTransition } from "react";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { acceptQuoteAction, declineQuoteAction, requestNewQuoteAction } from "@/app/enquiry/[slug]/actions";

export function QuoteDecision({ leadId, hallName, expired }: { leadId: string; hallName: string; expired: boolean }) {
  const [mode, setMode] = useState<"idle" | "accept" | "decline">("idle");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ success: true } | { error: string }>) => {
    setError("");
    start(async () => {
      const r = await fn();
      if ("error" in r) setError(r.error);
      else setMode("idle");
    });
  };

  const errorLine = error && <p role="alert" className="mt-2 text-[11px] font-semibold text-red-700">{error}</p>;

  if (expired) {
    return (
      <div className="mt-2.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => requestNewQuoteAction(leadId))}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-maroon-200 bg-white px-3.5 text-xs font-semibold text-maroon-700 hover:bg-maroon-50 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
          Ask for a new quote
        </button>
        {errorLine}
      </div>
    );
  }

  if (mode === "accept") {
    return (
      <div className="mt-2.5 rounded-xl border border-green-200 bg-green-50 p-3">
        <p className="text-xs font-semibold text-green-900">Share your number with {hallName}?</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-green-900/80">
          {hallName} gets the number you verified and will call you to book. No other hall gets it.
        </p>
        {errorLine}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => acceptQuoteAction(leadId))}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-green-700 px-3.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
            Yes, accept the quote
          </button>
          <button type="button" disabled={pending} onClick={() => setMode("idle")} className="min-h-[40px] px-2 text-xs font-semibold text-charcoal-600 hover:underline">
            Not yet
          </button>
        </div>
      </div>
    );
  }

  if (mode === "decline") {
    return (
      <div className="mt-2.5 rounded-xl border border-border bg-ivory-50 p-3">
        <label htmlFor={`why-${leadId}`} className="text-[11px] font-semibold text-charcoal-700">
          Tell the hall why? (optional)
        </label>
        <input
          id={`why-${leadId}`}
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          disabled={pending}
          placeholder="Over our budget"
          className="mt-1 w-full rounded-lg border border-border bg-white px-2.5 py-2 text-xs focus:border-maroon-500 focus:outline-none"
        />
        {errorLine}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => declineQuoteAction(leadId, reason))}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-charcoal-800 px-3.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Turn down this quote
          </button>
          <button type="button" disabled={pending} onClick={() => setMode("idle")} className="min-h-[40px] px-2 text-xs font-semibold text-charcoal-600 hover:underline">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("accept")}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-maroon-700 px-3.5 text-xs font-semibold text-white hover:bg-maroon-800"
        >
          <Check className="h-3.5 w-3.5" aria-hidden /> Accept and share my number
        </button>
        <button
          type="button"
          onClick={() => setMode("decline")}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-border bg-white px-3.5 text-xs font-semibold text-charcoal-700 hover:bg-ivory-100"
        >
          <X className="h-3.5 w-3.5" aria-hidden /> Not for us
        </button>
      </div>
      {errorLine}
    </div>
  );
}
