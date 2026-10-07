"use client";

// The "Saved" tile on the account dashboard, counted from where saved halls
// ACTUALLY live: this browser's list (useSavedHalls), the one the heart writes
// to and /saved shows. The tile used to count the saved_halls table, which
// nothing has ever written to, so it read 0 beside a header that said
// "Saved 1".

import Link from "next/link";
import { Heart } from "lucide-react";
import { useSavedHalls } from "@/lib/hooks/useSavedHalls";
import { revealDelay } from "@/lib/motion";

export function SavedCountTile({ revealIndex }: { revealIndex?: number }) {
  const { ids } = useSavedHalls();
  return (
    <Link
      href="/saved"
      {...(revealIndex === undefined ? {} : { "data-reveal-now": "", style: revealDelay(revealIndex, 70) })}
      className="block rounded-2xl bg-white p-3.5 shadow-card transition-transform active:scale-[0.99]"
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Saved</p>
        <span className="text-charcoal-500"><Heart className="h-4 w-4" /></span>
      </div>
      <p className="mt-2 font-serif text-2xl font-bold text-charcoal-900">{ids.length}</p>
    </Link>
  );
}
