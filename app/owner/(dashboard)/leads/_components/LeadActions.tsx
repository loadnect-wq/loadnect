"use client";

// ─────────────────────────────────────────────────────────────────────────────
// What a venue can do with an enquiry (0112: quotes before the number).
//
//   pending   → Send a quote, or say the date is not available
//   quoted    → Change the quote, or withdraw it (date not available)
//   accepted  → Mark it booked at the agreed amount, which raises Hallnect's
//               commission — or say it cannot be done after all
//
// Marking booked is still the most consequential button in the dashboard: it
// creates a debt. So it stays a TWO-STEP control that asks what was agreed,
// prefilled with the quote. The commission rate is never sent from here; the
// server applies the standard one.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useTransition } from "react";
import { Check, Loader2, Send, X } from "lucide-react";
import { confirmLeadAction, rejectLeadAction, sendLeadQuoteAction } from "../../actions";
import { COMMISSION_PERCENT_LABEL, calculateBookingCommission } from "@/lib/commission";

export type QuoteView = {
  amount: number;
  advance: number | null;
  includes: string | null;
  note: string | null;
  validUntil: string;
};

type Props = {
  leadId: string;
  status: "pending" | "quoted" | "accepted";
  quote: QuoteView | null;
  /** YYYY-MM-DD: a quote cannot stay open past the function. */
  eventDate: string;
  today: string;
  /** Prefill for a first quote — the hall's listed price, when it has one. */
  suggestedAmount: number | null;
};

function estimateCommission(amount: string): string | null {
  const n = Number(String(amount).replace(/[,\s₹]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const rupees = calculateBookingCommission(n);
  return `₹${rupees.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function plusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const input = "mt-1 w-full rounded-lg border border-border bg-white px-2.5 py-2 text-sm focus:border-maroon-500 focus:outline-none";
const label = "block text-[11px] font-semibold text-charcoal-800";

export function LeadActions({ leadId, status, quote, eventDate, today, suggestedAmount }: Props) {
  const [mode, setMode] = useState<"idle" | "quote" | "confirm" | "reject">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Quote form.
  const defaultValid = (() => {
    const week = plusDays(today, 7);
    return week > eventDate ? eventDate : week;
  })();
  const [amount, setAmount] = useState(String(quote?.amount ?? suggestedAmount ?? ""));
  const [advance, setAdvance] = useState(quote?.advance == null ? "" : String(quote.advance));
  const [includes, setIncludes] = useState(quote?.includes ?? "");
  const [note, setNote] = useState(quote?.note ?? "");
  const [validUntil, setValidUntil] = useState(quote && quote.validUntil >= today ? quote.validUntil : defaultValid);

  // Booking and declining.
  const [agreed, setAgreed] = useState(String(quote?.amount ?? suggestedAmount ?? ""));
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<{ success: true } | { error: string }>) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if ("error" in r) { setError(r.error); return; }
      setMode("idle");
    });
  };

  const cancelButton = (
    <button
      type="button"
      onClick={() => { setMode("idle"); setError(null); }}
      disabled={pending}
      className="rounded-lg border border-border bg-white px-3 text-xs font-semibold text-charcoal-600 disabled:opacity-60"
    >
      Cancel
    </button>
  );
  const errorLine = error && <p role="alert" className="mt-2 text-[11px] font-semibold text-red-600">{error}</p>;

  if (mode === "idle") {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {status === "accepted" ? (
          <button
            type="button"
            onClick={() => setMode("confirm")}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-green-600 px-3.5 text-xs font-semibold text-white transition active:scale-[0.97] motion-reduce:active:scale-100"
          >
            <Check className="h-3.5 w-3.5" aria-hidden /> Mark as booked
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setMode("quote")}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-maroon-700 px-3.5 text-xs font-semibold text-white transition active:scale-[0.97] motion-reduce:active:scale-100"
          >
            <Send className="h-3.5 w-3.5" aria-hidden /> {status === "quoted" ? "Change quote" : "Send a quote"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setMode("reject")}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-border bg-white px-3.5 text-xs font-semibold text-charcoal-600 hover:border-red-300 hover:text-red-700"
        >
          <X className="h-3.5 w-3.5" aria-hidden /> Can&apos;t take this date
        </button>
      </div>
    );
  }

  if (mode === "reject") {
    return (
      <div className="mt-3 rounded-xl border border-border bg-ivory-50 p-3">
        <label htmlFor={`rej-${leadId}`} className={label}>
          Why? (optional — the family sees this)
        </label>
        <input
          id={`rej-${leadId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          disabled={pending}
          placeholder="Date already taken"
          className={input}
        />
        {errorLine}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => run(() => rejectLeadAction(leadId, reason))}
            disabled={pending}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white disabled:opacity-60"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Decline enquiry
          </button>
          {cancelButton}
        </div>
      </div>
    );
  }

  if (mode === "quote") {
    return (
      <div className="mt-3 space-y-2.5 rounded-xl border border-maroon-100 bg-maroon-50/40 p-3">
        <div className="grid grid-cols-2 gap-2.5">
          <label className={label}>
            Price for this date (₹)
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={pending} placeholder="e.g. 150000" className={`${input} font-semibold`} />
          </label>
          <label className={label}>
            Advance to book (₹, optional)
            <input inputMode="numeric" value={advance} onChange={(e) => setAdvance(e.target.value)} disabled={pending} placeholder="e.g. 25000" className={input} />
          </label>
        </div>
        <label className={label}>
          What is included (optional)
          <textarea
            rows={3}
            maxLength={600}
            value={includes}
            onChange={(e) => setIncludes(e.target.value)}
            disabled={pending}
            placeholder="Hall for the full day, dining hall, 10 rooms, generator, parking…"
            className={input}
          />
        </label>
        <div className="grid grid-cols-2 gap-2.5">
          <label className={label}>
            Quote open until
            <input type="date" min={today} max={eventDate} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={pending} className={input} />
          </label>
          <label className={label}>
            Note (optional)
            <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} disabled={pending} placeholder="Electricity extra" className={input} />
          </label>
        </div>
        <p className="text-[10px] leading-relaxed text-charcoal-500">
          The family sees this on Hallnect. If they accept, you get their phone number and can call them to book.
        </p>
        {errorLine}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => run(() => sendLeadQuoteAction(leadId, { amount, advance, includes, note, validUntil }))}
            disabled={pending || amount.trim() === ""}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-maroon-700 px-3 text-xs font-semibold text-white disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
            {status === "quoted" ? "Update quote" : "Send quote"}
          </button>
          {cancelButton}
        </div>
      </div>
    );
  }

  const estimate = estimateCommission(agreed);
  return (
    <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3">
      <label htmlFor={`amt-${leadId}`} className={label}>
        What did you agree with the family? (₹)
      </label>
      <input
        id={`amt-${leadId}`}
        inputMode="numeric"
        value={agreed}
        onChange={(e) => setAgreed(e.target.value)}
        disabled={pending}
        placeholder="e.g. 150000"
        className={`${input} font-semibold`}
      />
      <p className="mt-1.5 text-[11px] leading-relaxed text-charcoal-600">
        {estimate ? (
          <>
            Hallnect commission at <strong>{COMMISSION_PERCENT_LABEL}</strong> would be about{" "}
            <strong>{estimate}</strong>. The exact figure is calculated when you confirm.
          </>
        ) : (
          <>Hallnect commission is <strong>{COMMISSION_PERCENT_LABEL}</strong> of this amount.</>
        )}
      </p>
      <label htmlFor={`note-${leadId}`} className={`${label} mt-2.5`}>
        Note for your records (optional)
      </label>
      <input
        id={`note-${leadId}`}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={200}
        disabled={pending}
        className={input}
      />
      {errorLine}
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={() => run(() => confirmLeadAction(leadId, { agreedAmount: agreed.replace(/[,\s₹]/g, ""), ownerNotes: notes }))}
          disabled={pending || agreed.trim() === ""}
          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-green-600 px-3 text-xs font-semibold text-white disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
          Confirm booking
        </button>
        {cancelButton}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-charcoal-500">
        This records the booking and raises Hallnect&apos;s commission. It does not block the date — use
        Availability or your diary for that.
      </p>
    </div>
  );
}
