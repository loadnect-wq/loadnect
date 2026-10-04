"use client";

// The family's budget numbers — guests, per-plate rate, meals, decoration,
// other costs — remembered in this browser, so every venue page and the
// compare page start from the same assumptions. Per-viewer convenience only:
// nothing is sent anywhere, and a blocked localStorage just means the fields
// start empty. Same external-store shape as useSavedHalls, for the same
// reasons (one snapshot identity per value, no setState in an effect).

import { useCallback, useSyncExternalStore } from "react";

export type BudgetFields = {
  guests: string;
  perPlate: string;
  meals: string;
  decoration: string;
  other: string;
};

const KEY = "hallnect:budget";
const EVENT = "hallnect:budget:change";
const EMPTY: BudgetFields = { guests: "", perPlate: "", meals: "1", decoration: "", other: "" };

let cachedRaw: string | null = null;
let cached: BudgetFields = EMPTY;
/** Set once a write to storage fails: from then on this page keeps the numbers in memory. */
let memoryOnly = false;

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function getSnapshot(): BudgetFields {
  if (memoryOnly) return cached;
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const v = raw ? JSON.parse(raw) : null;
      cached = v && typeof v === "object"
        ? {
            guests: typeof v.guests === "string" ? v.guests : "",
            perPlate: typeof v.perPlate === "string" ? v.perPlate : "",
            meals: typeof v.meals === "string" ? v.meals : "1",
            decoration: typeof v.decoration === "string" ? v.decoration : "",
            other: typeof v.other === "string" ? v.other : "",
          }
        : EMPTY;
    } catch {
      cached = EMPTY;
    }
  }
  return cached;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Fields as typed (strings, so a half-typed "1,6" survives), and a setter that
 * merges one change. If storage is blocked the value still updates for this
 * page through an in-memory fallback.
 */
export function useBudgetInputs() {
  const fields = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);

  const set = useCallback((patch: Partial<BudgetFields>) => {
    const next = { ...getSnapshot(), ...patch };
    const raw = JSON.stringify(next);
    try {
      localStorage.setItem(KEY, raw);
    } catch {
      // Private window: keep it in memory for this page.
      memoryOnly = true;
      cached = next;
    }
    window.dispatchEvent(new CustomEvent(EVENT));
  }, []);

  return { fields, set };
}
