"use client";

// Switches a "not needed" category back on from the board.

import { useTransition } from "react";
import { Plus } from "lucide-react";
import { setItemNeededAction } from "@/app/plan/actions";

export function CategoryToggle({ planId, category, label }: { planId: string; category: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await setItemNeededAction(planId, category, true); })}
      className="inline-flex min-h-[40px] items-center gap-1 rounded-full border border-border bg-white px-3 text-xs font-semibold text-charcoal-700 hover:border-maroon-300 hover:text-maroon-700 disabled:opacity-50"
    >
      <Plus className="h-3.5 w-3.5" aria-hidden /> {label}
    </button>
  );
}
