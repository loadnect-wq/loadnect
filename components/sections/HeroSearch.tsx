"use client";

import { useRouter } from "next/navigation";
import { useTransition, useRef } from "react";
import { MapPin, Search } from "lucide-react";
import { CITIES } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export function HeroSearch() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    const q    = (fd.get("q")    as string) || "";
    const city = (fd.get("city") as string) || "";
    if (q)    params.set("q",    q);
    if (city) params.set("city", city);
    startTransition(() => {
      const qs = params.toString();
      router.push(`/halls${qs ? `?${qs}` : ""}`);
    });
  }

  const inputBase = cn(
    "h-14 w-full bg-white text-sm text-charcoal-900 placeholder:text-charcoal-400",
    "focus:outline-none focus:ring-2 focus:ring-maroon-500 focus:ring-inset",
    "transition-shadow",
  );

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl shadow-elevated sm:flex-row"
      role="search"
      aria-label="Search wedding halls"
    >
      {/* Keyword */}
      <div className="relative flex-1 border-b border-border sm:border-b-0 sm:border-r">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-charcoal-400"
          aria-hidden
        />
        <input
          type="search"
          name="q"
          placeholder="Venue name or keyword…"
          className={cn(inputBase, "pl-12 pr-4")}
          autoComplete="off"
        />
      </div>

      {/* City */}
      <div className="relative sm:w-52 border-b border-border sm:border-b-0 sm:border-r">
        <MapPin
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-charcoal-400"
          aria-hidden
        />
        <select
          name="city"
          className={cn(inputBase, "cursor-pointer appearance-none pl-12 pr-4")}
          defaultValue=""
        >
          <option value="">Any City</option>
          {CITIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={isPending}
        className={cn(
          "flex h-14 shrink-0 items-center justify-center gap-2 px-8",
          "bg-gold-gradient font-semibold text-white text-sm",
          "transition-opacity hover:opacity-90 disabled:opacity-60",
          "sm:rounded-none",
        )}
      >
        {isPending ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : (
          <>
            <Search className="h-4 w-4" aria-hidden />
            Search
          </>
        )}
      </button>
    </form>
  );
}
