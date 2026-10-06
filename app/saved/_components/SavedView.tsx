"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { useSavedHalls } from "@/lib/hooks/useSavedHalls";
import { type HallListing } from "@/lib/halls";
import { HallCard } from "@/app/halls/_components/HallCard";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { fetchSavedHalls } from "../actions";
import { ShareShortlist } from "@/components/shortlist/ShareShortlist";
import { MAX_SHORTLIST, encodeShortlist } from "@/lib/shortlist";
import { ComparePicker } from "@/components/compare/ComparePicker";

type Fetched = { halls: HallListing[]; advancePercent: number | undefined };

/** Stable identity, so the empty branch never looks like a new array. */
const EMPTY_HALLS: HallListing[] = [];

const subscribeToNothing = () => () => {};

// Saved hall ids live in localStorage (saving needs no account); the listings
// themselves are fetched fresh from the server, so a saved hall that was since
// suspended or delisted simply drops out instead of rendering stale data.
// (This view previously mapped ids over MOCK_HALLS — an intentionally empty
// array — so nothing a visitor saved could ever appear here.)
export function SavedView() {
  const { ids } = useSavedHalls();
  const [fetched, setFetched] = useState<Fetched | null>(null); // null = not loaded yet
  // THE SERVER CANNOT SEE THE LIST. It lives in this browser, so the server
  // render (and the first client render, which must match it) always has no
  // ids — and used to say "No saved halls yet" to someone with a full list,
  // for the moment before hydration. Until we are on the client the list is
  // unknown, which is the loading state, not the empty one.
  const onClient = useSyncExternalStore(subscribeToNothing, () => true, () => false);

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
    !onClient ? null
    : ids.length === 0 ? EMPTY_HALLS
    : fetched === null ? null
    : fetched.halls.filter((h) => ids.includes(h.id));
  const advancePercent = fetched?.advancePercent;

  // The share link carries the halls on screen — still listed — in the order
  // they were saved. A hall since delisted would only show up on a relative's
  // phone as "no longer listed".
  const shareIds = halls ? ids.filter((id) => halls.some((h) => h.id === id)) : [];
  const shareCode = encodeShortlist(shareIds);

  return (
    <section className="container-app py-5 lg:max-w-7xl">
      {/* The page had no heading: it opened straight onto the share card, so
          a visitor arriving from the heart had to work out where they were. */}
      <div className="mb-4">
        <h1 className="font-serif text-2xl font-bold text-charcoal-900">Your saved halls</h1>
        <p className="mt-1 text-sm text-charcoal-600">
          {halls === null
            ? "Loading your list…"
            : halls.length === 0
              ? "Kept on this device. No account needed."
              : `${halls.length} ${halls.length === 1 ? "hall" : "halls"}, kept on this device. No account needed.`}
        </p>
      </div>
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
        <>
          {shareCode && (
            <div className="mb-5 rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
              <h2 className="text-base font-bold text-charcoal-900">Deciding with family?</h2>
              <p className="mt-1 text-sm text-charcoal-700">
                Send this list to the family group. It opens on any phone, no app or sign-up needed.
                {shareIds.length > MAX_SHORTLIST && ` The link carries your first ${MAX_SHORTLIST} halls.`}
              </p>
              <div className="mt-3">
                <ShareShortlist code={shareCode} count={Math.min(shareIds.length, MAX_SHORTLIST)} />
              </div>
            </div>
          )}
          {shareIds.length > 1 && (
            <div className="mb-5">
              <ComparePicker
                halls={shareIds.map((id) => halls.find((h) => h.id === id)!).map((h) => ({ id: h.id, name: h.name }))}
              />
            </div>
          )}
          {/* The planner (0110) is where a chosen hall goes next. */}
          <Link
            href="/plan"
            className="mb-5 flex items-center justify-between gap-3 rounded-2xl bg-white p-4 text-sm shadow-card ring-1 ring-border hover:ring-maroon-200"
          >
            <span>
              <span className="block font-semibold text-charcoal-900">Planning the whole function?</span>
              <span className="block text-charcoal-700">Put the hall, food, decoration and budget on one board.</span>
            </span>
            <span className="shrink-0 font-semibold text-maroon-700">My plans</span>
          </Link>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {halls.map((h, i) => (
              <HallCard key={h.id} hall={h} advancePercent={advancePercent} revealIndex={i} revealNow={i < 3} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
