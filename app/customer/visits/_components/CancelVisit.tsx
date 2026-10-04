"use client";

// Cancel an upcoming visit. Two taps, so a stray touch on a phone does not
// withdraw a visit the hall has already arranged for.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelVisit } from "@/app/visit/[slug]/actions";

export function CancelVisit({ visitId }: { visitId: string }) {
  const [armed, setArmed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          start(async () => {
            const res = await cancelVisit(visitId);
            if (res.ok) router.refresh();
            else setFailed(true);
            setArmed(false);
          });
        }}
        className={`inline-flex min-h-[40px] items-center rounded-xl px-3 text-sm font-semibold ${
          armed ? "bg-red-700 text-white hover:bg-red-800" : "border border-border text-charcoal-800 hover:bg-ivory-100"
        } disabled:opacity-60`}
      >
        {armed ? "Tap again to cancel the visit" : "Cancel visit"}
      </button>
      {armed && (
        <button type="button" onClick={() => setArmed(false)} className="min-h-[40px] text-sm text-charcoal-600 hover:underline">
          Keep it
        </button>
      )}
      {failed && <p role="alert" className="w-full text-xs text-red-700">Could not cancel. Please try again.</p>}
    </div>
  );
}
