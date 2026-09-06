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
// ─────────────────────────────────────────────────────────────────────────────

/** Collapses a burst of changes (a 3-day block writes 3 rows) into one re-read. */
const REFRESH_DEBOUNCE_MS = 400;

/**
 * A re-read floor, independent of the socket delivering anything.
 *
 * MEASURED, NOT PRECAUTIONARY. Subscribed from a real browser against
 * production: DELETE events arrive, INSERT events do NOT — even with no filter
 * at all. Supabase evaluates the SELECT policy against the candidate row before
 * delivering an INSERT, and `availability_select` joins `halls` and calls
 * owns_hall()/is_admin(); that evaluation fails for an anonymous subscriber, so
 * the row is dropped. DELETEs get through precisely because RLS CANNOT be
 * evaluated on a deleted row, so only the primary key is broadcast.
 *
 * The practical effect without this poll would be the wrong half working: a
 * released date would appear, a newly BLOCKED one would not — and a date
 * becoming unavailable is the one a customer must not miss.
 *
 * The booking page requires sign-in, so real subscribers are authenticated and
 * may well receive INSERTs where anon does not. That is untested, and a
 * calendar's correctness should not rest on an untested assumption about
 * someone else's RLS evaluator. Sixty seconds is cheap — one cached server
 * render — and it makes convergence independent of the socket entirely.
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
