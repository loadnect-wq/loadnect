"use client";

// The site visit request: a day, a time of day, how many are coming, and the
// name to ask for at the gate. The phone is shown, not asked for — it is the
// account's verified number, and the server reads it from the profile.

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarCheck, Loader2 } from "lucide-react";
import { NumberPromise } from "@/components/trust/NumberPromise";
import { MAX_PARTY, VISIT_WINDOWS, VISIT_WINDOW_KEYS, type VisitWindow, visitWhen } from "@/lib/site-visits";
import { requestVisit } from "../actions";

export function VisitForm({
  hall,
  minDate,
  maxDate,
  initialName,
  phoneDisplay,
}: {
  hall: { id: string; name: string; slug: string };
  minDate: string;
  maxDate: string;
  initialName: string;
  /** The verified number, masked: "+91••••••3210". */
  phoneDisplay: string;
}) {
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState<VisitWindow>("morning");
  const [partySize, setPartySize] = useState("2");
  const [name, setName] = useState(initialName);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ already: boolean } | null>(null);
  const [pending, start] = useTransition();

  if (sent) {
    return (
      <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-border">
        <CalendarCheck className="h-8 w-8 text-green-700" aria-hidden />
        <h2 className="mt-2 text-lg font-bold text-charcoal-900">
          {sent.already ? "You've already asked for this visit" : "Visit requested"}
        </h2>
        <p className="mt-1 text-sm text-charcoal-700">{visitWhen(date, slot)}</p>
        <p className="mt-2 text-sm text-charcoal-700">
          {hall.name} will confirm, usually by calling you on {phoneDisplay}. You can see the answer in My visits.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/customer/visits" className="inline-flex min-h-[44px] items-center rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800">
            My visits
          </Link>
          <Link href={`/halls/${hall.slug}`} className="inline-flex min-h-[44px] items-center rounded-xl border border-border px-4 text-sm font-semibold text-charcoal-800 hover:bg-ivory-100">
            Back to the hall
          </Link>
        </div>
      </div>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!date) {
      setError("Choose the day you'd like to visit.");
      return;
    }
    start(async () => {
      const res = await requestVisit({ hallId: hall.id, date, window: slot, partySize, contactName: name, note });
      if (res.ok) setSent({ already: res.already });
      else setError(res.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-2xl bg-white p-5 shadow-card ring-1 ring-border">
      <div>
        <label htmlFor="visit-date" className="text-sm font-semibold text-charcoal-900">Which day?</label>
        <input
          id="visit-date"
          type="date"
          required
          min={minDate}
          max={maxDate}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1.5 block min-h-[44px] w-full rounded-xl border border-border bg-white px-3 text-sm"
        />
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-charcoal-900">What time of day?</legend>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {VISIT_WINDOW_KEYS.map((k) => (
            <label
              key={k}
              className={`flex min-h-[56px] cursor-pointer flex-col items-center justify-center rounded-xl border px-1 text-center text-xs ${
                slot === k ? "border-maroon-700 bg-maroon-50 text-maroon-800" : "border-border text-charcoal-700"
              }`}
            >
              <input type="radio" name="window" value={k} checked={slot === k} onChange={() => setSlot(k)} className="sr-only" />
              <span className="text-sm font-semibold">{VISIT_WINDOWS[k].label}</span>
              <span className="text-[11px]">{VISIT_WINDOWS[k].hours}</span>
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-charcoal-600">The hall will tell you the exact time when it confirms.</p>
      </fieldset>

      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <div>
          <label htmlFor="visit-name" className="text-sm font-semibold text-charcoal-900">Your name</label>
          <input
            id="visit-name"
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            className="mt-1.5 block min-h-[44px] w-full rounded-xl border border-border px-3 text-sm"
          />
        </div>
        <div>
          <label htmlFor="visit-party" className="text-sm font-semibold text-charcoal-900">People</label>
          <select
            id="visit-party"
            value={partySize}
            onChange={(e) => setPartySize(e.target.value)}
            className="mt-1.5 block min-h-[44px] w-full rounded-xl border border-border bg-white px-2 text-sm"
          >
            {Array.from({ length: MAX_PARTY }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="visit-note" className="text-sm font-semibold text-charcoal-900">
          Anything the hall should know? <span className="font-normal text-charcoal-600">(optional)</span>
        </label>
        <textarea
          id="visit-note"
          rows={2}
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. We'd like to see the dining hall and the bridal room"
          className="mt-1.5 block w-full rounded-xl border border-border px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm text-charcoal-700">
          The hall will call you on <strong className="font-semibold">{phoneDisplay}</strong>, your verified number.
        </p>
        <NumberPromise hallName={hall.name} flow="booking" />
      </div>

      {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-maroon-700 text-sm font-semibold text-white hover:bg-maroon-800 disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Ask to visit
      </button>
      <p className="text-center text-xs text-charcoal-600">Free. A visit holds no date and asks for no payment.</p>
    </form>
  );
}
