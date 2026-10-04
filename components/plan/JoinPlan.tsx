"use client";

// The button on an invite page. Joining adds the visitor as someone who can
// view and vote; success goes straight to the plan.

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { joinPlanAction } from "@/app/plan/family-actions";

export function JoinPlan({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError("");
            // Success redirects to the plan; only a failure comes back here.
            const res = await joinPlanAction(token);
            if (!res.ok) setError(res.error);
          })
        }
        className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-maroon-700 px-6 text-sm font-semibold text-white hover:bg-maroon-800 disabled:opacity-60 sm:w-auto"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Join the plan
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
