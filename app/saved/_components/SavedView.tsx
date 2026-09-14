"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { useSavedHalls } from "@/lib/hooks/useSavedHalls";
import { type HallListing } from "@/lib/halls";
import { HallCard } from "@/app/halls/_components/HallCard";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { fetchSavedHalls } from "../actions";

type Fetched = { halls: HallListing[]; advancePercent: number | undefined };

/** Stable identity, so the empty branch never looks like a new array. */
const EMPTY_HALLS: HallListing[] = [];

// Saved hall ids live in localStorage (saving needs no account); the listings
// themselves are fetched fresh from the server, so a saved hall that was since
// suspended or delisted simply drops out instead of rendering stale data.
// (This view previously mapped ids over MOCK_HALLS — an intentionally empty
// array — so nothing a visitor saved could ever appear here.)
export function SavedView() {
  const { ids } = useSavedHalls();
  const [fetched, setFetched] = useState<Fetched | null>(null); // null = not loaded yet

  useEffect(() => {
    // The empty case is DERIVED below rather than written into state here. An
    // effect that immediately calls setState is a second render for a value
    // that was already knowable during the first one.
    if (ids.length === 0) return;
    let cancelled = false;
    fetchSavedHalls(ids)
      .then((r) => { if (!cancelled) setFetched({ halls: r.halls, advancePercent: r.advancePercent }); })
      .catch(() => { if (!cancelled) setFetched({ halls: [], advancePercent: undefined }); });
    return () => { cancelled = true; };
  }, [ids]);

  // Nothing saved is not a loading state — render the empty view immediately.
  // Otherwise show what was fetched, INTERSECTED with what is still saved, so
  // un-hearting a card here removes it in the same commit instead of leaving it
  // on screen until the refetch lands.
  const halls: HallListing[] | null =
    ids.length === 0 ? EMPTY_HALLS
    : fetched === null ? null
    : fetched.halls.filter((h) => ids.includes(h.id));
  const advancePercent = fetched?.advancePercent;

  return (
    <section className="container-app py-5 lg:max-w-7xl">
      {halls === null ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: Math.min(ids.length, 6) || 3 }).map((_, i) => (
            <div key={i} className="h-72 animate-pulse rounded-2xl bg-charcoal-100" />
          ))}
        </div>
      ) : halls.length === 0 ? (
        <EmptyState
          icon={<Heart className="h-8 w-8" />}
          title="No saved halls yet"
          description="Tap the heart on any hall to save it for later."
          action={
            <Link href="/halls" className={buttonVariants({ variant: "gold", size: "sm" })}>
              Browse Halls
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {halls.map((h, i) => (
            <HallCard key={h.id} hall={h} advancePercent={advancePercent} revealIndex={i} revealNow={i < 3} />
          ))}
        </div>
      )}
    </section>
  );
}
