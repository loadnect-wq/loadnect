"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The booking receipt template on /guides/marriage-hall-booking-receipt. A hall
// owner fills in a booking they took, and gets a receipt to print or save as a
// PDF (the browser's own print screen; no PDF library).
//
// NOTHING LEAVES THE BROWSER, and the page says so. Plain component state: no
// fetch, no server action, no localStorage. A family's name and phone number
// typed here are the owner's business, not Hallnect's. A test reads this file
// and fails if any of those appear.
//
// Amounts are read with lib/budget toAmount, so "1,60,000" and "₹ 50000" both
// work — the comma is how a person writes the number, and here, unlike a
// server schema, the only thing at stake is the printout.
// ─────────────────────────────────────────────────────────────────────────────

import { useId, useState } from "react";
import { Printer } from "lucide-react";
import { SLOT_LABEL, toAmount, type HallSlot } from "@/lib/budget";
import { formatPrice } from "@/lib/mock-data";

type Fields = {
  hallName: string;
  hallAddress: string;
  hallPhone: string;
  receiptNo: string;
  receiptDate: string;
  customerName: string;
  customerPhone: string;
  occasion: string;
  eventDate: string;
  slot: HallSlot;
  guests: string;
  total: string;
  advance: string;
  paymentMode: string;
  balanceDue: string;
  terms: string;
  notes: string;
};

const EMPTY: Fields = {
  hallName: "", hallAddress: "", hallPhone: "", receiptNo: "", receiptDate: "",
  customerName: "", customerPhone: "", occasion: "", eventDate: "", slot: "full_day", guests: "",
  total: "", advance: "", paymentMode: "Cash", balanceDue: "", terms: "", notes: "",
};

export const PAYMENT_MODES = ["Cash", "UPI", "Bank transfer", "Cheque"] as const;

/** "by cash", "by bank transfer" — but "by UPI": an acronym keeps its capitals. */
export function paymentModeText(mode: string): string {
  return mode === mode.toUpperCase() ? mode : mode.toLowerCase();
}

/** "2026-10-25" → "25 October 2026". Dates only, so UTC avoids any day shift. */
export function receiptDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

/** The money lines, or what is wrong with them. Null where a figure is not entered yet. */
export function receiptAmounts(total: string, advance: string): {
  total: number | null; advance: number | null; balance: number | null; problem: string | null;
} {
  const t = toAmount(total);
  const a = toAmount(advance);
  if (total.trim() && t == null) return { total: null, advance: a, balance: null, problem: "Enter the agreed price in digits, for example 1,60,000." };
  if (advance.trim() && a == null) return { total: t, advance: null, balance: null, problem: "Enter the advance in digits, for example 50,000." };
  if (t != null && a != null && a > t) return { total: t, advance: a, balance: null, problem: "The advance is more than the agreed price." };
  return { total: t, advance: a, balance: t != null && a != null ? t - a : null, problem: null };
}

/** A blank on the printed receipt, where the owner has not filled something in. */
function Blank({ wide = false }: { wide?: boolean }) {
  return <span aria-hidden className={`inline-block border-b border-charcoal-400 align-baseline ${wide ? "w-40" : "w-20"}`}>&nbsp;</span>;
}

const or = (v: string, wide = false) => (v.trim() ? v.trim() : <Blank wide={wide} />);

export function ReceiptTemplate() {
  const [f, setF] = useState<Fields>(EMPTY);
  const id = useId();
  const set = <K extends keyof Fields>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value as Fields[K] }));
  const money = receiptAmounts(f.total, f.advance);
  const guests = toAmount(f.guests, 100_000);

  const input = "mt-1 block w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-charcoal-900 focus:border-maroon-400 focus:outline-none focus:ring-2 focus:ring-maroon-100";
  const label = "block text-xs font-semibold text-charcoal-700";
  const field = (k: keyof Fields, text: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`${id}-${k}`} className={label}>{text}</label>
      <input id={`${id}-${k}`} value={f[k]} onChange={set(k)} className={input} {...props} />
    </div>
  );

  return (
    <div className="space-y-6">
      <form className="grid gap-4 rounded-2xl bg-white p-4 shadow-card ring-1 ring-border sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
        <fieldset className="contents">
          <legend className="sr-only">Your hall</legend>
          {field("hallName", "Hall name", { autoComplete: "organization" })}
          {field("hallPhone", "Hall phone", { inputMode: "tel" })}
          <div className="sm:col-span-2">{field("hallAddress", "Hall address")}</div>
          {field("receiptNo", "Receipt number")}
          {field("receiptDate", "Receipt date", { type: "date" })}
        </fieldset>
        <fieldset className="contents">
          <legend className="sr-only">The booking</legend>
          {field("customerName", "Received from (name)")}
          {field("customerPhone", "Their phone", { inputMode: "tel" })}
          {field("occasion", "Function", { placeholder: "Wedding, reception, birthday…" })}
          {field("eventDate", "Function date", { type: "date" })}
          <div>
            <label htmlFor={`${id}-slot`} className={label}>Slot</label>
            <select id={`${id}-slot`} value={f.slot} onChange={set("slot")} className={input}>
              {(Object.keys(SLOT_LABEL) as HallSlot[]).map((s) => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}
            </select>
          </div>
          {field("guests", "Guests (about)", { inputMode: "numeric" })}
        </fieldset>
        <fieldset className="contents">
          <legend className="sr-only">Money</legend>
          {field("total", "Agreed price (₹)", { inputMode: "numeric", placeholder: "1,60,000" })}
          {field("advance", "Advance received (₹)", { inputMode: "numeric", placeholder: "50,000" })}
          <div>
            <label htmlFor={`${id}-paymentMode`} className={label}>Paid by</label>
            <select id={`${id}-paymentMode`} value={f.paymentMode} onChange={set("paymentMode")} className={input}>
              {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {field("balanceDue", "Balance due by", { type: "date" })}
          {money.problem && (
            <p role="alert" className="text-sm font-medium text-maroon-700 sm:col-span-2">{money.problem}</p>
          )}
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-terms`} className={label}>Cancellation terms</label>
            <textarea
              id={`${id}-terms`}
              value={f.terms}
              onChange={set("terms")}
              rows={3}
              className={input}
              placeholder="How much of the advance comes back if the family cancels, and until when."
            />
          </div>
          <div className="sm:col-span-2">{field("notes", "Notes (optional)")}</div>
        </fieldset>
      </form>

      {/* ── The receipt ─────────────────────────────────────────────────────
          .receipt-print is what app/globals.css keeps visible when printing. */}
      <div className="receipt-print rounded-2xl bg-white p-6 text-sm leading-relaxed text-charcoal-900 shadow-card ring-1 ring-border">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-charcoal-200 pb-4">
          <div className="min-w-0">
            <p className="text-lg font-bold">{or(f.hallName, true)}</p>
            {f.hallAddress.trim() && <p className="text-charcoal-700">{f.hallAddress.trim()}</p>}
            {f.hallPhone.trim() && <p className="text-charcoal-700">Phone: {f.hallPhone.trim()}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-widest text-charcoal-700">Booking receipt</p>
            <p>No. {or(f.receiptNo)}</p>
            <p>Date: {f.receiptDate ? receiptDate(f.receiptDate) : <Blank />}</p>
          </div>
        </div>

        <p className="mt-4">
          Received with thanks from {or(f.customerName, true)}
          {f.customerPhone.trim() && <> (phone {f.customerPhone.trim()})</>} the sum of{" "}
          <strong>{money.advance != null ? formatPrice(money.advance) : <Blank />}</strong> by {paymentModeText(f.paymentMode)} as an
          advance for booking {f.hallName.trim() || "the hall"} for {or(f.occasion)} on{" "}
          {f.eventDate ? receiptDate(f.eventDate) : <Blank wide />}, {SLOT_LABEL[f.slot].toLowerCase()}
          {guests != null && <>, for about {guests.toLocaleString("en-IN")} guests</>}.
        </p>

        <table className="mt-4 w-full text-left">
          <tbody className="divide-y divide-charcoal-100">
            <tr><th scope="row" className="py-1.5 pr-4 font-normal text-charcoal-700">Agreed price for the booking</th><td className="py-1.5 text-right font-semibold tabular-nums">{money.total != null ? formatPrice(money.total) : <Blank />}</td></tr>
            <tr><th scope="row" className="py-1.5 pr-4 font-normal text-charcoal-700">Advance received</th><td className="py-1.5 text-right font-semibold tabular-nums">{money.advance != null ? formatPrice(money.advance) : <Blank />}</td></tr>
            <tr><th scope="row" className="py-1.5 pr-4 font-normal text-charcoal-700">Balance</th><td className="py-1.5 text-right font-semibold tabular-nums">{money.balance != null ? formatPrice(money.balance) : <Blank />}</td></tr>
            <tr><th scope="row" className="py-1.5 pr-4 font-normal text-charcoal-700">Balance due by</th><td className="py-1.5 text-right font-semibold">{f.balanceDue ? receiptDate(f.balanceDue) : <Blank />}</td></tr>
          </tbody>
        </table>

        <p className="mt-4"><span className="font-semibold">Cancellation terms: </span>{f.terms.trim() || <Blank wide />}</p>
        {f.notes.trim() && <p className="mt-2"><span className="font-semibold">Notes: </span>{f.notes.trim()}</p>}

        <div className="mt-10 grid grid-cols-2 gap-8 text-center text-xs text-charcoal-700">
          <div className="border-t border-charcoal-400 pt-1.5">For {f.hallName.trim() || "the hall"}</div>
          <div className="border-t border-charcoal-400 pt-1.5">Customer</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800"
        >
          <Printer className="h-4 w-4" aria-hidden /> Print or save as PDF
        </button>
        <p className="text-xs text-charcoal-600">To keep a PDF, choose “Save as PDF” in the print screen.</p>
      </div>
    </div>
  );
}
