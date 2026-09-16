"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/_components/MobileSearch.tsx — the phone homepage's search.
//
// Replaces two controls that did less than they looked like they did: a
// "Search by hall name, city or area…" box that was really a link to /halls
// (with a microphone that did nothing), and a "Browse by city" picker. Neither
// could ask for a date or a guest count, which are the two questions that
// decide whether a hall is any use at all.
//
// THE SAME THREE QUESTIONS AS THE DESKTOP PILL — Where, When, Guests — and the
// same URL, built by lib/search-url.ts. The card shows the answers; tapping any
// row opens one sheet holding all three, scrolled to the row that was tapped,
// so a visitor can answer one question or all of them without a wizard.
//
// Where lists only cities with live inventory, with the real hall count.
// When is a one-month calendar with Today / This weekend / Next weekend.
// Guests uses the /halls capacity steps.
// ─────────────────────────────────────────────────────────────────────────────

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { CalendarDays, MapPin, Search, Users } from "lucide-react";
import { BottomSheet } from "@/components/app/BottomSheet";
import { DateRangeCalendar } from "@/components/sections/DateRangeCalendar";
import {
  GUEST_PRESETS,
  buildHallSearchHref,
  formatDateChoice,
  weekendRange,
  type SearchCity,
} from "@/lib/search-url";
import { cn } from "@/lib/utils";

type Section = "where" | "when" | "guests";

export function MobileSearch({ cities, today }: { cities: readonly SearchCity[]; today: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sheet, setSheet] = useState<Section | null>(null);
  const [city, setCity] = useState("");
  const [date, setDate] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [capacity, setCapacity] = useState("");
  const ids = useId();

  // Bring the tapped question into view once the sheet has laid out.
  useEffect(() => {
    if (!sheet || sheet === "where") return;
    const timer = window.setTimeout(() => {
      document.getElementById(`${ids}-${sheet}`)?.scrollIntoView({ block: "start" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [sheet, ids]);

  const go = () => {
    setSheet(null);
    const href = buildHallSearchHref({ city, date, dateTo, capacity });
    startTransition(() => router.push(href));
  };

  const clearAll = () => {
    setCity("");
    setDate("");
    setDateTo("");
    setCapacity("");
  };

  const dateLabel = formatDateChoice(date, dateTo);
  const quickDates = [
    { label: "Today", range: { date: today, dateTo: "" } },
    { label: "This weekend", range: weekendRange(today, "this") },
    { label: "Next weekend", range: weekendRange(today, "next") },
  ];
  const anyChoice = Boolean(city || date || capacity);

  return (
    <>
      <div className="rounded-3xl bg-white p-2 shadow-elevated ring-1 ring-black/5">
        <Row
          Icon={MapPin}
          label="Where"
          value={city || null}
          placeholder="Any city in Tamil Nadu"
          onClick={() => setSheet("where")}
        />
        <div aria-hidden className="mx-3 h-px bg-charcoal-100" />
        <div className="grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-center">
          <Row
            Icon={CalendarDays}
            label="When"
            value={dateLabel}
            placeholder="Add dates"
            onClick={() => setSheet("when")}
          />
          <span aria-hidden className="h-8 bg-charcoal-100" />
          <Row
            Icon={Users}
            label="Guests"
            value={capacity ? `${capacity}+` : null}
            placeholder="Add guests"
            onClick={() => setSheet("guests")}
          />
        </div>
        <button
          type="button"
          onClick={go}
          disabled={isPending}
          className={cn(
            "mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-maroon-600 text-sm font-semibold text-white",
            "shadow-maroon transition active:scale-[0.99] motion-reduce:active:scale-100 disabled:opacity-70",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-600 focus-visible:ring-offset-2",
          )}
        >
          {isPending ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
          ) : (
            <Search className="h-5 w-5" aria-hidden />
          )}
          Search halls
        </button>
      </div>

      <BottomSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        title="Find your hall"
        footer={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={clearAll}
              disabled={!anyChoice}
              className="h-12 rounded-2xl px-3 text-sm font-semibold text-charcoal-800 underline underline-offset-4 disabled:text-charcoal-400 disabled:no-underline"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={go}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-maroon-600 text-sm font-semibold text-white active:scale-[0.99] motion-reduce:active:scale-100"
            >
              <Search className="h-5 w-5" aria-hidden />
              Search halls
            </button>
          </div>
        }
      >
        <div className="space-y-7 pb-2">
          <section id={`${ids}-where`} aria-labelledby={`${ids}-where-h`} className="scroll-mt-2">
            <SheetHeading id={`${ids}-where-h`} Icon={MapPin}>Where</SheetHeading>
            <ul className="mt-3 flex flex-wrap gap-2">
              {[{ city: "", venueCount: 0 }, ...cities].map((c) => (
                <li key={c.city || "any"}>
                  <Chip selected={city === c.city} onClick={() => setCity(c.city)}>
                    {c.city || "Any city"}
                    {c.city && " "}
                    {c.city && (
                      <span className={cn("ml-1.5 text-xs font-normal", city === c.city ? "text-white/90" : "text-charcoal-600")}>
                        {c.venueCount === 1 ? "1 hall" : `${c.venueCount} halls`}
                      </span>
                    )}
                  </Chip>
                </li>
              ))}
            </ul>
          </section>

          <section id={`${ids}-when`} aria-labelledby={`${ids}-when-h`} className="scroll-mt-2">
            <div className="flex items-baseline justify-between gap-3">
              <SheetHeading id={`${ids}-when-h`} Icon={CalendarDays}>When</SheetHeading>
              {date && (
                <button
                  type="button"
                  onClick={() => {
                    setDate("");
                    setDateTo("");
                  }}
                  className="hit-44 text-sm font-semibold text-maroon-700"
                >
                  Clear dates
                </button>
              )}
            </div>
            <ul className="mt-3 flex flex-wrap gap-2">
              {quickDates.map(({ label, range }) => {
                const end = range.dateTo > range.date ? range.dateTo : "";
                return (
                  <li key={label}>
                    <Chip
                      selected={date === range.date && dateTo === end}
                      onClick={() => {
                        setDate(range.date);
                        setDateTo(end);
                      }}
                    >
                      {label}
                    </Chip>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-sm text-charcoal-700" aria-live="polite">
              {dateLabel ? (
                <>
                  <span className="font-semibold text-charcoal-900">{dateLabel}</span>
                  {!dateTo && " · tap a later day to make it a range"}
                </>
              ) : (
                "Pick a day, or a first and last day."
              )}
            </p>
            <div className="mt-4 flex justify-center">
              <DateRangeCalendar
                months={1}
                today={today}
                from={date}
                to={dateTo}
                onChange={(f, t) => {
                  setDate(f);
                  setDateTo(t);
                }}
              />
            </div>
          </section>

          <section id={`${ids}-guests`} aria-labelledby={`${ids}-guests-h`} className="scroll-mt-2">
            <SheetHeading id={`${ids}-guests-h`} Icon={Users}>Guests</SheetHeading>
            <p className="mt-1 text-xs text-charcoal-600">Halls that hold at least this many.</p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {["", ...GUEST_PRESETS].map((g) => (
                <Chip key={g || "any"} selected={capacity === g} onClick={() => setCapacity(g)} block>
                  {g ? `${g}+` : "Any"}
                </Chip>
              ))}
            </div>
          </section>
        </div>
      </BottomSheet>
    </>
  );
}

function Row({
  Icon,
  label,
  value,
  placeholder,
  onClick,
}: {
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  value: string | null;
  placeholder: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors active:bg-charcoal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-600"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-maroon-50 text-maroon-600">
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-charcoal-600">{label}</span>{" "}
        <span className={cn("block truncate text-sm", value ? "font-semibold text-charcoal-900" : "text-charcoal-600")}>
          {value ?? placeholder}
        </span>
      </span>
    </button>
  );
}

function SheetHeading({
  id,
  Icon,
  children,
}: {
  id: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: React.ReactNode;
}) {
  return (
    <h3 id={id} className="flex items-center gap-2 text-base font-semibold text-charcoal-900">
      <Icon className="h-4 w-4 text-maroon-600" aria-hidden />
      {children}
    </h3>
  );
}

function Chip({
  selected,
  onClick,
  block,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  block?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold ring-1 transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-600",
        block && "w-full px-2",
        selected
          ? "bg-maroon-600 text-white ring-maroon-600"
          : "bg-white text-charcoal-800 ring-charcoal-200 active:bg-charcoal-50",
      )}
    >
      {children}
    </button>
  );
}
