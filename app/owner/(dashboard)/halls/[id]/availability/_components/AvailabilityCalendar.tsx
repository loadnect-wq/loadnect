"use client";

import { useState, useTransition } from "react";
import { type AvailabilityEntry } from "@/lib/owner";
import { setAvailability } from "@/app/owner/(dashboard)/actions";

const SLOT_LABELS: Record<string, string> = {
  full_day: "Full Day",
  morning:  "Morning",
  evening:  "Evening",
};

const STATUS_OPTIONS = [
  { value: "available",        label: "Available",      color: "bg-green-100 text-green-800 border-green-300"  },
  { value: "morning_booked",   label: "AM Booked",      color: "bg-amber-100 text-amber-800 border-amber-300"  },
  { value: "evening_booked",   label: "PM Booked",      color: "bg-orange-100 text-orange-800 border-orange-300" },
  { value: "partially_booked", label: "Partially Booked", color: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  { value: "full_day_booked",  label: "Full Day Booked",  color: "bg-rose-100 text-rose-800 border-rose-300"     },
  { value: "booked",           label: "Booked",         color: "bg-red-100 text-red-800 border-red-300"        },
  { value: "blocked",          label: "Blocked",        color: "bg-red-200 text-red-900 border-red-400"        },
  { value: "maintenance",      label: "Maintenance",    color: "bg-slate-100 text-slate-800 border-slate-300"  },
];

type EntryKey = `${string}::${string}`; // "YYYY-MM-DD::slot"

function buildInitialMap(entries: AvailabilityEntry[]): Map<EntryKey, string> {
  const map = new Map<EntryKey, string>();
  for (const e of entries) {
    map.set(`${e.date}::${e.slot}` as EntryKey, e.status);
  }
  return map;
}

interface Props {
  hallId:  string;
  days:    { iso: string; label: string; wkd: string }[];
  slots:   string[];
  initial: AvailabilityEntry[];
}

export function AvailabilityCalendar({ hallId, days, slots, initial }: Props) {
  const [statusMap, setStatusMap] = useState(() => buildInitialMap(initial));
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function getStatus(date: string, slot: string): string {
    return statusMap.get(`${date}::${slot}` as EntryKey) ?? "available";
  }

  function cycleStatus(date: string, slot: string) {
    const current = getStatus(date, slot);
    const idx     = STATUS_OPTIONS.findIndex((o) => o.value === current);
    const next    = STATUS_OPTIONS[(idx + 1) % STATUS_OPTIONS.length].value;
    setStatusMap((prev) => {
      const next_ = new Map(prev);
      next_.set(`${date}::${slot}` as EntryKey, next);
      return next_;
    });
    setSaved(false);
  }

  function handleSave() {
    setError(null);
    setSaved(false);
    const entries: { date: string; slot: string; status: string }[] = [];
    for (const [key, status] of statusMap.entries()) {
      const [date, slot] = key.split("::");
      entries.push({ date, slot, status });
    }
    startTransition(async () => {
      const result = await setAvailability(hallId, entries);
      if ("error" in result) {
        setError(result.error);
      } else {
        setSaved(true);
      }
    });
  }

  const statusConfig = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o]));

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <span key={opt.value} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${opt.color}`}>
            {opt.label}
          </span>
        ))}
        <span className="text-[11px] text-charcoal-500 self-center ml-1">· Tap a cell to cycle status</span>
      </div>

      {/* Calendar table */}
      <div className="overflow-x-auto rounded-2xl bg-white shadow-card">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-charcoal-500 sticky left-0 bg-white z-10">
                Date
              </th>
              {slots.map((s) => (
                <th key={s} className="px-2 py-2 text-center text-[11px] font-semibold text-charcoal-500 whitespace-nowrap">
                  {SLOT_LABELS[s] ?? s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map(({ iso, label, wkd }) => (
              <tr key={iso} className="border-b border-border last:border-0 hover:bg-ivory-50">
                <td className="px-3 py-2 sticky left-0 bg-white z-10 whitespace-nowrap">
                  <span className="font-semibold text-charcoal-900">{label}</span>
                  <span className="ml-1 text-charcoal-400">{wkd}</span>
                </td>
                {slots.map((slot) => {
                  const st  = getStatus(iso, slot);
                  const cfg = statusConfig[st] ?? STATUS_OPTIONS[0];
                  return (
                    <td key={slot} className="px-2 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => cycleStatus(iso, slot)}
                        className={`inline-flex min-w-[80px] items-center justify-center rounded-lg border px-2 py-1 text-[10px] font-semibold transition-opacity hover:opacity-80 ${cfg.color}`}
                      >
                        {cfg.label}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="rounded-xl bg-maroon-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-maroon-800 disabled:opacity-60 transition-colors"
        >
          {pending ? "Saving…" : "Save Availability"}
        </button>
        {saved && <span className="text-sm font-medium text-green-700">✓ Saved</span>}
      </div>
    </div>
  );
}
