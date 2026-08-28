"use client";

import { useState, useTransition } from "react";
import { Loader2, XCircle } from "lucide-react";
import { cancelPlanSubscriptionAction } from "@/app/owner/(dashboard)/actions";

// ─────────────────────────────────────────────────────────────────────────────
// Stops future monthly billing.
//
// Deliberately two clicks. Cancelling a standing mandate is not something to do
// by accident, and there is no undo — restarting means authorising a new
// mandate with the bank.
//
// It does NOT take back the month already paid for. The copy says so before the
// owner commits, because "cancel" on a subscription commonly means "lose access
// now", and that is not what happens here.
// ─────────────────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });
}

export function CancelSubscription({
  subscriptionId,
  planName,
  paidUntil,
}: {
  subscriptionId: string;
  planName: string;
  paidUntil: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <p className="rounded-lg bg-charcoal-100 px-3 py-2 text-xs text-charcoal-700">{done}</p>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-[11px] font-semibold text-white/80 underline hover:text-white"
      >
        Cancel monthly renewal
      </button>
    );
  }

  return (
    <div className="rounded-xl bg-white/15 p-3">
      <p className="text-xs text-white">
        Stop renewing {planName}?{" "}
        {paidUntil
          ? `Your boost stays on until ${fmt(paidUntil)} — you keep the month you have paid for. After that it simply ends.`
          : "You keep any month you have already paid for; nothing further will be charged."}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await cancelPlanSubscriptionAction(subscriptionId);
              if ("error" in r) { setError(r.error); return; }
              setDone(
                r.until
                  ? `Renewal cancelled. Your boost runs until ${fmt(r.until)}.`
                  : "Renewal cancelled. Nothing further will be charged.",
              );
            })
          }
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-charcoal-900 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
          Yes, stop renewing
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => { setConfirming(false); setError(null); }}
          className="inline-flex min-h-[36px] items-center rounded-lg border border-white/40 px-3 text-xs font-semibold text-white disabled:opacity-60"
        >
          Keep it
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] text-red-100">{error}</p>}
    </div>
  );
}
