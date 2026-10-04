"use client";

// Confirm or decline a visit request, with an optional message the family
// sees in My visits ("Come at 11, use the side gate").

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { answerVisit } from "../actions";

export function VisitAnswer({ visitId }: { visitId: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const send = (decision: "confirmed" | "declined") =>
    start(async () => {
      setError("");
      const res = await answerVisit({ visitId, decision, message });
      if (res.ok) router.refresh();
      else setError(res.error);
    });

  return (
    <div className="mt-3 space-y-2">
      <label htmlFor={`msg-${visitId}`} className="sr-only">Message to the family (optional)</label>
      <textarea
        id={`msg-${visitId}`}
        rows={2}
        maxLength={300}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Message to the family (optional), e.g. Come at 11 am, use the side gate"
        className="block w-full rounded-xl border border-border px-3 py-2 text-sm"
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => send("confirmed")}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-green-700 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60"
        >
          <Check className="h-4 w-4" aria-hidden /> Confirm visit
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => send("declined")}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-border text-sm font-semibold text-charcoal-800 hover:bg-ivory-100 disabled:opacity-60"
        >
          <X className="h-4 w-4" aria-hidden /> Decline
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
