"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/sections/HeroSearch.tsx — the desktop hero search.
//
// THREE QUESTIONS, NOT FOUR FIELDS. It was Location / Available From /
// Available Till / Guests: two raw browser date boxes ("dd-mm-yyyy") for what
// is one question, a select, and a number box whose placeholder failed
// contrast. Now each segment is a button that opens a panel built for its
// question:
//
//   Where    cities that ACTUALLY hold inventory, each with its real hall
//            count, plus "Any city"
//   When     one date or a range on a two-month calendar, with This weekend /
//            Next weekend shortcuts
//   Guests   capacity presets matching the /halls filter
//
// EVERY ANSWER IS STILL A REAL PARAMETER — city, date, dateTo, capacity — built
// by lib/search-url.ts, the same function the mobile search uses. This codebase
// has already shipped one prominent dead control; a search panel that changes a
// label and nothing else would be the same mistake again.
//
// PANELS OPEN UPWARD. The pill is pinned to the bottom of the hero while it
// scrubs, so a panel opening down would leave the screen.
//
// Only one panel is open at a time. Escape or a click outside closes it and
// returns focus to the segment that opened it.
// ─────────────────────────────────────────────────────────────────────────────

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { CalendarDays, Check, MapPin, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { DateRangeCalendar } from "./DateRangeCalendar";
import {
  GUEST_PRESETS,
  buildHallSearchHref,
  formatDateChoice,
  weekendRange,
  type SearchCity,
} from "@/lib/search-url";

export type { SearchCity };

type Props = {
  /** Cities with live inventory and their counts. Server-supplied: never a dead search. */
  cities: readonly SearchCity[];
  /** Business-timezone today, from the server — not the visitor's clock. */
  today: string;
};

type Panel = "where" | "when" | "guests" | null;

export function HeroSearch({ cities, today }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState<Panel>(null);
  const [city, setCity] = useState("");
  const [date, setDate] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [capacity, setCapacity] = useState("");

  const formRef = useRef<HTMLFormElement>(null);
  const triggers = useRef<Record<Exclude<Panel, null>, HTMLButtonElement | null>>({
    where: null,
    when: null,
    guests: null,
  });
  const panelRef = useRef<HTMLDivElement>(null);
  const ids = useId();

  // Close on Escape or a click outside, handing focus back to the trigger.
  useEffect(() => {
    if (!open) return;
    const current = open;
    const close = (refocus: boolean) => {
      setOpen(null);
      if (refocus) triggers.current[current]?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const onDown = (e: MouseEvent) => {
      if (!formRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    // Move focus into the panel so a keyboard user lands on the choices.
    // The marked choice first (the selected city, the calendar's current day),
    // else the first enabled button. Two queries, not one selector list: a
    // selector list returns the first match in DOM order, which in the date
    // panel was the "Next month" arrow.
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      (
        panel?.querySelector<HTMLElement>("[data-autofocus]") ??
        panel?.querySelector<HTMLElement>("button:not([disabled])")
      )?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const toggle = (panel: Exclude<Panel, null>) => setOpen((o) => (o === panel ? null : panel));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setOpen(null);
    const href = buildHallSearchHref({ city, date, dateTo, capacity });
    startTransition(() => router.push(href));
  }

  const dateLabel = formatDateChoice(date, dateTo);
  const thisWeekend = weekendRange(today, "this");
  const nextWeekend = weekendRange(today, "next");
  const cityCount = (n: number) => (n === 1 ? "1 hall" : `${n} halls`);

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      role="search"
      aria-label="Search wedding halls"
      className="relative w-full max-w-4xl"
    >
      {/* ── Panels ─────────────────────────────────────────────────────────── */}
      {open && (
        <div
          ref={panelRef}
          id={`${ids}-${open}`}
          role="dialog"
          aria-label={open === "where" ? "Choose a city" : open === "when" ? "Choose dates" : "Choose guest count"}
          className={cn(
            "absolute bottom-full z-30 mb-3 rounded-3xl bg-white p-5 shadow-[0_24px_60px_-16px_rgba(26,22,20,0.45)] ring-1 ring-black/5",
            open === "where" && "left-0 w-80",
            open === "when" && "left-1/2 w-[640px] -translate-x-1/2",
            open === "guests" && "right-0 w-80",
          )}
        >
          {open === "where" && (
            <ul className="space-y-1" role="list">
              {[{ city: "", venueCount: 0 }, ...cities].map((c) => {
                const selected = city === c.city;
                return (
                  <li key={c.city || "any"}>
                    <button
                      type="button"
                      data-autofocus={selected ? "" : undefined}
                      onClick={() => {
                        setCity(c.city);
                        setOpen("when");
                      }}
                      aria-pressed={selected}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors",
                        "hover:bg-charcoal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-600",
                        selected && "bg-maroon-50",
                      )}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ivory-200 text-maroon-600">
                        <MapPin className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-charcoal-900">
                          {c.city || "Any city"}
                        </span>
                        <span className="block text-xs text-charcoal-600">
                          {c.city ? cityCount(c.venueCount) : "Everywhere in Tamil Nadu"}
                        </span>
                      </span>
                      {selected && <Check className="h-4 w-4 text-maroon-600" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {open === "when" && (
            <div>
              <DateRangeCalendar
                today={today}
                from={date}
                to={dateTo}
                onChange={(f, t) => {
                  setDate(f);
                  setDateTo(t);
                }}
              />
              <div className="mt-4 flex items-center gap-2 border-t border-charcoal-100 pt-4">
                {[
                  { label: "This weekend", range: thisWeekend },
                  { label: "Next weekend", range: nextWeekend },
                ].map(({ label, range }) => {
                  const active = date === range.date && (dateTo || range.date) === range.dateTo;
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setDate(range.date);
                        setDateTo(range.dateTo > range.date ? range.dateTo : "");
                      }}
                      className={cn(
                        "rounded-full px-4 py-2 text-sm font-medium ring-1 transition-colors",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-600",
                        active
                          ? "bg-maroon-600 text-white ring-maroon-600"
                          : "bg-white text-charcoal-800 ring-charcoal-200 hover:ring-charcoal-400",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
                <span className="flex-1" />
                {date && (
                  <button
                    type="button"
                    onClick={() => {
                      setDate("");
                      setDateTo("");
                    }}
                    className="rounded-full px-3 py-2 text-sm font-semibold text-charcoal-700 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-600"
                  >
                    Clear dates
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen("guests")}
                  className="rounded-full bg-charcoal-900 px-5 py-2 text-sm font-semibold text-white hover:bg-charcoal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-600 focus-visible:ring-offset-2"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {open === "guests" && (
            <div>
              <p className="text-sm font-semibold text-charcoal-900">How many guests?</p>
              <p className="mt-0.5 text-xs text-charcoal-600">Shows halls that can hold at least this many.</p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {["", ...GUEST_PRESETS].map((g) => {
                  const selected = capacity === g;
                  return (
                    <button
                      key={g || "any"}
                      type="button"
                      data-autofocus={selected ? "" : undefined}
                      aria-pressed={selected}
                      onClick={() => {
                        setCapacity(g);
                        setOpen(null);
                        triggers.current.guests?.focus();
                      }}
                      className={cn(
                        "min-h-11 rounded-2xl px-2 text-sm font-semibold ring-1 transition-colors",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-600",
                        selected
                          ? "bg-maroon-600 text-white ring-maroon-600"
                          : "bg-white text-charcoal-800 ring-charcoal-200 hover:ring-charcoal-400",
                      )}
                    >
                      {g ? `${g}+` : "Any"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── The pill ───────────────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex items-center rounded-full p-2 shadow-[0_18px_50px_-12px_rgba(26,22,20,0.45)] ring-1 ring-black/5 transition-colors",
          // While a panel is open the pill dims and the active segment lifts,
          // so it is obvious which question is being answered.
          open ? "bg-charcoal-100" : "bg-white",
        )}
      >
        <Segment
          label="Where"
          value={city || null}
          placeholder="Any city"
          Icon={MapPin}
          active={open === "where"}
          controls={`${ids}-where`}
          onClick={() => toggle("where")}
          buttonRef={(el) => {
            triggers.current.where = el;
          }}
        />
        <Divider hidden={open === "where" || open === "when"} />
        <Segment
          label="When"
          value={dateLabel}
          placeholder="Add dates"
          Icon={CalendarDays}
          active={open === "when"}
          controls={`${ids}-when`}
          onClick={() => toggle("when")}
          buttonRef={(el) => {
            triggers.current.when = el;
          }}
        />
        <Divider hidden={open === "when" || open === "guests"} />
        <Segment
          label="Guests"
          value={capacity ? `${capacity}+ guests` : null}
          placeholder="Add guests"
          Icon={Users}
          active={open === "guests"}
          controls={`${ids}-guests`}
          onClick={() => toggle("guests")}
          buttonRef={(el) => {
            triggers.current.guests = el;
          }}
        />

        <button
          type="submit"
          disabled={isPending}
          className={cn(
            // 56px tall — comfortably past the 44px touch-target floor.
            "ml-2 flex h-14 shrink-0 items-center gap-2 rounded-full bg-maroon-600 px-6 text-sm font-semibold text-white",
            "shadow-sm transition hover:bg-maroon-700 active:scale-[0.98] motion-reduce:active:scale-100",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-600 focus-visible:ring-offset-2",
            "disabled:opacity-70",
          )}
        >
          {isPending ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
          ) : (
            <Search className="h-5 w-5" aria-hidden />
          )}
          Search
        </button>
      </div>
    </form>
  );
}

function Segment({
  label,
  value,
  placeholder,
  Icon,
  active,
  controls,
  onClick,
  buttonRef,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  active: boolean;
  controls: string;
  onClick: () => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-expanded={active}
      aria-controls={active ? controls : undefined}
      aria-haspopup="dialog"
      className={cn(
        "group flex min-w-0 flex-1 items-center gap-3 rounded-full px-5 py-2 text-left transition",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-600",
        active ? "bg-white shadow-card" : "hover:bg-charcoal-50",
      )}
    >
      <Icon className="h-5 w-5 shrink-0 text-maroon-600" aria-hidden />
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-charcoal-600">{label}</span>{" "}
        {/* charcoal-600, not -400: the old "Any" placeholder was #918A86 on
            white, about 3.4:1 — below the 4.5 bar for 14px text. */}
        <span className={cn("block truncate text-sm", value ? "font-semibold text-charcoal-900" : "text-charcoal-600")}>
          {value ?? placeholder}
        </span>
      </span>
    </button>
  );
}

function Divider({ hidden }: { hidden: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("h-8 w-px shrink-0 bg-charcoal-200 transition-opacity", hidden && "opacity-0")}
    />
  );
}
