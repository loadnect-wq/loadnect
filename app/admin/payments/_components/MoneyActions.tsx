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
import { issueRefund, syncRefundStatus,
         sendOwnerPayout, reconcileOwnerPayout, registerOwnerBeneficiary } from "@/app/admin/actions";

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
  paymentId, bookingId, amountLabel, state,
}: { paymentId: string; bookingId: string; amountLabel: string; state: string }) {
  const isRetry = state === "failed";
  // paymentId, not bookingId: a booking can carry TWO captures — the customer
  // was told the first had not landed and paid again — and only one of them is
  // the one owed back. bookingId stays for the confirmation copy, which is what
  // the admin recognises the row by.
  const { pending, error, done, fire } = useMoneyAction(
    () => issueRefund(paymentId),
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

export function SyncRefundButton({ paymentId }: { paymentId: string }) {
  const { pending, error, done, fire } = useMoneyAction(() => syncRefundStatus(paymentId));
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


// ── Cashfree Payouts ────────────────────────────────────────────────────────

/**
 * SEND. The only control in the product that moves money to a venue.
 *
 * The confirm names the amount, the venue and the last four of the destination
 * account, because "are you sure?" is a question people click through and
 * "send Rs22,500 to Grand Mahal, account ending 4471" is one they read. Every
 * guard behind it is re-run server-side; this button only chooses which
 * booking, never how much and never where.
 */
export function SendPayoutButton({
  bookingId, amountLabel, hallName, accountHint, disabledReason,
}: {
  bookingId: string; amountLabel: string; hallName: string;
  accountHint: string | null; disabledReason: string | null;
}) {
  const { pending, error, done, fire } = useMoneyAction(
    () => sendOwnerPayout(bookingId),
    `Send ${amountLabel} to ${hallName}${accountHint ? `, account ending ${accountHint}` : ""}?

`
      + `This transfers real money through Cashfree and cannot be recalled.`,
  );
  if (disabledReason) {
    return (
      <span className="text-[11px] font-medium text-charcoal-500" title={disabledReason}>
        {disabledReason}
      </span>
    );
  }
  return (
    <div>
      <button type="button" onClick={fire} disabled={pending}
        className={`${BTN} bg-green-700 text-white hover:bg-green-800`}>
        <Send className={`h-3.5 w-3.5 ${pending ? "animate-pulse" : ""}`} aria-hidden />
        {pending ? "Sending…" : `Send ${amountLabel}`}
      </button>
      <Feedback error={error} done={done} doneLabel="Transfer sent." />
    </div>
  );
}

/**
 * RECONCILE. Asks Cashfree what actually happened.
 *
 * This is the recovery path for every uncertain state, and there are more of
 * them than under Easy Split: a dispatch that timed out, a transfer sitting in
 * APPROVAL_PENDING, or a SUCCESS that later reversed. It never sends anything,
 * so it is safe to press repeatedly — which matters, because the alternative an
 * anxious operator reaches for is pressing Send again.
 */
export function ReconcilePayoutButton({ payoutId }: { payoutId: string }) {
  const { pending, error, done, fire } = useMoneyAction(() => reconcileOwnerPayout(payoutId));
  return (
    <div>
      <button type="button" onClick={fire} disabled={pending}
        className={`${BTN} bg-charcoal-800 text-white hover:bg-charcoal-900`}>
        <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} aria-hidden />
        {pending ? "Checking…" : "Reconcile"}
      </button>
      <Feedback error={error} done={done} doneLabel="Status updated." />
    </div>
  );
}

/** Registers the owner's bank details with Cashfree. Only VERIFIED can be paid. */
export function RegisterBeneficiaryButton({
  hallOwnerId, currentStatus,
}: { hallOwnerId: string; currentStatus: string | null }) {
  const { pending, error, done, fire } = useMoneyAction(() => registerOwnerBeneficiary(hallOwnerId));
  return (
    <div>
      <button type="button" onClick={fire} disabled={pending}
        className={`${BTN} bg-maroon-700 text-white hover:bg-maroon-800`}>
        <Check className={`h-3.5 w-3.5 ${pending ? "animate-pulse" : ""}`} aria-hidden />
        {pending ? "Registering…" : currentStatus ? "Re-check account" : "Register account"}
      </button>
      <Feedback error={error} done={done} doneLabel="Account checked." />
    </div>
  );
}
