"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The owner's month calendar.
//
// WHAT IT REPLACED, and why. The old screen was a 45-row × 3-column table where
// every cell cycled through eight statuses on click, and nothing persisted until
// a global "Save Availability" button was pressed. That asked an owner to
// maintain, by hand, an answer the database already knew — and it made every
// unsaved screen a lie. It is gone.
//
// THERE IS NO SAVE BUTTON HERE. Blocking a date writes it immediately; releasing
// one deletes it immediately. Nothing is staged, so nothing can be lost by
// navigating away, and two devices can never disagree about what was "pending".
//
// GREEN IS NOT A PROMISE. It means "no claim exists as of this render". The
// booking that takes it may already be in flight — checkout re-checks under an
// advisory lock (assert_inventory_free), and that refusal, not this grid, is
// what prevents a double booking. Realtime keeps the gap small; it does not
// close it, and the copy at the foot of the screen says so.
//
// COLOUR IS NEVER THE ONLY SIGNAL. Every state carries a text label in the day
// cell's accessible name and again in the detail sheet, because roughly one man
// in twelve cannot separate the red from the green.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, Lock, Radio, X,
} from "lucide-react";
import { addOfflineBooking, releaseOfflineBooking } from "@/app/owner/(dashboard)/actions";
import { useLiveAvailability } from "@/lib/useLiveAvailability";
import { formatIsoDateLabel, isoDateToLabelDate, addDaysToIsoDate } from "@/lib/dates";
import type { CalendarDay, CalendarSlot, DayClaim } from "@/lib/owner-calendar";

type Props = {
  hallId: string;
  /** First day of the rendered month, YYYY-MM-01. */
  monthStart: string;
  days: CalendarDay[];
  today: string;
  prevMonth: string | null;
  nextMonth: string | null;
};

const SLOT_LABEL: Record<CalendarSlot, string> = {
  full_day: "Full day",
  morning: "Morning",
  evening: "Evening",
};

const KIND_LABEL: Record<DayClaim["kind"], string> = {
  online: "Online booking",
  offline: "Offline booking",
  platform: "Blocked by Hallnect",
};

// Tone is decoration; the label above is the actual signal.
const KIND_DOT: Record<DayClaim["kind"], string> = {
  online: "bg-red-500",
  offline: "bg-amber-500",
  platform: "bg-charcoal-500",
};

const KIND_CHIP: Record<DayClaim["kind"], string> = {
  online: "bg-red-50 text-red-800 border-red-200",
  offline: "bg-amber-50 text-amber-900 border-amber-200",
  platform: "bg-charcoal-50 text-charcoal-700 border-border",
};

/** The single state a day cell shows. Online outranks offline outranks blocked. */
function summarise(day: CalendarDay) {
  if (day.claims.length === 0) return { kind: null as DayClaim["kind"] | null, text: "Free" };
  const kind: DayClaim["kind"] =
    day.claims.some((c) => c.kind === "online") ? "online"
    : day.claims.some((c) => c.kind === "offline") ? "offline"
    : "platform";
  const partial = day.free.morning || day.free.evening;
  return { kind, text: partial ? `${KIND_LABEL[kind]} · part of the day free` : KIND_LABEL[kind] };
}

export function InventoryCalendar({
  hallId, monthStart, days, today, prevMonth, nextMonth,
}: Props) {
  const router = useRouter();
  const { live } = useLiveAvailability(hallId);
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  // Leading blanks so the 1st lands under its real weekday. getUTCDay is correct
  // here and only here: isoDateToLabelDate builds a Date whose UTC parts ARE the
  // ISO date, precisely so this never shifts by a timezone.
  const leading = isoDateToLabelDate(monthStart).getUTCDay();

  const monthLabel = formatIsoDateLabel(monthStart, { month: "long", year: "numeric" });
  const selectedDay = selected ? byDate.get(selected) ?? null : null;

  function go(month: string | null) {
    if (!month) return;
    setSelected(null);
    router.push(`/owner/halls/${hallId}/availability?m=${month}`, { scroll: false });
  }

  return (
    <div className="rounded-2xl bg-white p-3 shadow-card sm:p-4">
      {/* ── Month navigation ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button" onClick={() => go(prevMonth)} disabled={!prevMonth}
          aria-label="Previous month"
          className="grid h-10 w-10 place-items-center rounded-full text-charcoal-600 hover:bg-ivory-100 disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <h2 className="font-serif text-base font-bold text-charcoal-900" aria-live="polite">
          {monthLabel}
        </h2>
        <button
          type="button" onClick={() => go(nextMonth)} disabled={!nextMonth}
          aria-label="Next month"
          className="grid h-10 w-10 place-items-center rounded-full text-charcoal-600 hover:bg-ivory-100 disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </div>

      {flash && (
        <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-green-50 p-2 text-xs font-medium text-green-800">
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> {flash}
        </p>
      )}

      {/* ── Grid ─────────────────────────────────────────────────────────── */}
      {/* role="group", not role="grid". The children here are weekday captions,
          empty padding cells and buttons — not rows and gridcells — and a grid
          missing that structure announces as a broken one ("row 0 of 0"), which
          is worse than no grid at all. The name still needs a role that can
          carry one, so "group" keeps the aria-label spoken while claiming only
          what is true. Each day button already carries its own date and status
          in its accessible name, which is what a screen-reader user needs. */}
      <div className="mt-3 grid grid-cols-7 gap-1" role="group" aria-label={`Availability for ${monthLabel}`}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="pb-1 text-center text-[10px] font-bold uppercase tracking-wide text-charcoal-400">
            {d}
          </div>
        ))}
        {Array.from({ length: leading }, (_, i) => <div key={`pad-${i}`} aria-hidden />)}

        {days.map((day) => {
          const s = summarise(day);
          const isToday = day.date === today;
          const isPast = day.date < today;
          const num = Number(day.date.slice(8, 10));
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => { setFlash(null); setSelected(day.date); }}
              aria-label={`${formatIsoDateLabel(day.date, { weekday: "long", day: "numeric", month: "long" })} — ${s.text}`}
              aria-pressed={selected === day.date}
              className={[
                "relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl border text-sm transition",
                selected === day.date ? "border-maroon-500 ring-2 ring-maroon-200" : "border-transparent",
                isPast ? "bg-ivory-50 text-charcoal-400" : "bg-ivory-100 text-charcoal-900 hover:bg-ivory-200",
                isToday ? "font-bold" : "",
              ].join(" ")}
            >
              <span>{num}</span>
              <span
                className={`h-1.5 w-1.5 rounded-full ${s.kind ? KIND_DOT[s.kind] : "bg-green-500"}`}
                aria-hidden
              />
              {isToday && (
                <span className="absolute inset-x-2 top-1 text-[8px] font-bold uppercase text-maroon-600">
                  Today
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Legend. Text, not colour alone. ──────────────────────────────── */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-3 text-[11px] text-charcoal-600">
        <Legend dot="bg-green-500" label="Free" />
        <Legend dot={KIND_DOT.online} label="Online booking" />
        <Legend dot={KIND_DOT.offline} label="Offline booking" />
        <Legend dot={KIND_DOT.platform} label="Blocked by Hallnect" />
      </ul>

      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-charcoal-400">
        <Radio className={`h-3 w-3 shrink-0 ${live ? "text-green-600" : "text-charcoal-300"}`} aria-hidden />
        {live
          ? "Live — this updates by itself when a customer books."
          : "Reconnecting… the calendar will catch up on its own."}
      </p>

      {selectedDay && (
        <DaySheet
          hallId={hallId}
          day={selectedDay}
          onClose={() => setSelected(null)}
          onDone={(msg) => { setSelected(null); setFlash(msg); router.refresh(); }}
        />
      )}
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      {label}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The detail sheet. SELECT DATE → BLOCK → CONFIRM → DONE, and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

function DaySheet({
  hallId, day, onClose, onDone,
}: {
  hallId: string;
  day: CalendarDay;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<CalendarSlot>(day.free.full_day ? "full_day" : day.free.morning ? "morning" : "evening");
  const [until, setUntil] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [details, setDetails] = useState({ customerName: "", customerPhone: "", reference: "", notes: "" });

  // One idempotency key per attempt-series. A retry after a dropped connection
  // reuses it and gets the ORIGINAL booking back, instead of a second one or a
  // confusing "those dates are not free" raised by its own first attempt.
  // Minted lazily: useRef(crypto.randomUUID()) would burn a uuid on every
  // render and, in a client component, once on the server too.
  const token = useRef<string | null>(null);
  if (token.current === null) token.current = crypto.randomUUID();

  const offlineClaims = day.claims.filter((c) => c.kind === "offline");
  const onlineClaims = day.claims.filter((c) => c.kind === "online");
  const platformClaims = day.claims.filter((c) => c.kind === "platform");
  const anyFree = day.free.full_day || day.free.morning || day.free.evening;

  const heading = formatIsoDateLabel(day.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  function block() {
    setError(null);
    start(async () => {
      const r = await addOfflineBooking({
        hallId,
        eventDate: day.date,
        endDate: until || day.date,
        slot,
        clientToken: token.current ?? undefined,
        ...details,
      });
      if ("error" in r) {
        setError(r.error);
        // A NEW attempt after a real refusal must not reuse the key: the retry
        // path is for the same request, not the next one.
        token.current = crypto.randomUUID();
        return;
      }
      onDone(until && until !== day.date ? "Those dates are blocked." : "That date is blocked.");
    });
  }

  function release(id: string) {
    setError(null);
    start(async () => {
      const r = await releaseOfflineBooking(id, hallId);
      if ("error" in r) { setError(r.error); return; }
      onDone("Released — those dates are bookable again.");
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button" aria-label="Close" onClick={onClose}
        className="absolute inset-0 bg-charcoal-900/40"
      />
      <div
        role="dialog" aria-modal="true" aria-label={`Manage ${heading}`}
        className="relative max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:max-w-md sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-serif text-base font-bold text-charcoal-900">{heading}</h3>
          <button
            type="button" onClick={onClose} aria-label="Close"
            className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-charcoal-500 hover:bg-ivory-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {error && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-red-50 p-2 text-xs text-red-800" role="alert">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
          </p>
        )}

        {/* ── What already holds this date ───────────────────────────────── */}
        {day.claims.length > 0 && (
          <ul className="mt-3 space-y-2">
            {onlineClaims.map((c, i) => (
              <li key={`on-${i}`} className={`rounded-xl border p-2.5 text-xs ${KIND_CHIP.online}`}>
                <p className="font-semibold">{KIND_LABEL.online} · {SLOT_LABEL[c.slot]}</p>
                <p className="mt-0.5">
                  A customer has paid for this on Hallnect. It can only be changed from{" "}
                  <Link href="/owner/bookings" className="underline">Bookings</Link>.
                </p>
              </li>
            ))}
            {offlineClaims.map((c) => (
              <li key={c.offlineBookingId} className={`rounded-xl border p-2.5 text-xs ${KIND_CHIP.offline}`}>
                <p className="font-semibold">{KIND_LABEL.offline} · {SLOT_LABEL[c.slot]}</p>
                <p className="mt-0.5">
                  {c.customerName || "No name recorded"}
                  {c.reference && <> · ref {c.reference}</>}
                  {c.spansOtherDays && (
                    <> · covers {formatIsoDateLabel(c.startDate, { day: "numeric", month: "short" })}
                      {" – "}{formatIsoDateLabel(c.endDate, { day: "numeric", month: "short" })}</>
                  )}
                </p>
                <button
                  type="button" disabled={pending}
                  onClick={() => release(c.offlineBookingId as string)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-50 disabled:opacity-50"
                >
                  {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                  {c.spansOtherDays ? "Release all of these dates" : "Release this date"}
                </button>
              </li>
            ))}
            {platformClaims.map((c, i) => (
              <li key={`pf-${i}`} className={`rounded-xl border p-2.5 text-xs ${KIND_CHIP.platform}`}>
                <p className="flex items-center gap-1.5 font-semibold">
                  <Lock className="h-3 w-3" aria-hidden /> {KIND_LABEL.platform} · {SLOT_LABEL[c.slot]}
                </p>
                <p className="mt-0.5">Contact Hallnect support to have this lifted.</p>
              </li>
            ))}
          </ul>
        )}

        {/* ── Block ──────────────────────────────────────────────────────── */}
        {anyFree ? (
          <div className="mt-4 space-y-3 border-t border-border pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
              Block for an offline booking
            </p>

            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Which part of the day">
              {(["full_day", "morning", "evening"] as CalendarSlot[]).map((s) => (
                <button
                  key={s} type="button" disabled={!day.free[s] || pending}
                  onClick={() => setSlot(s)} aria-pressed={slot === s}
                  className={[
                    "rounded-lg border px-2 py-2 text-xs font-semibold transition",
                    slot === s ? "border-maroon-500 bg-maroon-50 text-maroon-800" : "border-border bg-white text-charcoal-700",
                    !day.free[s] ? "cursor-not-allowed opacity-40" : "",
                  ].join(" ")}
                >
                  {SLOT_LABEL[s]}
                  {!day.free[s] && <span className="sr-only"> — already taken</span>}
                </button>
              ))}
            </div>

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
                Also block until <span className="font-normal normal-case text-charcoal-400">(optional — for a multi-day event)</span>
              </span>
              <input
                type="date" value={until} min={addDaysToIsoDate(day.date, 1)}
                onChange={(e) => setUntil(e.target.value)} disabled={pending}
                className="w-full rounded-lg border border-border bg-white px-2.5 py-2 text-sm outline-none focus:border-maroon-400"
              />
            </label>

            <button
              type="button" onClick={() => setShowDetails((v) => !v)}
              aria-expanded={showDetails}
              className="text-[11px] font-semibold text-maroon-700 underline"
            >
              {showDetails ? "Hide customer details" : "Add customer details (optional)"}
            </button>

            {showDetails && (
              <div className="grid gap-2 rounded-xl bg-ivory-50 p-2.5 sm:grid-cols-2">
                <Input label="Customer name" value={details.customerName} max={120}
                  onChange={(v) => setDetails((d) => ({ ...d, customerName: v }))} />
                <Input label="Phone" value={details.customerPhone} max={20} inputMode="tel"
                  onChange={(v) => setDetails((d) => ({ ...d, customerPhone: v }))} />
                <Input label="Your reference" value={details.reference} max={80}
                  onChange={(v) => setDetails((d) => ({ ...d, reference: v }))} />
                <Input label="Notes" value={details.notes} max={1000}
                  onChange={(v) => setDetails((d) => ({ ...d, notes: v }))} />
                <p className="text-[10px] text-charcoal-500 sm:col-span-2">
                  Kept private to you and Hallnect support. Customers only ever see that
                  the date is unavailable.
                </p>
              </div>
            )}

            <button
              type="button" onClick={block} disabled={pending}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-maroon-600 px-3 py-3 text-sm font-semibold text-white hover:bg-maroon-700 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {pending ? "Blocking…" : until && until !== day.date ? "Block these dates" : "Block this date"}
            </button>
            <p className="text-[11px] text-charcoal-400">
              Saved the moment you press it — there is nothing else to save.
            </p>
          </div>
        ) : (
          <p className="mt-4 border-t border-border pt-3 text-xs text-charcoal-500">
            Every part of this day is already taken.
          </p>
        )}
      </div>
    </div>
  );
}

function Input({
  label, value, onChange, max, inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  inputMode?: "tel";
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-charcoal-500">
        {label}
      </span>
      <input
        value={value} maxLength={max} inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-white px-2.5 py-2 text-sm outline-none focus:border-maroon-400"
      />
    </label>
  );
}
