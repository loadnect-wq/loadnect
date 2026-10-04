"use client";

// Deleting a plan removes its board and checklist with it. Two taps, because
// there is no undo.

import { useState, useTransition } from "react";
import { deletePlanAction } from "@/app/plan/actions";

export function DeletePlan({ planId }: { planId: string }) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  return (
    <div className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
      <p className="text-sm font-semibold text-charcoal-900">Delete this plan</p>
      <p className="mt-0.5 text-xs text-charcoal-600">
        Removes the board, the budget and the checklist. Bookings, enquiries and visits you made on Hallnect are not affected.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!armed) return setArmed(true);
            start(async () => {
              const res = await deletePlanAction(planId);
              // Success redirects to /plan; only a failure returns here.
              if (!res.ok) {
                setError(res.error);
                setArmed(false);
              }
            });
          }}
          className={`inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-semibold disabled:opacity-60 ${
            armed ? "bg-red-700 text-white hover:bg-red-800" : "border border-border text-charcoal-800 hover:bg-ivory-100"
          }`}
        >
          {armed ? "Tap again to delete for good" : "Delete plan"}
        </button>
        {armed && (
          <button type="button" onClick={() => setArmed(false)} className="min-h-[44px] text-sm text-charcoal-600 hover:underline">
            Keep it
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
