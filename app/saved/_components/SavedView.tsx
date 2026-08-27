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

// Saved hall ids live in localStorage (saving needs no account); the listings
// themselves are fetched fresh from the server, so a saved hall that was since
// suspended or delisted simply drops out instead of rendering stale data.
// (This view previously mapped ids over MOCK_HALLS — an intentionally empty
// array — so nothing a visitor saved could ever appear here.)
export function SavedView() {
  const { ids } = useSavedHalls();
  const [halls, setHalls] = useState<HallListing[] | null>(null); // null = loading
  const [advancePercent, setAdvancePercent] = useState<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (ids.length === 0) { setHalls([]); return; }
    fetchSavedHalls(ids)
      .then((r) => {
        if (cancelled) return;
        setHalls(r.halls);
        setAdvancePercent(r.advancePercent);
      })
      .catch(() => { if (!cancelled) setHalls([]); });
    return () => { cancelled = true; };
  }, [ids]);

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
          {halls.map((h) => (
            <HallCard key={h.id} hall={h} advancePercent={advancePercent} />
          ))}
        </div>
      )}
    </section>
  );
}
