"use client";

import { useState, useTransition } from "react";
import { cancelBookingAsAdmin } from "../../actions";

/**
 * Cancels a booking on the venue's or the platform's behalf.
 *
 * The initiator choice is the whole point and is deliberately explicit rather
 * than defaulted: it decides the refund. "The venue cancelled" and "we
 * cancelled" both return the customer 100% of the advance AND the fee plus its GST,
 * whereas the customer's own cancel button applies the penalty schedule — which
 * can be ₹0 back. Picking the wrong one here takes real money off a customer
 * who did nothing wrong.
 */
export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [initiator, setInitiator] = useState<"owner" | "platform">("owner");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[36px] items-center rounded-lg border border-red-300 bg-red-50 px-3 text-[11px] font-semibold text-red-700 hover:bg-red-100"
      >
        Cancel booking
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
      <p className="text-[11px] font-semibold text-red-900">
        Cancel this booking and refund the customer in full
      </p>
      <p className="mt-0.5 text-[11px] text-red-800">
        Both options return the whole advance <strong>and</strong> the platform fee with its
        GST, as the refund policy promises for cancellations the customer did not cause.
      </p>

      <div className="mt-2 flex gap-2">
        {(["owner", "platform"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setInitiator(k)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
              initiator === k
                ? "bg-red-700 text-white"
                : "border border-red-300 bg-white text-red-700"
            }`}
          >
            {k === "owner" ? "The venue cancelled" : "Hallnect cancelled"}
          </button>
        ))}
      </div>

      <textarea
        value={reason}
        onChange={(e) => { setReason(e.target.value); setMsg(null); }}
        rows={2}
        placeholder="Why? The customer is shown this."
        className="mt-2 w-full rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs focus:border-red-500 focus:outline-none"
      />

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={pending || reason.trim().length < 10}
          onClick={() =>
            startTransition(async () => {
              const r = await cancelBookingAsAdmin(bookingId, reason, initiator);
              if ("error" in r) setMsg(r.error);
              else setOpen(false);
            })
          }
          className="rounded-lg bg-red-700 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Cancelling…" : "Cancel and refund"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setMsg(null); }}
          className="px-2 text-[11px] font-semibold text-charcoal-600"
        >
          Keep booking
        </button>
      </div>
      {msg && <p className="mt-1.5 text-[11px] text-red-700">{msg}</p>}
    </div>
  );
}
