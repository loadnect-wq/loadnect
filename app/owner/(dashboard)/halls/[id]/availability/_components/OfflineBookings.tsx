"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Loader2, Phone, Trash2, AlertTriangle, Check } from "lucide-react";
import { addOfflineBooking, releaseOfflineBooking } from "@/app/owner/(dashboard)/actions";

// ─────────────────────────────────────────────────────────────────────────────
// "We took a booking on the phone." The whole point is that the date stops
// being sellable on Hallnect the moment the owner says so.
//
// EVERY CUSTOMER FIELD IS OPTIONAL, deliberately. Requiring a name and number
// before an owner can protect their own calendar would mean an owner who took a
// booking on a bad line either invents details or leaves the date open to a
// double booking. The details improve the record; they must not gate it.
//
// The form does NOT pre-check availability and then submit. It submits, and the
// database decides under a lock — see migration 0057. A pre-check would be
// exactly the check-then-act race this feature exists to close, and it would
// look reassuring while being wrong.
// ─────────────────────────────────────────────────────────────────────────────

export type OfflineRow = {
  id: string;
  event_date: string;
  end_date: string;
  slot: string;
  customer_name: string | null;
  customer_phone: string | null;
  reference: string | null;
  notes: string | null;
};

const SLOT_LABEL: Record<string, string> = {
  full_day: "Full day",
  morning:  "Morning",
  evening:  "Evening",
};

function fmt(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export function OfflineBookings({
  hallId, rows,
}: { hallId: string; rows: OfflineRow[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const [form, setForm] = useState({
    eventDate: "", endDate: "", slot: "full_day",
    customerName: "", customerPhone: "", reference: "", notes: "",
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function submit() {
    setError(null); setOk(null);
    start(async () => {
      const r = await addOfflineBooking({
        hallId,
        eventDate: form.eventDate,
        // One-day bookings are the common case, so the end date defaults to the
        // start rather than making the owner type it twice.
        endDate:   form.endDate || form.eventDate,
        slot:      form.slot,
        customerName:  form.customerName,
        customerPhone: form.customerPhone,
        reference:     form.reference,
        notes:         form.notes,
      });
      if ("error" in r) { setError(r.error); return; }
      setOk("Blocked. Those dates are no longer bookable on Hallnect.");
      setForm({ eventDate: "", endDate: "", slot: "full_day", customerName: "", customerPhone: "", reference: "", notes: "" });
      setOpen(false);
      // The server is the truth; re-read rather than patching local state.
      router.refresh();
    });
  }

  function release(id: string) {
    if (!window.confirm("Release these dates? They become bookable on Hallnect again.")) return;
    setError(null); setOk(null);
    start(async () => {
      const r = await releaseOfflineBooking(id, hallId);
      if ("error" in r) { setError(r.error); return; }
      setOk("Released — those dates are bookable again.");
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-charcoal-900">Offline bookings</h2>
          <p className="mt-0.5 text-xs text-charcoal-500">
            Took a booking by phone or in person? Add it here and Hallnect stops
            offering those dates immediately.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => { setOpen(true); setOk(null); setError(null); }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-maroon-600 px-3 py-2 text-xs font-semibold text-white hover:bg-maroon-700"
          >
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden /> Add
          </button>
        )}
      </div>

      {ok && (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-green-50 p-2 text-xs font-medium text-green-800">
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> {ok}
        </p>
      )}
      {error && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-red-50 p-2 text-xs text-red-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-ivory-50 p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="From" required>
              <input type="date" value={form.eventDate}
                onChange={(e) => set("eventDate", e.target.value)} className={INPUT} />
            </Field>
            <Field label="To" hint="same day if blank">
              <input type="date" value={form.endDate} min={form.eventDate}
                onChange={(e) => set("endDate", e.target.value)} className={INPUT} />
            </Field>
            <Field label="Slot">
              <select value={form.slot} onChange={(e) => set("slot", e.target.value)} className={INPUT}>
                <option value="full_day">Full day</option>
                <option value="morning">Morning</option>
                <option value="evening">Evening</option>
              </select>
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Customer name" hint="optional">
              <input value={form.customerName} maxLength={120}
                onChange={(e) => set("customerName", e.target.value)} className={INPUT} />
            </Field>
            <Field label="Customer phone" hint="optional">
              <input value={form.customerPhone} maxLength={20} inputMode="tel"
                onChange={(e) => set("customerPhone", e.target.value)} className={INPUT} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Your reference" hint="optional">
              <input value={form.reference} maxLength={80}
                onChange={(e) => set("reference", e.target.value)} className={INPUT} />
            </Field>
            <Field label="Notes" hint="optional">
              <input value={form.notes} maxLength={1000}
                onChange={(e) => set("notes", e.target.value)} className={INPUT} />
            </Field>
          </div>

          <p className="text-[11px] text-charcoal-500">
            Only the dates and slot are shown publicly. The customer&apos;s name, number
            and your notes stay private to you and Hallnect support.
          </p>

          <div className="flex gap-2">
            <button
              type="button" onClick={submit} disabled={pending || !form.eventDate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-maroon-600 px-3 py-2 text-xs font-semibold text-white hover:bg-maroon-700 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {pending ? "Blocking…" : "Block these dates"}
            </button>
            <button
              type="button" onClick={() => { setOpen(false); setError(null); }} disabled={pending}
              className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-charcoal-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg bg-ivory-50 p-3 text-xs text-charcoal-500">
          No offline bookings recorded. Dates you block here appear as unavailable
          to customers straight away.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-charcoal-900">
                  {fmt(r.event_date)}
                  {r.end_date !== r.event_date && <> – {fmt(r.end_date)}</>}
                  <span className="ml-1.5 text-xs font-normal text-charcoal-500">
                    {SLOT_LABEL[r.slot] ?? r.slot}
                  </span>
                </p>
                <p className="truncate text-xs text-charcoal-500">
                  {r.customer_name || "No name recorded"}
                  {r.customer_phone && (
                    <> · <Phone className="inline h-3 w-3" aria-hidden /> {r.customer_phone}</>
                  )}
                  {r.reference && <> · ref {r.reference}</>}
                </p>
                {r.notes && <p className="truncate text-[11px] text-charcoal-400">{r.notes}</p>}
              </div>
              <button
                type="button" onClick={() => release(r.id)} disabled={pending}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-[11px] font-semibold text-charcoal-600 hover:border-red-300 hover:text-red-700 disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" aria-hidden /> Release
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const INPUT =
  "w-full rounded-lg border border-border bg-white px-2.5 py-2 text-sm outline-none focus:border-maroon-400";

function Field({
  label, hint, required, children,
}: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
        {label}
        {required && <span className="text-red-600"> *</span>}
        {hint && <span className="ml-1 font-normal normal-case text-charcoal-400">({hint})</span>}
      </span>
      {children}
    </label>
  );
}
