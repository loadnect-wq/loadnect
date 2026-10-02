"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The diary screen. One column, thumb-reachable, readable in Tamil or English.
//
//   summary      what is coming up, and how much money is still to collect
//   calendar     the month: whose date is whose, with muhurtham days marked
//   list         every upcoming function, then past ones still owing money
//
// Tapping a date opens what holds it (or "add booking on this day"); tapping a
// booking opens its detail, where the WhatsApp receipt and reminder live.
//
// Everything the owner changes goes through a server action and then a
// refresh, so the screen always shows what the database holds — there is no
// local copy of a booking that could drift from it.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Globe, Lock, Plus, Wallet } from "lucide-react";
import { BottomSheet } from "@/components/app/BottomSheet";
import { setDiaryLanguage } from "@/app/owner/(dashboard)/actions";
import { isMuhurtham } from "@/lib/muhurtham";
import {
  balanceDue,
  bookingUnit,
  dt,
  formatAmount,
  formatDiaryDates,
  formatDiaryDay,
  formatMonthTitle,
  formatWeekday,
  paymentState,
  slotLabel,
  type DiaryBooking,
  type DiaryLang,
  type DiaryOnline,
} from "@/lib/diary";
import type { CalendarDay } from "@/lib/owner-calendar";
import { cn } from "@/lib/utils";
import { BookingForm } from "./BookingForm";
import { BookingDetail } from "./BookingDetail";
import { InstallHint } from "./InstallHint";

type Props = {
  lang: DiaryLang;
  hall: { id: string; name: string };
  halls: { id: string; name: string }[];
  today: string;
  month: string;
  prevMonth: string | null;
  nextMonth: string | null;
  days: CalendarDay[];
  bookings: DiaryBooking[];
  online: DiaryOnline[];
};

type Sheet =
  | { kind: "day"; date: string }
  | { kind: "add"; date: string }
  | { kind: "detail"; id: string }
  | { kind: "edit"; id: string }
  | null;

type Row =
  | { type: "own"; booking: DiaryBooking }
  | { type: "online"; booking: DiaryOnline };

export function Diary({ lang: serverLang, hall, halls, today, month, prevMonth, nextMonth, days, bookings, online }: Props) {
  const router = useRouter();
  const [lang, setOptimisticLang] = useOptimistic(serverLang);
  const [, startLang] = useTransition();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dueOnly, setDueOnly] = useState(false);

  const byId = useMemo(() => new Map(bookings.map((b) => [b.id, b])), [bookings]);

  // ── Summary ───────────────────────────────────────────────────────────────
  const upcomingOwn = bookings.filter((b) => b.endDate >= today);
  const upcomingCount = upcomingOwn.length + online.length;
  const toCollect = bookings.reduce((sum, b) => {
    const due = balanceDue(b.totalAmount, b.amountReceived);
    return due ? sum + due : sum;
  }, 0);
  const pastDue = bookings.filter((b) => b.endDate < today && paymentState(b.totalAmount, b.amountReceived) === "due");

  // ── The list: upcoming own + online, by date, grouped by month ────────────
  const rows: Row[] = [
    ...upcomingOwn.map((b): Row => ({ type: "own", booking: b })),
    ...online.map((b): Row => ({ type: "online", booking: b })),
  ]
    .filter((r) => !dueOnly || (r.type === "own" && paymentState(r.booking.totalAmount, r.booking.amountReceived) === "due"))
    .sort((a, b) => a.booking.eventDate.localeCompare(b.booking.eventDate));

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.booking.eventDate.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  function go(params: { hall?: string; m?: string | null }) {
    const q = new URLSearchParams({ hall: params.hall ?? hall.id });
    const m = params.m === undefined ? month : params.m;
    if (m) q.set("m", m);
    setSheet(null);
    router.push(`/owner/diary?${q.toString()}`, { scroll: false });
  }

  function switchLang(next: DiaryLang) {
    if (next === lang) return;
    startLang(async () => {
      setOptimisticLang(next);
      await setDiaryLanguage(next);
      router.refresh();
    });
  }

  function done(message: string) {
    setSheet(null);
    setFlash(message);
    router.refresh();
  }

  const selected = sheet && (sheet.kind === "detail" || sheet.kind === "edit") ? byId.get(sheet.id) ?? null : null;
  const dayOpen = sheet?.kind === "day" ? days.find((d) => d.date === sheet.date) ?? null : null;

  return (
    <div lang={lang === "ta" ? "ta" : undefined} className="mx-auto max-w-2xl space-y-4 px-4 pb-24 pt-4 sm:px-6">
      {/* ── Title, language, hall ─────────────────────────────────────────── */}
      {/* The subtitle sits on its own line, under the title-and-toggle row:
          beside the toggle, Tamil wrapped it into a column four words wide. */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 text-xl font-bold leading-snug text-charcoal-900">{dt(lang, "title")}</h1>
        <div role="group" aria-label="Language" className="flex shrink-0 items-center rounded-full bg-white p-1 ring-1 ring-black/5">
          <Globe className="ml-1.5 mr-1 h-3.5 w-3.5 text-charcoal-500" aria-hidden />
          {(["en", "ta"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => switchLang(l)}
              aria-pressed={lang === l}
              lang={l}
              className={cn(
                "min-h-[36px] rounded-full px-3 text-xs font-semibold transition-colors",
                lang === l ? "bg-maroon-600 text-white" : "text-charcoal-700 hover:bg-ivory-100",
              )}
            >
              {l === "en" ? "English" : "தமிழ்"}
            </button>
          ))}
        </div>
      </div>
      <p className="-mt-2 text-sm text-charcoal-600">{dt(lang, "subtitle")}</p>

      {halls.length > 1 && (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-charcoal-600">{dt(lang, "hall")}</span>
          <select
            value={hall.id}
            onChange={(e) => go({ hall: e.target.value, m: null })}
            className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm font-semibold text-charcoal-900"
          >
            {halls.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </label>
      )}
      {halls.length === 1 && <p className="text-sm font-semibold text-maroon-700">{hall.name}</p>}

      {flash && (
        <p role="status" className="flex items-center gap-1.5 rounded-xl bg-green-50 px-3 py-2 text-sm font-medium text-green-800">
          <Check className="h-4 w-4 shrink-0" aria-hidden /> {flash}
        </p>
      )}

      {/* ── Summary ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white p-4 shadow-card">
          <p className="text-xs font-semibold text-charcoal-600">{dt(lang, "comingUp")}</p>
          <p className="mt-1 text-2xl font-bold leading-none tabular-nums text-charcoal-900">{upcomingCount}</p>
          <p className="mt-1 text-xs text-charcoal-600">{bookingUnit(lang, upcomingCount)}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-card">
          <p className="flex items-center gap-1 text-xs font-semibold text-charcoal-600">
            <Wallet className="h-3.5 w-3.5" aria-hidden /> {dt(lang, "toCollect")}
          </p>
          <p className={cn("mt-1 text-lg font-bold tabular-nums", toCollect > 0 ? "text-amber-800" : "text-charcoal-900")}>
            {toCollect > 0 ? `₹${formatAmount(toCollect)}` : dt(lang, "nothingDue")}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => { setFlash(null); setSheet({ kind: "add", date: today }); }}
        className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-maroon-600 text-base font-semibold text-white shadow-maroon transition active:scale-[0.99] hover:bg-maroon-700 motion-reduce:active:scale-100"
      >
        <Plus className="h-5 w-5" aria-hidden /> {dt(lang, "addBooking")}
      </button>

      <InstallHint lang={lang} />

      {/* ── Month calendar ────────────────────────────────────────────────── */}
      <MonthCalendar
        lang={lang}
        month={month}
        today={today}
        days={days}
        prevMonth={prevMonth}
        nextMonth={nextMonth}
        onMonth={(m) => go({ m })}
        onDay={(date) => { setFlash(null); setSheet({ kind: "day", date }); }}
      />

      {/* ── Upcoming ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="diary-upcoming" className="rounded-2xl bg-white p-4 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <h2 id="diary-upcoming" className="text-base font-bold text-charcoal-900">{dt(lang, "comingUp")}</h2>
          <button
            type="button"
            aria-pressed={dueOnly}
            onClick={() => setDueOnly((v) => !v)}
            className={cn(
              "min-h-[36px] rounded-full px-3 text-xs font-semibold ring-1 transition-colors",
              dueOnly ? "bg-amber-100 text-amber-900 ring-amber-300" : "bg-white text-charcoal-700 ring-charcoal-200",
            )}
          >
            {dt(lang, "moneyDueOnly")}
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-charcoal-600">{dt(lang, dueOnly ? "noneDue" : "noUpcoming")}</p>
        ) : (
          <div className="mt-2 space-y-4">
            {[...groups.entries()].map(([key, items]) => (
              <div key={key}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">{formatMonthTitle(lang, key)}</h3>
                <ul className="mt-1 divide-y divide-border">
                  {items.map((r) => (
                    <li key={`${r.type}-${r.booking.id}`}>
                      {r.type === "own" ? (
                        <OwnRow lang={lang} booking={r.booking} onOpen={() => { setFlash(null); setSheet({ kind: "detail", id: r.booking.id }); }} />
                      ) : (
                        <OnlineRow lang={lang} booking={r.booking} />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Past functions still owing money ──────────────────────────────── */}
      {pastDue.length > 0 && !dueOnly && (
        <section aria-labelledby="diary-pastdue" className="rounded-2xl bg-white p-4 shadow-card">
          <h2 id="diary-pastdue" className="text-base font-bold text-charcoal-900">{dt(lang, "pastDue")}</h2>
          <ul className="mt-1 divide-y divide-border">
            {pastDue.map((b) => (
              <li key={b.id}>
                <OwnRow lang={lang} booking={b} onOpen={() => { setFlash(null); setSheet({ kind: "detail", id: b.id }); }} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="flex items-start gap-2 rounded-2xl bg-white p-4 text-xs leading-relaxed text-charcoal-600 shadow-card">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {dt(lang, "privacy")}
      </p>

      {/* ── Sheets ────────────────────────────────────────────────────────── */}
      <BottomSheet
        open={sheet?.kind === "day" && !!dayOpen}
        onClose={() => setSheet(null)}
        title={dayOpen ? formatDiaryDay(lang, dayOpen.date, { year: true }) : ""}
      >
        {dayOpen && (
          <DayDetail
            lang={lang}
            day={dayOpen}
            bookings={byId}
            onOpenBooking={(id) => setSheet({ kind: "detail", id })}
            onAdd={() => setSheet({ kind: "add", date: dayOpen.date })}
          />
        )}
      </BottomSheet>

      <BottomSheet
        open={sheet?.kind === "add"}
        onClose={() => setSheet(null)}
        title={dt(lang, "newBooking")}
      >
        {sheet?.kind === "add" && (
          <BookingForm
            key={sheet.date}
            lang={lang}
            hallId={hall.id}
            initialDate={sheet.date}
            onDone={() => done(dt(lang, "saved"))}
          />
        )}
      </BottomSheet>

      <BottomSheet
        open={sheet?.kind === "edit" && !!selected}
        onClose={() => setSheet(selected ? { kind: "detail", id: selected.id } : null)}
        title={dt(lang, "editBooking")}
      >
        {sheet?.kind === "edit" && selected && (
          <BookingForm
            key={selected.id}
            lang={lang}
            hallId={hall.id}
            booking={selected}
            onDone={() => done(dt(lang, "saved"))}
          />
        )}
      </BottomSheet>

      <BottomSheet
        open={sheet?.kind === "detail" && !!selected}
        onClose={() => setSheet(null)}
        title={selected?.customerName || dt(lang, "noName")}
      >
        {sheet?.kind === "detail" && selected && (
          <BookingDetail
            key={selected.id}
            lang={lang}
            hall={hall}
            booking={selected}
            onEdit={() => setSheet({ kind: "edit", id: selected.id })}
            onDone={done}
          />
        )}
      </BottomSheet>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function PaymentChip({ lang, booking }: { lang: DiaryLang; booking: DiaryBooking }) {
  const state = paymentState(booking.totalAmount, booking.amountReceived);
  if (state === "unrecorded") {
    return <span className="text-xs text-charcoal-500">{dt(lang, "noAmount")}</span>;
  }
  if (state === "paid") {
    return <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800">{dt(lang, "paidInFull")}</span>;
  }
  return (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-900 ring-1 ring-amber-200">
      {dt(lang, "dueAmount", { amount: formatAmount(balanceDue(booking.totalAmount, booking.amountReceived) ?? 0) })}
    </span>
  );
}

function DateBadge({ iso, lang }: { iso: string; lang: DiaryLang }) {
  const d = Number(iso.slice(8, 10));
  const wd = formatWeekday(lang, iso);
  return (
    <span className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-ivory-100 py-1.5">
      <span className="text-lg font-bold leading-none tabular-nums text-charcoal-900">{d}</span>
      <span className="mt-0.5 max-w-full truncate px-0.5 text-[10px] font-semibold text-charcoal-600">{wd}</span>
    </span>
  );
}

function OwnRow({ lang, booking, onOpen }: { lang: DiaryLang; booking: DiaryBooking; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-3 text-left">
      <DateBadge iso={booking.eventDate} lang={lang} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-charcoal-900">
          {booking.customerName || dt(lang, "noName")}
          {isMuhurtham(booking.eventDate) && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-gold-500 align-middle" aria-label={dt(lang, "legendMuhurtham")} />}
        </span>
        <span className="block text-xs text-charcoal-600">
          {formatDiaryDates(lang, booking.eventDate, booking.endDate)} · {slotLabel(lang, booking.slot)}
        </span>
        <span className="mt-1 block"><PaymentChip lang={lang} booking={booking} /></span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-charcoal-400" aria-hidden />
    </button>
  );
}

function OnlineRow({ lang, booking }: { lang: DiaryLang; booking: DiaryOnline }) {
  return (
    <Link href="/owner/bookings" className="flex w-full items-center gap-3 py-3">
      <DateBadge iso={booking.eventDate} lang={lang} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-charcoal-900">{dt(lang, "legendOnline")}</span>
        <span className="block text-xs text-charcoal-600">
          {formatDiaryDates(lang, booking.eventDate, booking.endDate)} · {slotLabel(lang, booking.slot)}
        </span>
      </span>
      <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden />
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function MonthCalendar({
  lang, month, today, days, prevMonth, nextMonth, onMonth, onDay,
}: {
  lang: DiaryLang;
  month: string;
  today: string;
  days: CalendarDay[];
  prevMonth: string | null;
  nextMonth: string | null;
  onMonth: (m: string) => void;
  onDay: (date: string) => void;
}) {
  const [y, m] = month.split("-").map(Number);
  const leading = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const weekdays = lang === "ta"
    ? ["ஞா", "தி", "செ", "பு", "வி", "வெ", "ச"]
    : ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <section aria-label={formatMonthTitle(lang, month)} className="rounded-2xl bg-white p-3 shadow-card sm:p-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => prevMonth && onMonth(prevMonth)}
          disabled={!prevMonth}
          aria-label={dt(lang, "prevMonth")}
          className="grid h-11 w-11 place-items-center rounded-full text-charcoal-700 hover:bg-ivory-100 disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <h2 className="text-base font-bold text-charcoal-900" aria-live="polite">{formatMonthTitle(lang, month)}</h2>
        <button
          type="button"
          onClick={() => nextMonth && onMonth(nextMonth)}
          disabled={!nextMonth}
          aria-label={dt(lang, "nextMonth")}
          className="grid h-11 w-11 place-items-center rounded-full text-charcoal-700 hover:bg-ivory-100 disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1">
        {weekdays.map((w, i) => (
          <div key={i} aria-hidden className="pb-1 text-center text-[11px] font-semibold text-charcoal-500">{w}</div>
        ))}
        {Array.from({ length: leading }, (_, i) => <div key={`pad-${i}`} aria-hidden />)}
        {days.map((day) => {
          const kinds = new Set(day.claims.map((c) => c.kind));
          const muhurtham = isMuhurtham(day.date);
          const past = day.date < today;
          const status = day.claims.length === 0
            ? dt(lang, "legendFree")
            : [
                kinds.has("offline") && dt(lang, "legendYours"),
                kinds.has("online") && dt(lang, "legendOnline"),
                kinds.has("platform") && dt(lang, "legendBlocked"),
              ].filter(Boolean).join(", ");
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => onDay(day.date)}
              aria-label={`${formatDiaryDay(lang, day.date)}: ${status}${muhurtham ? `, ${dt(lang, "legendMuhurtham")}` : ""}`}
              className={cn(
                "relative flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-xl text-sm tabular-nums transition-colors",
                day.claims.length > 0
                  ? kinds.has("online") ? "bg-red-50 text-red-900" : kinds.has("offline") ? "bg-amber-50 text-amber-950" : "bg-charcoal-50 text-charcoal-700"
                  : past ? "text-charcoal-400" : "bg-ivory-100 text-charcoal-900 hover:bg-ivory-200",
                day.date === today && "ring-2 ring-maroon-500",
              )}
            >
              {muhurtham && <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-gold-500" />}
              <span className={cn(day.date === today && "font-bold")}>{Number(day.date.slice(8))}</span>
              <span className="flex h-1.5 gap-0.5" aria-hidden>
                {kinds.has("offline") && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                {kinds.has("online") && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                {kinds.has("platform") && <span className="h-1.5 w-1.5 rounded-full bg-charcoal-500" />}
              </span>
            </button>
          );
        })}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-3 text-[11px] text-charcoal-600">
        <Legend dot="bg-amber-500" label={dt(lang, "legendYours")} />
        <Legend dot="bg-red-500" label={dt(lang, "legendOnline")} />
        <Legend dot="bg-charcoal-500" label={dt(lang, "legendBlocked")} />
        <Legend dot="bg-gold-500" label={dt(lang, "legendMuhurtham")} />
      </ul>
    </section>
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

function DayDetail({
  lang, day, bookings, onOpenBooking, onAdd,
}: {
  lang: DiaryLang;
  day: CalendarDay;
  bookings: Map<string, DiaryBooking>;
  onOpenBooking: (id: string) => void;
  onAdd: () => void;
}) {
  const anyFree = day.free.full_day || day.free.morning || day.free.evening;
  // A multi-day booking appears on each of its days with the same id; list it once.
  const seen = new Set<string>();
  const claims = day.claims.filter((c) => {
    const key = c.offlineBookingId ?? c.bookingId ?? `${c.kind}-${c.slot}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div className="space-y-3 pb-2">
      {isMuhurtham(day.date) && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-50 px-2.5 py-1 text-xs font-semibold text-gold-800 ring-1 ring-gold-300/70">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-500" aria-hidden /> {dt(lang, "legendMuhurtham")}
        </span>
      )}

      {claims.length === 0 && <p className="text-sm text-charcoal-600">{dt(lang, "legendFree")}</p>}

      <ul className="space-y-2">
        {claims.map((c, i) => {
          if (c.kind === "offline" && c.offlineBookingId) {
            const b = bookings.get(c.offlineBookingId);
            return (
              <li key={c.offlineBookingId}>
                <button
                  type="button"
                  onClick={() => onOpenBooking(c.offlineBookingId as string)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-amber-950">
                      {b?.customerName || c.customerName || dt(lang, "noName")}
                    </span>
                    <span className="block text-xs text-amber-900">
                      {slotLabel(lang, c.slot)}
                      {c.spansOtherDays && ` · ${formatDiaryDates(lang, c.startDate, c.endDate)}`}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-amber-700" aria-hidden />
                </button>
              </li>
            );
          }
          if (c.kind === "online") {
            return (
              <li key={`on-${c.bookingId ?? i}`} className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <p className="font-semibold">{dt(lang, "legendOnline")} · {slotLabel(lang, c.slot)}</p>
                <p className="mt-0.5 text-xs">{dt(lang, "onlineNote")}</p>
                <Link href="/owner/bookings" className="mt-2 inline-flex min-h-[40px] items-center text-xs font-semibold underline">
                  {dt(lang, "openBookings")}
                </Link>
              </li>
            );
          }
          return (
            <li key={`pf-${i}`} className="rounded-xl border border-border bg-charcoal-50 p-3 text-sm text-charcoal-700">
              <p className="font-semibold">{dt(lang, "legendBlocked")} · {slotLabel(lang, c.slot)}</p>
              <p className="mt-0.5 text-xs">{dt(lang, "blockedNote")}</p>
            </li>
          );
        })}
      </ul>

      {anyFree ? (
        <button
          type="button"
          onClick={onAdd}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-maroon-600 text-sm font-semibold text-white hover:bg-maroon-700"
        >
          <Plus className="h-4 w-4" aria-hidden /> {dt(lang, "addOnDay")}
        </button>
      ) : (
        <p className="text-sm text-charcoal-600">{dt(lang, "dayFull")}</p>
      )}
    </div>
  );
}
