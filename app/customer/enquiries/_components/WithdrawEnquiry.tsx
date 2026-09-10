"use client";

// A two-tap withdraw. The first tap only asks; nothing leaves the browser until
// the second. Withdrawing is not destructive to money, but it does tell a venue
// that a customer changed their mind, and an accidental tap on a phone list is
// exactly how that happens.

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { withdrawLeadEnquiry } from "@/app/enquiry/[slug]/actions";

export function WithdrawEnquiry({ leadId }: { leadId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function withdraw() {
    setError(null);
    start(async () => {
      const r = await withdrawLeadEnquiry(leadId);
      if ("error" in r) { setError(r.error); setConfirming(false); return; }
      // The server revalidates /customer/enquiries, so the row re-renders as
      // withdrawn on its own — no local state pretending it happened.
    });
  }

  if (!confirming) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-lg border border-border bg-white px-3 py-1.5 text-[11px] font-semibold text-charcoal-600 hover:border-red-300 hover:text-red-700"
        >
          Withdraw
        </button>
        {error && (
          <p role="alert" className="text-[11px] font-semibold text-red-600">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-charcoal-600">Withdraw this enquiry?</span>
      <button
        type="button"
        onClick={withdraw}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60"
      >
        {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        Yes
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-[11px] font-semibold text-charcoal-600 disabled:opacity-60"
      >
        No
      </button>
    </div>
  );
}
