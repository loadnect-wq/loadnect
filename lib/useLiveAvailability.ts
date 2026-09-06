"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";

// ─────────────────────────────────────────────────────────────────────────────
// Keeps a hall's availability fresh while someone is looking at it.
//
// IT DOES NOT APPLY THE EVENT PAYLOAD. A realtime message is a TRIGGER TO
// RE-READ, never a source of truth: payloads arrive out of order, can be missed
// entirely while the socket is down, and carry only the row that changed rather
// than the derived per-day picture the calendar renders. So every event does one
// thing — router.refresh() — which re-runs the server component and returns the
// authoritative window. Slower than patching state, and correct.
//
// The same call handles reconnect. After a laptop wakes, a tunnel changes or the
// socket drops, whatever happened in the gap was never delivered; re-reading on
// SUBSCRIBED covers it without needing to know what was missed.
//
// AND IT IS NOT THE SAFETY MECHANISM. A customer whose screen is stale simply
// gets refused at checkout by assert_inventory_free, under a lock. This exists
// so that refusal is rare and the calendar feels alive — not so that the
// calendar can be trusted.
//
// SCOPE. Subscribed with a hall_id filter, so a visitor on one venue's page
// receives only that venue's changes and not the whole table. `availability`
// carries no personal data at all — the private half of an offline booking is
// in offline_bookings, which is not published.
//
// BOTH DIRECTIONS, ONE SUBSCRIPTION. The customer's booking page and the owner's
// calendar both use this hook, and both learn about each other through the same
// table, because `availability` is where every kind of claim lands:
//
//   owner blocks a date   → create_offline_booking inserts availability rows
//   customer pays         → blockAvailability() upserts availability rows
//   booking is cancelled  → releaseAvailabilityForBooking() deletes them
//
// So an owner watching their calendar sees a customer's booking appear without
// touching anything, and vice versa. Publishing `bookings` would have been the
// obvious way to carry the second case and a data leak: every subscriber would
// receive customer_id, contact_phone and the amounts on every change.
// ─────────────────────────────────────────────────────────────────────────────

/** Collapses a burst of changes (a 3-day block writes 3 rows) into one re-read. */
const REFRESH_DEBOUNCE_MS = 400;

/**
 * A re-read floor, independent of the socket delivering anything.
 *
 * THIS ONCE COVERED A REAL DEFECT, AND NO LONGER HAS TO. Subscribed from a real
 * browser against production, an anonymous client received DELETEs but NOT
 * INSERTs — even with no filter. Supabase evaluates the SELECT policy against
 * the candidate row before delivering an insert, and `availability_select` was a
 * correlated subquery into `halls` plus two SECURITY DEFINER calls; that does
 * not survive Realtime's evaluation context, so the row was dropped. Exactly the
 * wrong half worked: a RELEASED date appeared, a newly BLOCKED one did not.
 *
 * Migration 0062 made the policy row-local (`is_public`, denormalised from
 * halls.status by trigger) and INSERT, UPDATE and DELETE were then all measured
 * arriving. The poll is kept anyway, at a much cheaper price than the defect it
 * used to paper over: sockets still drop, phones still suspend them, and a
 * sixty-second floor makes convergence independent of the transport rather than
 * dependent on someone else's evaluator continuing to behave.
 */
const POLL_MS = 60_000;

export type LiveAvailabilityState = {
  /** False while the socket is down — the UI can say "reconnecting" if it wants. */
  live: boolean;
};

export function useLiveAvailability(hallId: string | null | undefined): LiveAvailabilityState {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hallId) return;

    let cancelled = false;
    let supabase: ReturnType<typeof getSupabaseClient>;
    try {
      supabase = getSupabaseClient();
    } catch {
      // No browser client configured. The page still works; it just will not
      // update on its own, and checkout still refuses a taken date.
      return;
    }

    function scheduleRefresh() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!cancelled) router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    }

    const channel = supabase
      .channel(`availability:${hallId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "availability",
          filter: `hall_id=eq.${hallId}`,
        },
        scheduleRefresh,
      )
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          setLive(true);
          // Re-read on every (re)subscribe, not just the first. This is the
          // reconnect path: anything that changed while the socket was down was
          // never delivered, and this closes the gap without having to know
          // what was in it.
          scheduleRefresh();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setLive(false);
        }
      });

    // A tab that was in the background may have missed events even with the
    // socket nominally open — phones suspend timers and sockets aggressively.
    function onVisible() {
      if (document.visibilityState === "visible") scheduleRefresh();
    }
    document.addEventListener("visibilitychange", onVisible);

    // The floor. Only while the tab is actually being looked at — polling a
    // backgrounded tab spends the customer's battery to refresh a calendar
    // nobody is reading, and onVisible already covers their return.
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") scheduleRefresh();
    }, POLL_MS);

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [hallId, router]);

  return { live };
}
