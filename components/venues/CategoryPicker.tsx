"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/venues/CategoryPicker.tsx — "What is this hall suitable for?"
//
// A grouped multi-select over public.venue_categories. Used by the owner's hall
// form and by the admin's draft form, so an admin recording a venue on an
// owner's behalf ticks exactly the same boxes the owner would.
//
// WHY THIS IS NOT THE OLD FOUR BUTTONS WITH A LONGER LIST. Four fit in one row
// and needed no structure. Twenty-eight do not: an ungrouped grid of 28
// identical chips is a wall, and the owner of a wedding hall has to read all of
// it to find the three that apply. So:
//
//   * GROUPED under the four headings, with the celebrations group first —
//     that is where the great majority of Hallnect's inventory lives, and it
//     contains the four categories every existing hall already has.
//   * FILTERABLE. Typing narrows across every group at once; the headings of
//     emptied groups disappear rather than sitting there empty.
//   * SELECTION IS ALWAYS VISIBLE, above the filter, so ticking something in
//     "Corporate" and then filtering for "birthday" does not make the owner
//     wonder whether the first one survived. Removing from that summary is
//     also how you undo a choice you can no longer see.
//
// SELECTIONS THE CATALOGUE NO LONGER OFFERS ARE KEPT. If an admin deactivates a
// category, halls that already declared it keep it (migration 0102 lets them),
// and this component must not be the thing that silently drops it the next time
// the owner edits an unrelated field. Such a value shows in the summary, marked,
// and can be removed — but nothing removes it for them.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";

import {
  groupCategories,
  selectCategories,
  type VenueCategory,
} from "@/lib/venue-categories";
import { CategoryIcon } from "@/components/venues/CategoryIcon";
import { cn } from "@/lib/utils";

type Props = {
  /** Active categories, in catalogue order. */
  catalogue: VenueCategory[];
  /** Currently selected slugs. */
  value:     string[];
  onChange:  (next: string[]) => void;
  /** Rendered under the grid when nothing is selected. */
  emptyHint?: string;
  disabled?: boolean;
};

export function CategoryPicker({ catalogue, value, onChange, emptyHint, disabled }: Props) {
  const [query, setQuery] = useState("");

  const selected = useMemo(() => new Set(value), [value]);

  // In catalogue order, not click order — so the summary does not reshuffle
  // itself as the owner works.
  const selectedCategories = useMemo(
    () => selectCategories(value, catalogue),
    [value, catalogue],
  );

  // Slugs the hall holds that the catalogue no longer offers. See the header.
  const retained = useMemo(() => {
    const known = new Set(catalogue.map((c) => c.slug));
    return value.filter((slug) => !known.has(slug));
  }, [value, catalogue]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? catalogue.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.pluralNoun.toLowerCase().includes(q) ||
            (c.description ?? "").toLowerCase().includes(q),
        )
      : catalogue;
    return groupCategories(matches);
  }, [catalogue, query]);

  function toggle(slug: string) {
    if (disabled) return;
    onChange(selected.has(slug) ? value.filter((s) => s !== slug) : [...value, slug]);
  }

  // The catalogue failing to load is NOT the same as an owner having no
  // options, and this component must not let a form save over the difference.
  // The owner's existing selections are still listed below so they can see
  // what the listing holds; there is simply nothing to add right now.
  if (catalogue.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-xs text-amber-800">
          The list of event types could not be loaded. Your existing choices are unchanged —
          please refresh before editing them.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── What is currently ticked ─────────────────────────────────── */}
      {(selectedCategories.length > 0 || retained.length > 0) && (
        <ul className="flex flex-wrap gap-2" aria-label="Selected event types">
          {selectedCategories.map((c) => (
            <li key={c.slug}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggle(c.slug)}
                className="flex min-h-[36px] items-center gap-1.5 rounded-full bg-maroon-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-maroon-700 disabled:opacity-60"
              >
                {c.name}
                <X className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">Remove {c.name}</span>
              </button>
            </li>
          ))}
          {retained.map((slug) => (
            <li key={slug}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggle(slug)}
                title="No longer offered — you can keep it or remove it"
                className="flex min-h-[36px] items-center gap-1.5 rounded-full border border-charcoal-300 bg-charcoal-100 px-3 py-1.5 text-xs font-semibold text-charcoal-700 disabled:opacity-60"
              >
                {slug}
                <X className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">Remove {slug}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ── Filter ───────────────────────────────────────────────────── */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal-400" aria-hidden />
        <input
          type="search"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search event types…"
          aria-label="Search event types"
          className="min-h-[44px] w-full rounded-xl border border-border bg-white pl-9 pr-3 text-sm text-charcoal-800 placeholder:text-charcoal-400 focus:border-maroon-400 focus:outline-none focus:ring-2 focus:ring-maroon-100"
        />
      </div>

      {/* ── The grid ─────────────────────────────────────────────────── */}
      {groups.length === 0 ? (
        <p className="py-3 text-center text-xs text-charcoal-500">
          No event type matches “{query.trim()}”.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.group}>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
                {g.label}
              </h4>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {g.categories.map((c) => {
                  const on = selected.has(c.slug);
                  return (
                    <button
                      key={c.slug}
                      type="button"
                      disabled={disabled}
                      // aria-pressed, not a visual-only state: "selected" is
                      // otherwise carried by background colour alone, which a
                      // screen reader cannot see and a colour-blind owner may
                      // not distinguish. Same pattern as the inventory
                      // calendar's slot chips.
                      aria-pressed={on}
                      onClick={() => toggle(c.slug)}
                      title={c.description ?? undefined}
                      className={cn(
                        "flex min-h-[44px] items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors disabled:opacity-60",
                        on
                          ? "border-maroon-500 bg-maroon-50 text-maroon-800"
                          : "border-border bg-white text-charcoal-700 hover:border-maroon-300",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                          on ? "bg-maroon-600 text-white" : "bg-maroon-50 text-maroon-600",
                        )}
                      >
                        {on ? <Check className="h-4 w-4" aria-hidden /> : <CategoryIcon name={c.icon} className="h-4 w-4" />}
                      </span>
                      <span className="leading-tight">{c.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {value.length === 0 && emptyHint && (
        <p className="text-xs font-medium text-amber-700">{emptyHint}</p>
      )}
    </div>
  );
}
