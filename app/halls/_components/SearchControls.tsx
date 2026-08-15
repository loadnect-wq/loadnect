"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDownUp, Filter, Search, X } from "lucide-react";
import { BottomSheet } from "@/components/app/BottomSheet";
import { Button } from "@/components/ui/Button";
import { CITIES, CAPACITY_OPTIONS } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

// ── Static configuration ──────────────────────────────────────────────────────

const QUICK_CHIPS = [
  { key: "premium", label: "✦ Premium"      },
  { key: "budget",  label: "Budget-friendly" },
  { key: "wedding", label: "Wedding"          },
  { key: "banquet", label: "Banquet"          },
  { key: "party",   label: "Party"            },
] as const;

const SORT_OPTIONS = [
  { value: "recommended", label: "Recommended"       },
  { value: "price-asc",   label: "Price: Low → High" },
  { value: "price-desc",  label: "Price: High → Low" },
  { value: "rating",      label: "Top Rated"          },
  { value: "capacity",    label: "Largest first"       },
] as const;

const FILTER_AMENITIES = [
  { slug: "air-conditioning",  label: "AC"            },
  { slug: "in-house-catering", label: "Catering"      },
  { slug: "free-parking",      label: "Free Parking"  },
  { slug: "valet-parking",     label: "Valet Parking" },
  { slug: "dj-music",          label: "DJ & Music"    },
  { slug: "outdoor-garden",    label: "Garden"        },
  { slug: "bridal-suite",      label: "Bridal Suite"  },
  { slug: "generator-backup",  label: "Generator"     },
  { slug: "in-house-decor",    label: "In-house Decor"},
  { slug: "av-stage-setup",    label: "AV / Stage"    },
] as const;

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  defaultCity:     string;
  defaultArea:     string;
  defaultCapacity: string;
  defaultPriceMin: string;
  defaultPriceMax: string;
  defaultQuery:    string;
  defaultCategory: string;
  defaultAmenity:  string;
  defaultDate:     string;
  defaultSort:     string;
  count:           number;
}

export function SearchControls({
  defaultCity, defaultArea, defaultCapacity,
  defaultPriceMin, defaultPriceMax,
  defaultQuery, defaultCategory, defaultAmenity,
  defaultDate, defaultSort, count,
}: Props) {
  const router      = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Local state for the filter sheet (committed on "Show results")
  const [q,        setQ]        = useState(defaultQuery);
  const [city,     setCity]     = useState(defaultCity);
  const [area,     setArea]     = useState(defaultArea);
  const [capacity, setCapacity] = useState(defaultCapacity);
  const [priceMin, setPriceMin] = useState(defaultPriceMin);
  const [priceMax, setPriceMax] = useState(defaultPriceMax);
  const [amenity,  setAmenity]  = useState(defaultAmenity);
  const [date,     setDate]     = useState(defaultDate);

  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen,   setSortOpen]   = useState(false);

  // Merge updates into current URL params and push
  function pushWith(updates: Record<string, string>) {
    const sp = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (v) sp.set(k, v); else sp.delete(k);
    });
    startTransition(() => router.push(`/halls?${sp.toString()}`));
  }

  function applyFilters() {
    setFilterOpen(false);
    pushWith({ city, area, capacity, priceMin, priceMax, amenity, date, q });
  }

  function clearAll() {
    setQ(""); setCity(""); setArea(""); setCapacity("");
    setPriceMin(""); setPriceMax(""); setAmenity(""); setDate("");
    startTransition(() => router.push("/halls"));
    setFilterOpen(false);
  }

  const activeChip      = defaultCategory;
  const activeSortLabel = SORT_OPTIONS.find((s) => s.value === defaultSort)?.label ?? "Recommended";

  // Count active filters for the filter button badge
  const activeFilterCount = [
    defaultCity, defaultArea, defaultCapacity,
    defaultPriceMin, defaultPriceMax, defaultAmenity, defaultDate,
  ].filter(Boolean).length;

  return (
    <div className="container-app py-3 lg:max-w-7xl">
      {/* ── Search bar ── */}
      <form
        onSubmit={(e) => { e.preventDefault(); pushWith({ q }); }}
        className="flex items-center gap-2"
      >
        <label className="flex h-11 flex-1 items-center gap-2 rounded-2xl border border-border bg-white px-3 shadow-sm focus-within:border-maroon-400">
          <Search className="h-4 w-4 shrink-0 text-charcoal-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search halls, cities, areas…"
            className="w-full bg-transparent text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:outline-none"
          />
          {q && (
            <button
              type="button"
              onClick={() => { setQ(""); pushWith({ q: "" }); }}
              aria-label="Clear search"
            >
              <X className="h-4 w-4 text-charcoal-400" />
            </button>
          )}
        </label>

        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          aria-label="Open filters"
          className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-white shadow-sm active:scale-95"
        >
          <Filter className="h-4 w-4 text-charcoal-700" />
          {activeFilterCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-maroon-600 text-[9px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </form>

      {/* ── Quick chips: sort + category ── */}
      <div className="no-scrollbar mt-3 overflow-x-auto">
        <div className="flex gap-2 pr-2">
          {/* Sort button */}
          <button
            type="button"
            onClick={() => setSortOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-semibold text-charcoal-800 shadow-sm"
          >
            <ArrowDownUp className="h-3 w-3" />
            {activeSortLabel}
          </button>

          {/* Category chips */}
          {QUICK_CHIPS.map((chip) => {
            const isActive = activeChip === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => pushWith({ category: isActive ? "" : chip.key })}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors",
                  isActive
                    ? "border-maroon-600 bg-maroon-600 text-white"
                    : "border-border bg-white text-charcoal-700",
                )}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-2 text-[11px] text-charcoal-500">
        {count} venue{count !== 1 ? "s" : ""} found
      </p>

      {/* ── Filter bottom sheet ── */}
      <BottomSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={clearAll}>
              Clear all
            </Button>
            <Button variant="gold" className="flex-1" onClick={applyFilters}>
              Show {count} results
            </Button>
          </div>
        }
      >
        <div className="space-y-6">

          {/* City */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">City</p>
            <div className="flex flex-wrap gap-2">
              {CITIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCity(city === c ? "" : c)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold",
                    city === c
                      ? "border-maroon-500 bg-maroon-50 text-maroon-700"
                      : "border-border bg-white text-charcoal-700",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Area */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Area / Locality</p>
            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="e.g. T. Nagar, Velachery, Koramangala"
              className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:border-maroon-400 focus:outline-none"
            />
          </div>

          {/* Capacity */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Minimum Guests</p>
            <div className="grid grid-cols-2 gap-2">
              {CAPACITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCapacity(capacity === opt.value ? "" : opt.value)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-sm",
                    capacity === opt.value
                      ? "border-maroon-500 bg-maroon-50 font-semibold text-maroon-700"
                      : "border-border bg-white text-charcoal-700",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Price range */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Price Range / Day</p>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-charcoal-500">₹</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={priceMin}
                  onChange={(e) => setPriceMin(e.target.value)}
                  placeholder="Min"
                  className="h-10 w-full rounded-xl border border-border bg-white pl-7 pr-3 text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:border-maroon-400 focus:outline-none"
                />
              </div>
              <span className="text-xs text-charcoal-400">to</span>
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-charcoal-500">₹</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={priceMax}
                  onChange={(e) => setPriceMax(e.target.value)}
                  placeholder="Max"
                  className="h-10 w-full rounded-xl border border-border bg-white pl-7 pr-3 text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:border-maroon-400 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Event date */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Event Date</p>
            <input
              type="date"
              value={date}
              min={new Date().toISOString().split("T")[0]}
              onChange={(e) => setDate(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm text-charcoal-900 focus:border-maroon-400 focus:outline-none"
            />
            {date && (
              <button
                type="button"
                onClick={() => setDate("")}
                className="mt-1 text-xs text-maroon-600"
              >
                Clear date
              </button>
            )}
          </div>

          {/* Amenities */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Must-Have Amenity</p>
            <div className="flex flex-wrap gap-2">
              {FILTER_AMENITIES.map((a) => (
                <button
                  key={a.slug}
                  type="button"
                  onClick={() => setAmenity(amenity === a.slug ? "" : a.slug)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold",
                    amenity === a.slug
                      ? "border-maroon-500 bg-maroon-50 text-maroon-700"
                      : "border-border bg-white text-charcoal-700",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

        </div>
      </BottomSheet>

      {/* ── Sort bottom sheet ── */}
      <BottomSheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort by">
        <ul className="space-y-1 pb-3">
          {SORT_OPTIONS.map((opt) => {
            const active = defaultSort === opt.value;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => {
                    setSortOpen(false);
                    pushWith({ sort: opt.value === "recommended" ? "" : opt.value });
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-3 py-3 text-sm",
                    active
                      ? "bg-maroon-50 font-semibold text-maroon-700"
                      : "text-charcoal-800 hover:bg-ivory-200",
                  )}
                >
                  {opt.label}
                  {active && <span className="h-2 w-2 rounded-full bg-maroon-600" />}
                </button>
              </li>
            );
          })}
        </ul>
      </BottomSheet>
    </div>
  );
}
