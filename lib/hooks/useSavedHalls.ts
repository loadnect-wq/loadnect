"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "hallnect:saved";
const EVENT = "hallnect:saved:change";

/** Shared by every server render and by the hydration pass, so the identity is
 *  stable and useSyncExternalStore cannot loop on it. */
const EMPTY: string[] = [];

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // Private mode, or site data blocked. Saving is a convenience, not a
    // feature anything else depends on — behave as "nothing saved".
    return null;
  }
}

function parse(raw: string | null): string[] {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const ids = parsed.filter((v): v is string => typeof v === "string");
    return ids.length > 0 ? ids : EMPTY;
  } catch {
    return EMPTY;
  }
}

// getSnapshot MUST return the same reference when nothing changed. Returning a
// freshly parsed array every call would re-render forever, because React
// compares snapshots by identity. So the parsed value is memoised against the
// raw string it came from.
let cachedRaw: string | null = null;
let cachedIds: string[] = EMPTY;

function getSnapshot(): string[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedIds = parse(raw);
  }
  return cachedIds;
}

function getServerSnapshot(): string[] {
  return EMPTY;
}

function subscribe(onStoreChange: () => void): () => void {
  // `storage` covers another tab; the custom event covers this one, because
  // localStorage does not notify the window that wrote to it.
  window.addEventListener(EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function write(ids: string[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Nothing was persisted, so do NOT announce a change — every subscriber
    // would re-read storage and get the old list back.
    return false;
  }
  window.dispatchEvent(new CustomEvent(EVENT));
  return true;
}

/**
 * Saved hall ids, kept in localStorage so saving needs no account.
 *
 * This is an external store shared by every mounted heart icon, the header
 * count and the saved page, so it is read through useSyncExternalStore rather
 * than mirrored into component state. The practical difference: toggling a
 * heart updates every other instance in the same commit instead of leaving the
 * header count one render behind.
 */
export function useSavedHalls() {
  const ids = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const isSaved = useCallback((id: string) => ids.includes(id), [ids]);

  const toggle = useCallback((id: string) => {
    // Re-read rather than closing over `ids`: another tab may have changed the
    // list since this render, and the last writer should not silently discard
    // the other's save.
    const current = getSnapshot();
    const next = current.includes(id) ? current.filter((v) => v !== id) : [...current, id];
    // Report what actually happened, not what was attempted. When storage is
    // blocked nothing was saved, and the caller's toast must not say it was.
    if (!write(next)) return current.includes(id);
    return next.includes(id);
  }, []);

  return { ids, isSaved, toggle };
}
