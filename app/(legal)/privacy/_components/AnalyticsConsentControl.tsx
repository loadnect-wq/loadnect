"use client";

// The operable half of the sentence above it. The policy says "you can change
// your mind at any time", and a policy that says so without providing a way to
// do it is the same class of problem as the analytics claim this section used to
// carry — a promise the product does not keep.
//
// Clearing the stored choice brings the banner back on the next render, so the
// visitor is asked again rather than being silently switched to either state.

import { useCallback, useState } from "react";
import { resetAnalyticsConsent } from "@/components/analytics/AnalyticsConsent";

export function AnalyticsConsentControl() {
  const [done, setDone] = useState(false);

  const reset = useCallback(() => {
    resetAnalyticsConsent();
    setDone(true);
  }, []);

  return (
    <div className="my-4 rounded-xl border border-border bg-ivory-50 p-4">
      <p className="text-sm text-charcoal-700">
        <strong>Your analytics choice.</strong> This clears what you chose and asks you again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-3 min-h-[44px] rounded-lg border border-maroon-300 bg-white px-4 text-sm font-semibold text-maroon-700 hover:bg-maroon-50"
      >
        Change my analytics choice
      </button>
      {done && (
        <p aria-live="polite" className="mt-2 text-xs font-semibold text-green-700">
          Cleared — the banner will ask you again.
        </p>
      )}
    </div>
  );
}
