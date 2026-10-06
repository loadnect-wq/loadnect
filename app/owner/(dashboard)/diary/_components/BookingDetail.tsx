"use client";

// ─────────────────────────────────────────────────────────────────────────────
// One booking: who, when, the money, and the four things a manager does next —
// send a receipt, chase a balance, record a payment, or cancel.
//
// WHATSAPP IS A LINK. The receipt and reminder open the owner's own WhatsApp
// with the message typed out; the owner reads it and presses send. Nothing is
// sent on their behalf, there is no API cost, and the customer gets it from a
// number they already know. With no usable phone recorded, WhatsApp asks whom
// to send it to.
//
// RECORDING A PAYMENT adds to "received" and saves through the same update as
// Edit — a full replacement of the private detail, so it cannot clear a field
// by omission. It refuses to take received past the total; the owner raises the
// total when a customer pays for extras.
//
// CANCEL takes two taps, the second within a few seconds, because it frees the
// date for anyone to book online the moment it lands.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, Loader2, MessageCircle, Pencil, Phone, Trash2, Wallet } from "lucide-react";
import { releaseOfflineBooking, updateDiaryBooking } from "@/app/owner/(dashboard)/actions";
import { isMuhurtham } from "@/lib/muhurtham";
import {
  balanceDue,
  dt,
  formatAmount,
  formatDiaryDates,
  parseAmountInput,
  paymentState,
  receiptMessage,
  reminderMessage,
  slotLabel,
  whatsappUrl,
  type DiaryBooking,
  type DiaryLang,
} from "@/lib/diary";

type Props = {
  lang: DiaryLang;
  hall: { id: string; name: string };
  booking: DiaryBooking;
  onEdit: () => void;
  onDone: (message: string) => void;
};

export function BookingDetail({ lang, hall, booking, onEdit, onDone }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState("");
  const [armed, setArmed] = useState(false);

  // Disarm the cancel button if the second tap does not come.
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const state = paymentState(booking.totalAmount, booking.amountReceived);
  const due = balanceDue(booking.totalAmount, booking.amountReceived);
  const message = {
    hallName: hall.name,
    customerName: booking.customerName,
    eventDate: booking.eventDate,
    endDate: booking.endDate,
    slot: booking.slot,
    totalAmount: booking.totalAmount,
    amountReceived: booking.amountReceived,
  };

  function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const add = parseAmountInput(payment);
    if (add == null || Number.isNaN(add) || add <= 0) { setError(dt(lang, "invalidAmount")); return; }
    const nextReceived = (booking.amountReceived ?? 0) + add;
    if (booking.totalAmount != null && nextReceived > booking.totalAmount) {
      setError(dt(lang, "amountTooLarge"));
      return;
    }
    start(async () => {
      const r = await updateDiaryBooking({
        id: booking.id,
        hallId: hall.id,
        customerName: booking.customerName ?? "",
        customerPhone: booking.customerPhone ?? "",
        notes: booking.notes ?? "",
        totalAmount: booking.totalAmount,
        amountReceived: nextReceived,
      });
      if ("error" in r) { setError(r.error || dt(lang, "errorGeneric")); return; }
      onDone(dt(lang, "paymentRecorded"));
    });
  }

  function cancel() {
    if (!armed) { setArmed(true); return; }
    setError(null);
    start(async () => {
      const r = await releaseOfflineBooking(booking.id, hall.id);
      if ("error" in r) { setError(r.error || dt(lang, "errorGeneric")); setArmed(false); return; }
      onDone(dt(lang, "cancelled"));
    });
  }

  return (
    <div className="space-y-4 pb-2">
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
        </p>
      )}

      <div>
        <p className="text-base font-semibold text-charcoal-900">
          {formatDiaryDates(lang, booking.eventDate, booking.endDate, { year: true })}
        </p>
        <p className="text-sm text-charcoal-600">
          {slotLabel(lang, booking.slot)}
          {isMuhurtham(booking.eventDate) && ` · ${dt(lang, "legendMuhurtham")}`}
        </p>
        {booking.customerPhone && (
          <p className="mt-2 flex items-center gap-3">
            <span className="text-sm tabular-nums text-charcoal-800">{booking.customerPhone}</span>
            {/* tel: is a convenience on a phone; the number is also shown as text. */}
            <a
              href={`tel:${booking.customerPhone.replace(/[^\d+]/g, "")}`}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-ivory-100 px-3 text-sm font-semibold text-charcoal-800"
            >
              <Phone className="h-4 w-4" aria-hidden /> {dt(lang, "call")}
            </a>
          </p>
        )}
      </div>

      {/* ── Money ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-ivory-100 p-4">
        {state === "unrecorded" ? (
          <p className="text-sm text-charcoal-600">
            {dt(lang, "noAmount")}
            {booking.amountReceived != null && ` · ${dt(lang, "received")}: ₹${formatAmount(booking.amountReceived)}`}
          </p>
        ) : (
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div>
              <dt className="text-xs text-charcoal-600">{dt(lang, "total")}</dt>
              <dd className="mt-0.5 text-sm font-bold tabular-nums text-charcoal-900">₹{formatAmount(booking.totalAmount ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-charcoal-600">{dt(lang, "received")}</dt>
              <dd className="mt-0.5 text-sm font-bold tabular-nums text-green-800">₹{formatAmount(booking.amountReceived ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-charcoal-600">{dt(lang, "balance")}</dt>
              <dd className={`mt-0.5 text-sm font-bold tabular-nums ${state === "due" ? "text-amber-800" : "text-charcoal-900"}`}>
                ₹{formatAmount(due ?? 0)}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {booking.notes && <p className="whitespace-pre-line text-sm text-charcoal-700">{booking.notes}</p>}

      {/* ── WhatsApp ───────────────────────────────────────────────────── */}
      <div className="grid gap-2">
        <a
          href={whatsappUrl(booking.customerPhone, receiptMessage(lang, message))}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#1a7f45] text-sm font-semibold text-white hover:bg-[#166b3a]"
        >
          <MessageCircle className="h-4 w-4" aria-hidden /> {dt(lang, "sendReceipt")}
        </a>
        {state === "due" && (
          <a
            href={whatsappUrl(booking.customerPhone, reminderMessage(lang, message))}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#1a7f45] text-sm font-semibold text-[#17703c] hover:bg-green-50"
          >
            <MessageCircle className="h-4 w-4" aria-hidden /> {dt(lang, "sendReminder")}
          </a>
        )}
      </div>

      {/* ── Record a payment ───────────────────────────────────────────── */}
      {state !== "paid" && (
        <form onSubmit={recordPayment} className="rounded-2xl border border-border p-3">
          <label htmlFor="diary-payment" className="flex items-center gap-1.5 text-sm font-semibold text-charcoal-900">
            <Wallet className="h-4 w-4 text-charcoal-500" aria-hidden /> {dt(lang, "recordPayment")}
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="diary-payment"
              inputMode="decimal"
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
              placeholder={due ? formatAmount(due) : ""}
              aria-label={dt(lang, "paymentAmount")}
              className="h-12 min-w-0 flex-1 rounded-xl border border-charcoal-200 bg-white px-3 text-base tabular-nums outline-none focus-visible:border-maroon-500 focus-visible:ring-2 focus-visible:ring-maroon-200"
            />
            <button
              type="submit"
              disabled={pending || !payment}
              className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-xl bg-charcoal-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {dt(lang, "addPayment")}
            </button>
          </div>
        </form>
      )}

      {/* ── Edit / cancel ──────────────────────────────────────────────── */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onEdit}
          disabled={pending}
          className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold text-charcoal-800 hover:bg-ivory-100"
        >
          <Pencil className="h-4 w-4" aria-hidden /> {dt(lang, "edit")}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          aria-live="polite"
          className={`flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border text-sm font-semibold ${
            armed ? "border-red-600 bg-red-600 text-white" : "border-red-200 text-red-700 hover:bg-red-50"
          }`}
        >
          <Trash2 className="h-4 w-4" aria-hidden /> {armed ? dt(lang, "confirmCancel") : dt(lang, "cancelBooking")}
        </button>
      </div>
    </div>
  );
}
