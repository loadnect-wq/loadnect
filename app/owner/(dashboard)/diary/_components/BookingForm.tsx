"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Add or edit a diary booking.
//
// ADD: date, optional last day, part of the day, then the private detail —
// customer, phone, total, advance, notes. Only the date is required: a manager
// taking a call must be able to hold the date first and fill the rest later.
//
// EDIT: the private detail only. Dates and slot are shown, not editable — a
// move is a cancel plus a new booking, because only the create path holds the
// inventory lock (migration 0106 explains).
//
// Amounts: blank means "not recorded", and the balance line appears only once
// a total exists. Received above total is stopped here with a sentence, and
// again by the database.
// ─────────────────────────────────────────────────────────────────────────────

import { useRef, useState, useTransition } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { addOfflineBooking, updateDiaryBooking } from "@/app/owner/(dashboard)/actions";
import { addDaysToIsoDate } from "@/lib/dates";
import {
  balanceDue,
  dt,
  formatAmount,
  formatDiaryDates,
  parseAmountInput,
  slotLabel,
  type DiaryBooking,
  type DiaryLang,
  type DiarySlot,
} from "@/lib/diary";
import { cn } from "@/lib/utils";

type Props = {
  lang: DiaryLang;
  hallId: string;
  onDone: () => void;
} & ({ booking: DiaryBooking; initialDate?: never } | { booking?: never; initialDate: string });

const SLOTS: DiarySlot[] = ["full_day", "morning", "evening"];

const amountText = (n: number | null) => (n == null ? "" : String(n));

export function BookingForm(props: Props) {
  const { lang, hallId, onDone } = props;
  const editing = props.booking ?? null;

  const [date, setDate] = useState(editing?.eventDate ?? props.initialDate ?? "");
  const [until, setUntil] = useState(editing && editing.endDate !== editing.eventDate ? editing.endDate : "");
  const [slot, setSlot] = useState<DiarySlot>(editing?.slot ?? "full_day");
  const [name, setName] = useState(editing?.customerName ?? "");
  const [phone, setPhone] = useState(editing?.customerPhone ?? "");
  const [total, setTotal] = useState(amountText(editing?.totalAmount ?? null));
  const [received, setReceived] = useState(amountText(editing?.amountReceived ?? null));
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // One idempotency key per attempt series, as on the availability screen: a
  // retry after a dropped connection returns the ORIGINAL booking instead of
  // "those dates are not free", raised by its own first attempt.
  const token = useRef<string | null>(null);
  if (token.current === null) token.current = crypto.randomUUID();

  const totalN = parseAmountInput(total);
  const receivedN = parseAmountInput(received);
  const amountsValid = !Number.isNaN(totalN) && !Number.isNaN(receivedN);
  const overpaid = amountsValid && totalN != null && receivedN != null && receivedN > totalN;
  const due = amountsValid ? balanceDue(totalN, receivedN) : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!amountsValid) { setError(dt(lang, "invalidAmount")); return; }
    if (overpaid) { setError(dt(lang, "amountTooLarge")); return; }

    start(async () => {
      const r = editing
        ? await updateDiaryBooking({
            id: editing.id,
            hallId,
            customerName: name,
            customerPhone: phone,
            notes,
            totalAmount: totalN,
            amountReceived: receivedN,
          })
        : await addOfflineBooking({
            hallId,
            eventDate: date,
            endDate: until && until > date ? until : date,
            slot,
            customerName: name,
            customerPhone: phone,
            notes,
            reference: "",
            clientToken: token.current ?? undefined,
            totalAmount: totalN,
            amountReceived: receivedN,
          });
      if ("error" in r) {
        setError(r.error || dt(lang, "errorGeneric"));
        // A new attempt after a real refusal must not reuse the key.
        token.current = crypto.randomUUID();
        return;
      }
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
        </p>
      )}

      {editing ? (
        <div className="rounded-xl bg-ivory-100 p-3">
          <p className="text-sm font-semibold text-charcoal-900">
            {formatDiaryDates(lang, editing.eventDate, editing.endDate, { year: true })} · {slotLabel(lang, editing.slot)}
          </p>
          <p className="mt-0.5 text-xs text-charcoal-600">{dt(lang, "datesLocked")}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={dt(lang, "fieldDate")} htmlFor="diary-date">
              <input
                id="diary-date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label={dt(lang, "fieldUntil")} htmlFor="diary-until" hint={dt(lang, "fieldUntilHint")}>
              <input
                id="diary-until"
                type="date"
                value={until}
                min={date ? addDaysToIsoDate(date, 1) : undefined}
                onChange={(e) => setUntil(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold text-charcoal-900">{dt(lang, "fieldSlot")}</legend>
            <div className="grid grid-cols-3 gap-2">
              {SLOTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={slot === s}
                  onClick={() => setSlot(s)}
                  className={cn(
                    "min-h-[44px] rounded-xl px-2 text-sm font-semibold ring-1 transition-colors",
                    slot === s ? "bg-maroon-600 text-white ring-maroon-600" : "bg-white text-charcoal-800 ring-charcoal-200",
                  )}
                >
                  {slotLabel(lang, s)}
                </button>
              ))}
            </div>
          </fieldset>
        </>
      )}

      <Field label={dt(lang, "fieldName")} htmlFor="diary-name">
        <input id="diary-name" value={name} maxLength={120} autoComplete="off" onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>
      <Field label={dt(lang, "fieldPhone")} htmlFor="diary-phone">
        <input id="diary-phone" type="tel" inputMode="tel" value={phone} maxLength={20} autoComplete="off" onChange={(e) => setPhone(e.target.value)} className={inputCls} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={dt(lang, "fieldTotal")} htmlFor="diary-total">
          <input id="diary-total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} className={cn(inputCls, "tabular-nums")} />
        </Field>
        <Field label={dt(lang, "fieldReceived")} htmlFor="diary-received">
          <input id="diary-received" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} className={cn(inputCls, "tabular-nums")} />
        </Field>
      </div>
      {due != null && !overpaid && (
        <p className="-mt-1 text-sm font-semibold tabular-nums text-charcoal-800" aria-live="polite">
          {dt(lang, "balance")}: ₹{formatAmount(due)}
        </p>
      )}
      {overpaid && <p className="-mt-1 text-sm text-red-700">{dt(lang, "amountTooLarge")}</p>}

      <Field label={dt(lang, "fieldNotes")} htmlFor="diary-notes" hint={dt(lang, "fieldNotesHint")}>
        <textarea id="diary-notes" rows={3} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} className={cn(inputCls, "h-auto py-2.5")} />
      </Field>

      <button
        type="submit"
        disabled={pending || !date}
        className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-maroon-600 text-base font-semibold text-white hover:bg-maroon-700 disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {pending ? dt(lang, "saving") : editing ? dt(lang, "saveChanges") : dt(lang, "save")}
      </button>
    </form>
  );
}

const inputCls =
  "h-12 w-full rounded-xl border border-charcoal-200 bg-white px-3 text-base text-charcoal-900 outline-none focus-visible:border-maroon-500 focus-visible:ring-2 focus-visible:ring-maroon-200";

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold text-charcoal-900">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-charcoal-500">{hint}</p>}
    </div>
  );
}
