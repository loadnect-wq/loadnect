"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { MapPin, Search, Users, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CAPACITY_OPTIONS, CITIES } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface HallSearchBarProps {
  defaultCity?: string;
  defaultCapacity?: string;
  defaultQuery?: string;
}

const selectClass = cn(
  "h-10 w-full appearance-none rounded-lg border border-input bg-background",
  "pl-9 pr-3 text-sm text-foreground",
  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
  "transition-colors cursor-pointer"
);

export function HallSearchBar({
  defaultCity     = "",
  defaultCapacity = "",
  defaultQuery    = "",
}: HallSearchBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const hasFilters = !!(
    searchParams.get("city") ||
    searchParams.get("capacity") ||
    searchParams.get("q")
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();

    const city     = (fd.get("city")     as string) || "";
    const capacity = (fd.get("capacity") as string) || "";
    const q        = (fd.get("q")        as string) || "";

    if (city)     params.set("city",     city);
    if (capacity) params.set("capacity", capacity);
    if (q)        params.set("q",        q);

    startTransition(() => {
      const qs = params.toString();
      router.push(`/halls${qs ? `?${qs}` : ""}`);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2"
    >
      {/* Keyword */}
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="text"
          name="q"
          defaultValue={defaultQuery}
          placeholder="Search by name or city…"
          className={cn(
            "h-10 w-full rounded-lg border border-input bg-background",
            "pl-9 pr-4 text-sm placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors"
          )}
        />
      </div>

      {/* City */}
      <div className="relative sm:w-44">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <select name="city" defaultValue={defaultCity} className={selectClass}>
          <option value="">All Cities</option>
          {CITIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Capacity */}
      <div className="relative sm:w-44">
        <Users className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <select name="capacity" defaultValue={defaultCapacity} className={selectClass}>
          <option value="">Any Capacity</option>
          {CAPACITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <Button type="submit" variant="default" isLoading={isPending} className="shrink-0">
        Search
      </Button>

      {hasFilters && (
        <button
          type="button"
          onClick={() => startTransition(() => router.push("/halls"))}
          className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Clear filters"
        >
          <X className="h-4 w-4" />
          Clear
        </button>
      )}
    </form>
  );
}
