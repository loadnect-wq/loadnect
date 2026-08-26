"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The two controls on this page that move real money.
//
// Both ask before firing. Neither takes an amount: the figure is decided
// server-side from the cancellation policy or the booking's stored split, so
// there is nothing here for a mistyped number to corrupt — the button only
// chooses WHICH booking, never HOW MUCH.
//
// A refund cannot be recalled, so the confirm text states the amount and the
// recipient rather than asking "are you sure?", which people click through.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useTransition } from "react";
import { AlertTriangle, Check, RefreshCw, Send } from "lucide-react";
import { issueRefund, syncRefundStatus, retryOwnerPayout } from "@/app/admin/actions";

type Result = { success: true } | { error: string };

function useMoneyAction(run: () => Promise<Result>, confirmText?: string) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function fire() {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    start(async () => {
      const r = await run();
      if ("error" in r) setError(r.error);
      else { setDone(true); setError(null); }
    });
  }
  return { pending, error, done, fire };
}

function Feedback({ error, done, doneLabel }: { error: string | null; done: boolean; doneLabel: string }) {
  if (error) {
    return (
      <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-red-700">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        {error}
      </p>
    );
  }
  if (done) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-green-700">
        <Check className="h-3 w-3 shrink-0" aria-hidden />
        {doneLabel}
      </p>
    );
  }
  return null;
}

const BTN =
  "inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors disabled:opacity-60";

export function IssueRefundButton({
  bookingId, amountLabel, state,
}: { bookingId: string; amountLabel: string; state: string }) {
  const isRetry = state === "failed";
  const { pending, error, done, fire } = useMoneyAction(
    () => issueRefund(bookingId),
    `Send ${amountLabel} back to the customer for booking ${bookingId.slice(0, 8).toUpperCase()}?\n\nThis moves real money and cannot be undone from Hallnect.`,
  );

  return (
    <div>
      <button type="button" onClick={fire} disabled={pending}
        className={`${BTN} bg-maroon-600 text-white hover:bg-maroon-700`}>
        <Send className="h-3.5 w-3.5" aria-hidden />
        {pending ? "Sending…" : isRetry ? `Retry refund ${amountLabel}` : `Refund ${amountLabel}`}
      </button>
      <Feedback error={error} done={done} doneLabel="Refund sent — reload for its latest status." />
    </div>
  );
}

export function SyncRefundButton({ bookingId }: { bookingId: string }) {
  const { pending, error, done, fire } = useMoneyAction(() => syncRefundStatus(bookingId));
  return (
    <div>
      <button type="button" onClick={fire} disabled={pending}
        className={`${BTN} border border-border bg-white text-charcoal-700 hover:bg-ivory-50`}>
        <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} aria-hidden />
        {pending ? "Checking…" : "Check status"}
      </button>
      <Feedback error={error} done={done} doneLabel="Status updated — reload to see it." />
    </div>
  );
}

export function RetryPayoutButton({
  bookingId, amountLabel,
}: { bookingId: string; amountLabel: string }) {
  const { pending, error, done, fire } = useMoneyAction(
    () => retryOwnerPayout(bookingId),
    `Retry paying ${amountLabel} to the venue owner for booking ${bookingId.slice(0, 8).toUpperCase()}?`,
  );
  return (
    <div>
      <button type="button" onClick={fire} disabled={pending}
        className={`${BTN} bg-charcoal-800 text-white hover:bg-charcoal-900`}>
        <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} aria-hidden />
        {pending ? "Retrying…" : "Retry payout"}
      </button>
      <Feedback error={error} done={done} doneLabel="Payout sent." />
    </div>
  );
}
