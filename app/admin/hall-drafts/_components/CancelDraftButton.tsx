"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cancelAdminHallDraft } from "../../actions";

/**
 * Withdraws a draft nobody should claim.
 *
 * A REASON IS REQUIRED, and not for ceremony: an unclaimed listing that quietly
 * disappears leaves no way to answer "why did the venue we recorded never go
 * live?". The reason goes into the audit trail with the actor and the time.
 */
export function CancelDraftButton({ draftId, hallName }: { draftId: string; hallName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-charcoal-500 transition-colors hover:text-red-600"
      >
        Withdraw listing
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-ivory-50 p-3">
      <label htmlFor={`reason-${draftId}`} className="text-xs font-semibold text-charcoal-700">
        Why is {hallName} being withdrawn?
      </label>
      <input
        id={`reason-${draftId}`}
        value={reason}
        onChange={(e) => { setReason(e.target.value); setError(null); }}
        placeholder="Duplicate of an existing listing / venue declined / entered in error"
        className="mt-1.5 w-full rounded-lg border border-input bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
      <div className="mt-2.5 flex items-center gap-3">
        <button
          type="button"
          disabled={pending || reason.trim().length === 0}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await cancelAdminHallDraft({ draftId, reason: reason.trim() });
              if ("error" in result) { setError(result.error); return; }
              toast({ title: "Listing withdrawn", description: hallName, variant: "success" });
              setOpen(false);
              router.refresh();
            })
          }
          className="inline-flex items-center rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          {pending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />}
          Withdraw
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setReason(""); setError(null); }}
          className="text-xs text-charcoal-500 hover:text-charcoal-800"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
