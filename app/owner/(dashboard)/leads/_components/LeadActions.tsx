"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The ✓ Confirm control.
//
// This is the most consequential button in the owner dashboard: pressing it
// creates a debt. So it is deliberately a TWO-STEP control — tapping Confirm
// opens a small form asking what was actually agreed, and only submitting that
// form performs the action. An accidental tap on a phone costs nothing.
//
// WHAT THIS COMPONENT CANNOT DO, structurally:
//   • It cannot set a status. It calls a server action which resolves the lead,
//     proves ownership and performs the transition under a status guard.
//   • It cannot choose the commission rate. It does not know it and never
//     receives it — the server reads it from the hall.
//   • It cannot confirm twice. `pending` disables the button, and the server is
//     idempotent underneath (uq_commission_per_lead, plus the compare-and-set
//     on the lead's status).
//
// The estimate shown under the amount field is computed FROM A RATE THE SERVER
// SENT DOWN for this owner's own hall. It is a courtesy, and it is labelled as
// an estimate, because the figure that will actually be charged is recomputed
// server-side from the same rate at the moment of confirmation.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { confirmLeadAction, rejectLeadAction } from "../../actions";

type Props = {
  leadId: string;
  /** The hall's rate today, for the on-screen estimate only. Null when unset. */
  commissionRate: number | null;
  /** Prefill for the agreed amount — the hall's listed price, when it has one. */
  suggestedAmount: number | null;
};

function estimateCommission(amount: string, rate: number | null): string | null {
  if (rate == null) return null;
  const n = Number(String(amount).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  // Math.floor, matching commissionPaiseOn — the estimate must never read
  // higher than the charge.
  const paise = Math.floor((Math.round(n * 100) * Math.round(rate * 100)) / 10_000);
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function LeadActions({ leadId, commissionRate, suggestedAmount }: Props) {
  const [mode, setMode] = useState<"idle" | "confirm" | "reject">("idle");
  const [amount, setAmount] = useState(suggestedAmount == null ? "" : String(suggestedAmount));
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const r = await confirmLeadAction(leadId, { agreedAmount: amount, ownerNotes: notes });
      if ("error" in r) { setError(r.error); return; }
      setMode("idle");
    });
  }

  function decline() {
    setError(null);
    startTransition(async () => {
      const r = await rejectLeadAction(leadId, reason);
      if ("error" in r) { setError(r.error); return; }
      setMode("idle");
    });
  }

  if (mode === "idle") {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("confirm")}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-green-600 px-3.5 text-xs font-semibold text-white transition active:scale-[0.97] motion-reduce:active:scale-100"
        >
          <Check className="h-3.5 w-3.5" aria-hidden /> Confirm
        </button>
        <button
          type="button"
          onClick={() => setMode("reject")}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-border bg-white px-3.5 text-xs font-semibold text-charcoal-600 hover:border-red-300 hover:text-red-700"
        >
          <X className="h-3.5 w-3.5" aria-hidden /> Decline
        </button>
      </div>
    );
  }

  if (mode === "reject") {
    return (
      <div className="mt-3 rounded-xl border border-border bg-ivory-50 p-3">
        <label htmlFor={`rej-${leadId}`} className="text-[11px] font-semibold text-charcoal-700">
          Why are you declining? (optional — the customer sees this)
        </label>
        <input
          id={`rej-${leadId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          disabled={pending}
          placeholder="Date already taken"
          className="mt-1.5 w-full rounded-lg border border-border bg-white px-2.5 py-2 text-xs focus:border-maroon-500 focus:outline-none"
        />
        {error && <p role="alert" className="mt-2 text-[11px] font-semibold text-red-600">{error}</p>}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={decline}
            disabled={pending}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white disabled:opacity-60"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Decline enquiry
          </button>
          <button
            type="button"
            onClick={() => { setMode("idle"); setError(null); }}
            disabled={pending}
            className="rounded-lg border border-border bg-white px-3 text-xs font-semibold text-charcoal-600 disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const estimate = estimateCommission(amount, commissionRate);

  return (
    <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3">
      <label htmlFor={`amt-${leadId}`} className="text-[11px] font-semibold text-charcoal-800">
        What did you agree with the customer? (₹)
      </label>
      <input
        id={`amt-${leadId}`}
        type="number"
        min={0}
        step={100}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={pending}
        placeholder="e.g. 150000"
        className="mt-1.5 w-full rounded-lg border border-border bg-white px-2.5 py-2 text-sm font-semibold focus:border-maroon-500 focus:outline-none"
      />
      <p className="mt-1.5 text-[11px] leading-relaxed text-charcoal-600">
        {commissionRate == null ? (
          <>
            Hallnect&apos;s commission is charged on this amount. This venue has no rate set,
            so the platform default applies.
          </>
        ) : estimate ? (
          <>
            Hallnect&apos;s commission at <strong>{commissionRate}%</strong> would be about{" "}
            <strong>{estimate}</strong>. The exact figure is calculated when you confirm.
          </>
        ) : (
          <>Hallnect&apos;s commission is <strong>{commissionRate}%</strong> of this amount.</>
        )}
      </p>

      <label htmlFor={`note-${leadId}`} className="mt-2.5 block text-[11px] font-semibold text-charcoal-800">
        Note for your records (optional)
      </label>
      <input
        id={`note-${leadId}`}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={200}
        disabled={pending}
        className="mt-1 w-full rounded-lg border border-border bg-white px-2.5 py-2 text-xs focus:border-maroon-500 focus:outline-none"
      />

      {error && <p role="alert" className="mt-2 text-[11px] font-semibold text-red-600">{error}</p>}

      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={pending || amount.trim() === ""}
          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-green-600 px-3 text-xs font-semibold text-white disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
          Confirm enquiry
        </button>
        <button
          type="button"
          onClick={() => { setMode("idle"); setError(null); }}
          disabled={pending}
          className="rounded-lg border border-border bg-white px-3 text-xs font-semibold text-charcoal-600 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-charcoal-500">
        Confirming records what was agreed and raises Hallnect&apos;s commission. It does not
        block the date — use Availability for that.
      </p>
    </div>
  );
}
