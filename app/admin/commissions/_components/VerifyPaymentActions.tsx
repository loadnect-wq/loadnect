"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { verifyCommissionPayment } from "@/app/admin/actions";

export function VerifyPaymentActions({ paymentId }: { paymentId: string }) {
  const [note, setNote]     = useState("");
  const [error, setError]   = useState<string | null>(null);
  const [done, setDone]     = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function act(decision: "approve" | "reject") {
    setError(null);
    startTransition(async () => {
      const result = await verifyCommissionPayment(paymentId, decision, note);
      if ("error" in result) setError(result.error);
      else setDone(decision === "approve" ? "Approved — commission marked paid" : "Rejected");
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
    <div className="space-y-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Admin note (optional)"
        className="w-full rounded-lg border border-border px-2.5 py-1.5 text-xs"
        maxLength={500}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => act("approve")}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Approve & mark paid
        </button>
        <button
          type="button"
          onClick={() => act("reject")}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
        >
          <XCircle className="h-3.5 w-3.5" /> Reject
        </button>
      </div>
    </div>
  );
}
