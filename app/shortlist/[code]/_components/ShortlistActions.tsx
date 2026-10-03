"use client";

// What a relative can do with a shortlist that reached them: keep it (the
// halls join their own saved list, on their own phone) and pass it on.

import { useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { useSavedHalls } from "@/lib/hooks/useSavedHalls";
import { ShareShortlist } from "@/components/shortlist/ShareShortlist";

export function ShortlistActions({ code, hallIds }: { code: string; hallIds: string[] }) {
  const { ids: saved, addMany } = useSavedHalls();
  const [error, setError] = useState(false);
  const allSaved = hallIds.length > 0 && hallIds.every((id) => saved.includes(id));

  return (
    <div className="mt-4 rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
      {allSaved ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-charcoal-800">
          <Heart className="h-4 w-4 fill-rose-500 text-rose-500" aria-hidden />
          {hallIds.length === 1 ? "This hall is in your saved list." : "These halls are in your saved list."}
          <Link href="/saved" className="font-semibold text-maroon-700 hover:underline">See your list</Link>
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setError(addMany(hallIds) === null)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800"
          >
            <Heart className="h-4 w-4" aria-hidden />
            {hallIds.length === 1 ? "Save this hall to my list" : `Save all ${hallIds.length} to my list`}
          </button>
          <p className="mt-2 text-xs text-charcoal-600">
            {error
              ? "This browser would not save them. Tap the heart on each hall instead."
              : "They stay on this phone. No sign-up needed."}
          </p>
        </>
      )}

      <div className="mt-4 border-t border-border pt-4">
        <p className="mb-2 text-sm font-semibold text-charcoal-900">Pass it on</p>
        <ShareShortlist code={code} count={hallIds.length} label="Forward on WhatsApp" />
      </div>
    </div>
  );
}
