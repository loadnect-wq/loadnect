"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The way into /compare: from the saved list, or from a shortlist someone
// shared. Two or three halls compare in one tap; with more, the family ticks
// up to three. See lib/compare.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import Link from "next/link";
import { Columns3 } from "lucide-react";
import { MAX_COMPARE, MIN_COMPARE, compareCode, comparePath } from "@/lib/compare";

export function ComparePicker({ halls }: { halls: { id: string; name: string }[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  if (halls.length < MIN_COMPARE) return null;

  const direct = halls.length <= MAX_COMPARE;
  // Picked halls in the list's order, so the columns read the way the list does.
  const chosen = direct ? halls.map((h) => h.id) : halls.map((h) => h.id).filter((id) => picked.includes(id));
  const code = compareCode(chosen);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < MAX_COMPARE ? [...p, id] : p));

  return (
    <div className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
      <h2 className="flex items-center gap-2 text-base font-bold text-charcoal-900">
        <Columns3 className="h-4 w-4 text-maroon-700" aria-hidden /> Compare side by side
      </h2>
      <p className="mt-1 text-sm text-charcoal-700">
        {direct
          ? "Price, guests and amenities next to each other."
          : `Pick up to ${MAX_COMPARE} halls to see price, guests and amenities next to each other.`}
      </p>

      {!direct && (
        <fieldset className="mt-3">
          <legend className="sr-only">Halls to compare</legend>
          <ul className="divide-y divide-border">
            {halls.map((h) => {
              const on = picked.includes(h.id);
              const full = !on && picked.length >= MAX_COMPARE;
              return (
                <li key={h.id}>
                  <label className={`flex min-h-[44px] items-center gap-3 text-sm ${full ? "text-charcoal-400" : "text-charcoal-800"}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={full}
                      onChange={() => toggle(h.id)}
                      className="h-4 w-4 accent-maroon-700"
                    />
                    <span className="min-w-0 truncate">{h.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {code ? (
        <Link
          href={comparePath(code)}
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800"
        >
          {direct ? `Compare these ${chosen.length} halls` : `Compare ${chosen.length} halls`}
        </Link>
      ) : (
        <p className="mt-3 text-xs text-charcoal-600">Tick at least {MIN_COMPARE} halls.</p>
      )}
    </div>
  );
}
