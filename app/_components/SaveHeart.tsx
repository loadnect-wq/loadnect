"use client";

import { Heart } from "lucide-react";
import { usePathname } from "next/navigation";
import { useSavedHalls } from "@/lib/hooks/useSavedHalls";
import { dismiss, toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** The last save/unsave toast, so a quick second tap replaces it instead of stacking. */
let lastToast: string | null = null;

export function SaveHeart({ hallId, large }: { hallId: string; large?: boolean }) {
  const { isSaved, toggle } = useSavedHalls();
  const pathname = usePathname() ?? "/";
  const saved = isSaved(hallId);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // SAY WHAT HAPPENED, AND WHERE IT WENT. The heart used to fill in
        // silently, so a family never learned that saved halls collect in
        // one list they can compare and send to the family. toggle() reports
        // the state that actually stuck: unchanged means storage refused it.
        const nowSaved = toggle(hallId);
        if (lastToast) dismiss(lastToast);
        if (nowSaved === saved) {
          lastToast = toast({
            title: "Could not save this hall",
            description: "This browser is blocking storage for the site, so the list cannot be kept.",
            variant: "destructive",
          }).id;
        } else if (nowSaved) {
          lastToast = toast({
            title: "Saved to your shortlist",
            description: "Compare your saved halls and send the list to the family.",
            action: pathname.startsWith("/saved") ? undefined : { label: "View", href: "/saved" },
            duration: 4000,
          }).id;
        } else {
          lastToast = toast({ title: "Removed from your shortlist", duration: 2500 }).id;
        }
      }}
      aria-pressed={saved}
      aria-label={saved ? "Unsave hall" : "Save hall"}
      className={cn(
        "hit-44 flex items-center justify-center rounded-full bg-white/95 shadow-card transition-transform active:scale-90",
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
