"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/sections/DateRangeCalendar.tsx — pick one day or a range, across
// two months side by side.
//
// Replaces the two native date inputs in the hero search, which rendered as
// "dd-mm-yyyy" with a browser calendar icon: unstyled, two separate fields for
// one question, and no sense of the range between them.
//
// PICKING. First tap sets the start. Second tap on a later day sets the end;
// on an earlier day it starts again from there. Tapping the start again after
// a range is set starts a fresh choice. Past days are disabled — /halls
// searches availability from today.
//
// KEYBOARD. One day is focusable at a time (roving tabindex). Arrows move a day
// or a week, Home/End jump to the week's edges, PageUp/PageDown move a month,
// Enter/Space pick. The view follows focus into the next or previous month.
//
// SCREEN READERS. Every day announces its full date and whether it is the
// start, the end, or inside the chosen range.
//
// ONE MONTH ON A PHONE. `months={1}` shows a single month with 44px days, for
// the mobile search sheet, where two months side by side cannot fit.
//
// All dates are YYYY-MM-DD strings handled in UTC — see lib/search-url.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { addDays, formatFull, formatMonth, monthGrid, shiftMonth } from "@/lib/search-url";

type Props = {
  /** Business-timezone today, from the server. Earlier days are disabled. */
  today: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** 2 side by side on desktop; 1 with larger days on a phone. */
  months?: 1 | 2;
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function ym(iso: string): [number, number] {
  const [y, m] = iso.split("-").map(Number);
  return [y, m];
}

export function DateRangeCalendar({ today, from, to, onChange, months = 2 }: Props) {
  const [view, setView] = useState<[number, number]>(() => ym(from || today));
  const [focusDay, setFocusDay] = useState<string>(from || today);
  const [hover, setHover] = useState<string>("");

  const second = shiftMonth(view[0], view[1], 1);
  const earliestView = ym(today);

  // The day that takes Tab. If the remembered day has been paged out of view
  // (the month arrows), fall back to the first selectable day on screen —
  // otherwise no visible day would be reachable from the keyboard at all.
  const monthOf = (iso: string) => iso.slice(0, 7);
  const viewKeys = [
    `${view[0]}-${String(view[1]).padStart(2, "0")}`,
    ...(months === 2 ? [`${second[0]}-${String(second[1]).padStart(2, "0")}`] : []),
  ];
  const firstOfView = `${viewKeys[0]}-01`;
  const tabDay = viewKeys.includes(monthOf(focusDay))
    ? focusDay
    : firstOfView < today
      ? today
      : firstOfView;
  const canGoBack = view[0] > earliestView[0] || (view[0] === earliestView[0] && view[1] > earliestView[1]);

  const pick = (day: string) => {
    if (day < today) return;
    if (!from || to || day < from) onChange(day, "");
    else if (day === from) onChange(day, "");
    else onChange(from, day);
    setFocusDay(day);
  };

  // DOM focus moves only after a keyboard move, never on mount or a click:
  // opening the calendar should not steal focus from the pill's own flow.
  // Keydown is a discrete event, so React has committed the new month by the
  // next frame and the target day exists to receive focus.
  const moveFocus = (day: string, from: HTMLElement) => {
    const target = day < today ? today : day;
    const [ty, tm] = ym(target);
    const inFirst = ty === view[0] && tm === view[1];
    const inSecond = months === 2 && ty === second[0] && tm === second[1];
    // Off screen: before the view, show the target's month first; after it,
    // show the target's month second.
    if (!inFirst && !inSecond) {
      setView(target < firstOfView || months === 1 ? [ty, tm] : shiftMonth(ty, tm, -1));
    }
    setFocusDay(target);
    const root = from.closest("[data-calendar]");
    requestAnimationFrame(() => {
      root?.querySelector<HTMLButtonElement>(`[data-day="${target}"]`)?.focus();
    });
  };

  const onKey = (e: React.KeyboardEvent, day: string) => {
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(day, -1),
      ArrowRight: () => addDays(day, 1),
      ArrowUp: () => addDays(day, -7),
      ArrowDown: () => addDays(day, 7),
      Home: () => addDays(day, -dow),
      End: () => addDays(day, 6 - dow),
      PageUp: () => addDays(day, -30),
      PageDown: () => addDays(day, 30),
    };
    if (moves[e.key]) {
      e.preventDefault();
      moveFocus(moves[e.key](), e.currentTarget as HTMLElement);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(day);
    }
  };

  // While a start is chosen and the end is not, hovering previews the range.
  const rangeEnd = to || (from && hover > from ? hover : "");

  const renderMonth = (year: number, month: number) => (
    <div className="min-w-0">
      <p className="mb-4 text-center text-sm font-semibold text-charcoal-900">{formatMonth(year, month)}</p>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
        {WEEKDAYS.map((d) => (
          <span key={d} aria-hidden className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {monthGrid(year, month).flat().map((day, i) => {
          if (!day) return <span key={`e${i}`} aria-hidden />;
          const past = day < today;
          const isStart = day === from;
          const isEnd = day === to;
          const inRange = !!from && !!rangeEnd && day > from && day < rangeEnd;
          const isPreviewEnd = !to && day === rangeEnd && day !== from;
          const state = isStart ? ", start date" : isEnd ? ", end date" : inRange ? ", in your dates" : "";
          return (
            <div
              key={day}
              className={cn(
                "flex justify-center",
                inRange && "bg-maroon-50",
                (isStart && rangeEnd) && "rounded-l-full bg-gradient-to-r from-transparent from-50% to-maroon-50 to-50%",
                (isEnd || isPreviewEnd) && "rounded-r-full bg-gradient-to-l from-transparent from-50% to-maroon-50 to-50%",
              )}
            >
              <button
                type="button"
                data-day={day}
                disabled={past}
                tabIndex={day === tabDay ? 0 : -1}
                data-autofocus={day === tabDay ? "" : undefined}
                aria-pressed={isStart || isEnd}
                aria-label={`${formatFull(day)}${state}${day === today ? ", today" : ""}`}
                onClick={() => pick(day)}
                onMouseEnter={() => setHover(day)}
                onKeyDown={(e) => onKey(e, day)}
                className={cn(
                  "relative flex items-center justify-center rounded-full text-sm tabular-nums transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-600 focus-visible:ring-offset-1",
                  months === 1 ? "h-11 w-11" : "h-10 w-10",
                  past && "cursor-not-allowed text-charcoal-300",
                  !past && !isStart && !isEnd && "text-charcoal-900 hover:bg-charcoal-100",
                  (isStart || isEnd) && "bg-maroon-600 font-semibold text-white",
                  isPreviewEnd && "ring-2 ring-inset ring-maroon-600",
                  day === today && !isStart && !isEnd && "font-semibold underline decoration-maroon-600 decoration-2 underline-offset-4",
                )}
              >
                {Number(day.slice(8))}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div data-calendar="" onMouseLeave={() => setHover("")}>
      <div className="relative">
        <button
          type="button"
          aria-label="Previous month"
          disabled={!canGoBack}
          onClick={() => setView(shiftMonth(view[0], view[1], -1))}
          className="absolute left-0 top-[-10px] flex h-11 w-11 items-center justify-center rounded-full text-charcoal-700 hover:bg-charcoal-100 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setView(shiftMonth(view[0], view[1], 1))}
          className="absolute right-0 top-[-10px] flex h-11 w-11 items-center justify-center rounded-full text-charcoal-700 hover:bg-charcoal-100"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <div className={cn("grid gap-8", months === 2 && "grid-cols-2")}>
          {renderMonth(view[0], view[1])}
          {months === 2 && renderMonth(second[0], second[1])}
        </div>
      </div>
    </div>
  );
}
