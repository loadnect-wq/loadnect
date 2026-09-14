"use client";

import { useSyncExternalStore } from "react";

/**
 * The current time, as an external store.
 *
 * WHY THIS EXISTS. `Date.now()` called during a render is impure twice over:
 * the value changes without any state changing, and on a server-rendered page
 * the server and the client compute it at different instants — so a badge that
 * straddles an hour boundary hydrates to different text than was sent, which
 * React has to patch. It also never updates: a "Respond within 3h" chip on a
 * dashboard left open overnight still says 3h.
 *
 * Reading the clock as a subscribed store fixes all three. The server snapshot
 * is 0, which callers treat as "unknown yet" and render as nothing, so the
 * markup matches by construction instead of by luck.
 *
 * ONE timer for the whole page, shared by every subscriber and stopped when the
 * last one unmounts — a per-component interval on a list of thirty bookings is
 * thirty wakeups a minute for text that changes once an hour.
 */

const TICK_MS = 60_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let now = 0;

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

// Must return the SAME value between ticks, or every render schedules another.
function getSnapshot(): number {
  if (now === 0) now = Date.now();
  return now;
}

/** 0 means "no clock here" — the server has no business guessing the reader's. */
function getServerSnapshot(): number {
  return 0;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
