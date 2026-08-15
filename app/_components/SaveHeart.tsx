"use client";

import { Heart } from "lucide-react";
import { useSavedHalls } from "@/lib/hooks/useSavedHalls";
import { cn } from "@/lib/utils";

export function SaveHeart({ hallId, large }: { hallId: string; large?: boolean }) {
  const { isSaved, toggle } = useSavedHalls();
  const saved = isSaved(hallId);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(hallId);
      }}
      aria-pressed={saved}
      aria-label={saved ? "Unsave hall" : "Save hall"}
      className={cn(
        "flex items-center justify-center rounded-full bg-white/95 shadow-card transition-transform active:scale-90",
        large ? "h-10 w-10" : "h-8 w-8",
      )}
    >
      <Heart
        className={cn(
          large ? "h-5 w-5" : "h-4 w-4",
          saved ? "fill-rose-500 text-rose-500" : "text-charcoal-600",
        )}
      />
    </button>
  );
}
