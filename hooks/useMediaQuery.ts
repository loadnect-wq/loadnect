"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribes to a media query.
 *
 * WHY useSyncExternalStore AND NOT useState + useEffect: a media query IS an
 * external store, and the effect version could only learn the real value AFTER
 * the first paint. Every consumer therefore rendered once as "false" and then
 * again with the truth — a guaranteed second render on every mount, and on a
 * client-side navigation a visible flash of the desktop layout on a phone.
 *
 * useSyncExternalStore gets the real value on the very first client render.
 * During hydration it deliberately uses the server snapshot (false) so the
 * markup matches what was prerendered, then reconciles — which is the one case
 * where a second pass is unavoidable and React does it without a mismatch
 * warning.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener("change", onStoreChange);
      return () => mediaQuery.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  // Returns a boolean, so a fresh MediaQueryList per call cannot cause the
  // identity-instability loop that getSnapshot is otherwise prone to.
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export const useIsMobile = () => useMediaQuery("(max-width: 768px)");
