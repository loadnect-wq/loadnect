"use client";

import { useState, useTransition } from "react";
import { markPayoutSettledManually } from "../../actions";

/**
 * Records a payout the admin made by hand (NEFT/UPI), outside the gateway.
 *
 * The reference is REQUIRED and typed, not a confirm-click, because this write
 * is what stops the same owner being paid twice: `dispatchOwnerPayout` skips
 * split_status='done', and `issueRefund` refuses on it. Making the admin write
 * down the bank reference is the difference between a record and an assertion.
 */
export function MarkPaidManuallyButton({
  bookingId,
  amountLabel,
}: {
  bookingId: string;
  amountLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[36px] items-center rounded-lg border border-charcoal-300 bg-white px-3 text-[11px] font-semibold text-charcoal-700 hover:bg-charcoal-50"
      >
        I paid this by hand
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-charcoal-200 bg-charcoal-50 p-2.5">
      <p className="text-[11px] text-charcoal-700">
        Record that you sent <strong>{amountLabel}</strong> to this venue outside Hallnect.
        This stops it being paid again automatically, and blocks a refund that would
        double-spend the same capture.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          value={reference}
          onChange={(e) => { setReference(e.target.value); setMsg(null); }}
          placeholder="Bank / UPI reference"
          className="min-w-0 flex-1 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs focus:border-maroon-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={pending || reference.trim().length < 4}
          onClick={() =>
            startTransition(async () => {
              const r = await markPayoutSettledManually(bookingId, reference);
              if ("error" in r) setMsg(r.error);
              else setOpen(false);
            })
          }
          className="shrink-0 rounded-lg bg-charcoal-800 px-3 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Record"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setMsg(null); }}
          className="shrink-0 rounded-lg px-2 text-[11px] font-semibold text-charcoal-500"
        >
          Cancel
        </button>
      </div>
      {msg && <p className="mt-1.5 text-[11px] text-red-600">{msg}</p>}
    </div>
  );
}
