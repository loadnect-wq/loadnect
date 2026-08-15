"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { acceptBooking, rejectBooking, markBookingCompleted } from "@/app/owner/(dashboard)/actions";

interface Props {
  bookingId: string;
  status:    string;
}

export function BookingActions({ bookingId, status }: Props) {
  const [pending, startTransition] = useTransition();
  const [error,   setError]        = useState<string | null>(null);
  const [done,    setDone]         = useState<string | null>(null);

  function act(fn: () => Promise<{ success: true } | { error: string }>, label: string) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) setError(result.error);
      else setDone(label);
    });
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
        <CheckCircle2 className="h-4 w-4" /> {done}
      </span>
    );
  }

  return (
    <div className="space-y-1">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {status === "booking_requested" && (
          <>
            <button
              type="button"
              onClick={() => act(() => acceptBooking(bookingId), "Accepted")}
              disabled={pending}
              className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Accept
            </button>
            <button
              type="button"
              onClick={() => act(() => rejectBooking(bookingId), "Rejected")}
              disabled={pending}
              className="flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
            >
              <XCircle className="h-3.5 w-3.5" /> Reject
            </button>
          </>
        )}
        {status === "owner_confirmed" && (
          <button
            type="button"
            onClick={() => act(() => markBookingCompleted(bookingId), "Marked complete")}
            disabled={pending}
            className="flex items-center gap-1 rounded-lg bg-charcoal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-charcoal-800 disabled:opacity-60"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Mark Complete
          </button>
        )}
      </div>
    </div>
  );
}
