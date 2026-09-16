"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// The floating search pill.
//
// EVERY FIELD HERE IS REAL. That is not decoration — this codebase has already
// shipped one prominent dead control (the city picker wrote localStorage that
// nothing read), so a four-part search bar whose fourth part does nothing would
// be the same mistake in a nicer shape. The mapping is:
//
//   Location        -> ?city      exact match, and the options are the cities
//                                 that ACTUALLY hold inventory, not a hardcoded
//                                 list that offers empty searches
//   Available From  -> ?date      excludes halls fully blocked that day
//   Available Till  -> ?dateTo    makes it an inclusive RANGE; a hall blocked on
//                                 any day inside it is excluded
//   Guests          -> ?capacity  minimum capacity_max
//
// `dateTo` was added to lib/halls.ts for this — before it, a second date box
// would have been a lie.
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  /** Cities with live inventory. Server-supplied so we never offer a dead search. */
  cities: readonly string[];
  /** Today in the business timezone, from the server — a browser's own clock
   *  may be in another zone and would let someone pick "yesterday". */
  today: string;
};

/** One labelled cell of the pill. */
function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 flex-1 px-5 py-2", className)}>
      <label
        htmlFor={htmlFor}
        className="block text-[11px] font-semibold uppercase tracking-wider text-charcoal-500"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const CONTROL = cn(
  "w-full bg-transparent p-0 text-sm text-charcoal-900",
  "placeholder:text-charcoal-400",
  // The pill owns the visible focus ring; an inset ring on each cell would
  // fight the rounded edges. Focus is still obvious because the cell text is
  // the only thing that moves.
  "focus:outline-none focus:ring-0",
  "[color-scheme:light]",
);

export function HeroSearch({ cities, today }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // "Available Till" can never precede "Available From", so the second input's
  // own `min` tracks the first. Controlled for that reason alone.
  const [from, setFrom] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    const put = (key: string, value: FormDataEntryValue | null) => {
      const v = typeof value === "string" ? value.trim() : "";
      if (v) params.set(key, v);
    };
    put("city", fd.get("city"));
    put("date", fd.get("date"));
    // A range with no start is not a range — the availability query keys off
    // `date`, so sending dateTo alone would silently do nothing.
    if (params.has("date")) put("dateTo", fd.get("dateTo"));
    put("capacity", fd.get("capacity"));

    startTransition(() => {
      const qs = params.toString();
      router.push(`/halls${qs ? `?${qs}` : ""}`);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      aria-label="Search wedding halls"
      className={cn(
        "flex w-full max-w-4xl items-center gap-0 rounded-full bg-white",
        "p-2 pl-1 shadow-[0_18px_50px_-12px_rgba(26,22,20,0.35)]",
        "ring-1 ring-black/5",
        // Keyboard focus has to be visible on the pill as a whole, since the
        // individual cells deliberately have no ring of their own.
        "focus-within:ring-2 focus-within:ring-maroon-500",
      )}
    >
      <Field label="Location" htmlFor="hs-city">
        <select
          id="hs-city"
          name="city"
          defaultValue=""
          className={cn(CONTROL, "cursor-pointer appearance-none truncate")}
        >
          <option value="">Any city</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      <span aria-hidden className="h-8 w-px shrink-0 bg-charcoal-200" />

      <Field label="Available From" htmlFor="hs-from">
        <input
          id="hs-from"
          name="date"
          type="date"
          min={today}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={CONTROL}
        />
      </Field>

      <span aria-hidden className="h-8 w-px shrink-0 bg-charcoal-200" />

      <Field label="Available Till" htmlFor="hs-till">
        <input
          id="hs-till"
          name="dateTo"
          type="date"
          min={from || today}
          className={CONTROL}
        />
      </Field>

      <span aria-hidden className="h-8 w-px shrink-0 bg-charcoal-200" />

      <Field label="Guests" htmlFor="hs-guests" className="max-w-[9rem]">
        <input
          id="hs-guests"
          name="capacity"
          type="number"
          inputMode="numeric"
          min={1}
          step={10}
          placeholder="Any"
          className={CONTROL}
        />
      </Field>

      <button
        type="submit"
        disabled={isPending}
        aria-label="Search"
        className={cn(
          // 56px — comfortably past the 44px touch-target floor.
          "ml-1 flex h-14 w-14 shrink-0 items-center justify-center rounded-full",
          "bg-rose-600 text-white transition",
          "hover:bg-rose-700 active:scale-95 motion-reduce:active:scale-100",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2",
          "disabled:opacity-60",
        )}
      >
        {isPending ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : (
          <Search className="h-5 w-5" aria-hidden />
        )}
      </button>
    </form>
  );
}
