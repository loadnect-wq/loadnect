"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Clock } from "lucide-react";
import { acceptBooking, rejectBooking, markBookingCompleted } from "@/app/owner/(dashboard)/actions";

// ─────────────────────────────────────────────────────────────────────────────
// Owner's accept / decline control for a booking request.
//
// Declining now REQUIRES a written reason: it is stored on the booking and sent
// to the customer by SMS, so a customer whose event is refused is told why
// rather than just seeing "declined". The server re-validates the reason.
//
// Sizing is mobile-first (44px targets, full-width stacked on phones,
// inline on desktop) because most venue owners answer requests on a phone.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  bookingId: string;
  status:    string;
  /** Shown in the decline sheet so the owner knows who they are refusing. */
  customerLabel?: string;
  /** True when these dates now clash with another active booking. */
  hasConflict?: boolean;
}

const MIN_REASON = 10;
const MAX_REASON = 500;

export function BookingActions({ bookingId, status, customerLabel, hasConflict }: Props) {
  const [pending, startTransition] = useTransition();
  const [error,   setError]        = useState<string | null>(null);
  const [done,    setDone]         = useState<string | null>(null);
  const [declining, setDeclining]  = useState(false);
  const [reason,  setReason]       = useState("");

  const trimmed = reason.trim();
  const tooShort = trimmed.length < MIN_REASON;

  function act(fn: () => Promise<{ success: true } | { error: string }>, label: string) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) setError(result.error);
      else { setDone(label); setDeclining(false); }
    });
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
        <CheckCircle2 className="h-4 w-4" /> {done}
      </span>
    );
  }

  // ── Decline sheet ─────────────────────────────────────────────────────────
  if (declining) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-3">
        <p className="text-xs font-semibold text-red-900">
          Decline this booking{customerLabel ? ` from ${customerLabel}` : ""}?
        </p>
        <p className="mt-0.5 text-[11px] text-red-700">
          The customer is told why by SMS. Any advance they paid is handled by Hallnect.
        </p>

        <textarea
          autoFocus
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
          placeholder="e.g. The hall is already committed for a family function that day."
          className="mt-2 w-full resize-none rounded-lg border border-red-200 p-2.5 text-sm text-charcoal-900 outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400"
        />
        <div className="flex items-center justify-between text-[10px] text-red-700">
          <span>{tooShort ? `${MIN_REASON - trimmed.length} more characters needed` : "Ready"}</span>
          <span>{trimmed.length}/{MAX_REASON}</span>
        </div>

        {error && <p className="mt-1 text-[11px] text-red-700">{error}</p>}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => { setDeclining(false); setError(null); }}
            disabled={pending}
            className="min-h-[44px] flex-1 rounded-lg border border-charcoal-300 bg-white px-3 text-xs font-semibold text-charcoal-700 hover:bg-charcoal-50 disabled:opacity-60"
          >
            Keep request
          </button>
          <button
            type="button"
            onClick={() => act(() => rejectBooking(bookingId, trimmed), "Declined")}
            disabled={pending || tooShort}
            className="min-h-[44px] flex-1 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? "Declining…" : "Confirm decline"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {hasConflict && status === "booking_requested" && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          These dates now overlap another active booking. Accepting may double-book the venue.
        </p>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {status === "booking_requested" && (
          <>
            <button
              type="button"
              onClick={() => act(() => acceptBooking(bookingId), "Accepted")}
              disabled={pending}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600 px-4 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60 sm:flex-none sm:text-xs"
            >
              <CheckCircle2 className="h-4 w-4" /> Accept booking
            </button>
            <button
              type="button"
              onClick={() => setDeclining(true)}
              disabled={pending}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-4 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60 sm:flex-none sm:text-xs"
            >
              <XCircle className="h-4 w-4" /> Decline
            </button>
          </>
        )}
        {status === "owner_confirmed" && (
          <button
            type="button"
            onClick={() => act(() => markBookingCompleted(bookingId), "Marked complete")}
            disabled={pending}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-charcoal-700 px-4 text-sm font-semibold text-white hover:bg-charcoal-800 disabled:opacity-60 sm:text-xs"
          >
            <CheckCircle2 className="h-4 w-4" /> Mark complete
          </button>
        )}
      </div>
    </div>
  );
}

/** Countdown to the auto-expiry of an unanswered request. */
export function ResponseDeadline({ dueAt }: { dueAt: string | null }) {
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;

  const hours = Math.floor(ms / 3_600_000);
  const overdue = ms <= 0;
  const urgent = !overdue && hours < 12;

  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold " +
        (overdue ? "bg-red-50 text-red-700"
          : urgent ? "bg-amber-50 text-amber-800"
          : "bg-ivory-100 text-charcoal-600")
      }
    >
      <Clock className="h-3 w-3" />
      {overdue
        ? "Response overdue"
        : hours >= 24
          ? `Respond within ${Math.floor(hours / 24)}d`
          : `Respond within ${Math.max(1, hours)}h`}
    </span>
  );
}
