"use client";

import { useState, useTransition } from "react";
import { submitHallForApproval } from "@/app/owner/(dashboard)/actions";

export function SubmitForApprovalButton({ hallId }: { hallId: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function handleClick() {
    startTransition(async () => {
      const result = await submitHallForApproval(hallId);
      if ("success" in result) setDone(true);
    });
  }

  if (done) {
    return (
      <span className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
        ✓ Submitted for approval
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="rounded-lg border border-maroon-400 bg-maroon-50 px-3 py-1.5 text-xs font-semibold text-maroon-700 hover:bg-maroon-100 disabled:opacity-60"
    >
      {pending ? "Submitting…" : "Submit for Approval"}
    </button>
  );
}
