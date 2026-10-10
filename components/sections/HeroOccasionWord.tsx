"use client";

// The word in the desktop hero headline, "Every ___ starts with the right hall."
// Same words and the same swap as the sign-in page (app/(auth)/login/page.tsx):
// a gold italic word that blurs out upward while the next blurs in from below,
// every 2.6s.
//
// VISIBLE FROM THE SERVER HTML. The first word renders with no entrance, so the
// headline never depends on JavaScript to appear (the lesson from the login
// page's first release). Reduced-motion visitors see "wedding" and nothing
// moves.
//
// CSS KEYFRAMES, NOT framer-motion (SEO phase 6, 2026-10-10). This one word
// was the only reason the homepage shipped framer-motion — 139 KB of script
// (47 KB compressed) parsed and run on every phone, where this word is in the
// desktop tree and never even shows. The swap is the same: the word blurs out
// upward (.occasion-out), then the next blurs in from below (.occasion-in),
// 450ms each, as AnimatePresence mode="wait" did. Keyframes are in
// app/globals.css.

import { useEffect, useState } from "react";
import { playfairItalic } from "@/app/fonts/playfair-italic";
import { cn } from "@/lib/utils";

// The words the hero cycles through.
//
// BROADENED WHEN HALLNECT STOPPED BEING A WEDDING-HALL SITE. It was
// wedding/reception/engagement/celebration — four words that told a visitor,
// before they read anything else, that this was a wedding product. It now
// spans the catalogue's range, because this line is the single most prominent
// statement the site makes about what it is for.
//
// CURATED, NOT THE WHOLE CATALOGUE, and deliberately so. This is a headline,
// not a directory: the words have to fit "Every ___ starts with the right
// hall." and read naturally there. "naming ceremony" and "product launch" are
// real categories and both make that sentence clumsy. The full twenty-eight
// live in the discovery grid, which is the surface that owes completeness.
//
// Kept identical to the sign-in page's list on purpose — the two screens were
// matched deliberately and should be changed together.
const OCCASIONS = [
  "wedding", "reception", "birthday", "party", "meeting", "conference", "celebration",
] as const;
/** How long each word stays, start to start — the old setInterval period. */
const HOLD_MS = 2600;
/** One half of the swap; must match the 450ms in .occasion-in/.occasion-out. */
const SWAP_MS = 450;

export function HeroOccasionWord() {
  const [i, setI] = useState(0);
  // "leaving" while the current word blurs out; "entering" once a swap has
  // happened, so only words AFTER the first animate in.
  const [phase, setPhase] = useState<"still" | "leaving" | "entering">("still");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let swap: number | undefined;
    const t = window.setInterval(() => {
      setPhase("leaving");
      swap = window.setTimeout(() => {
        setI((n) => (n + 1) % OCCASIONS.length);
        setPhase("entering");
      }, SWAP_MS);
    }, HOLD_MS);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(swap);
    };
  }, []);

  return (
    // The hero's .hero-ink text-shadow would show THROUGH gradient-clipped
    // (transparent) text and muddy the gold, so the word drops it and the
    // wrapper casts an equivalent drop-shadow instead. The filter sits on the
    // wrapper because the word's own filter is animated (blur).
    <span className="relative inline-block align-bottom [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.45))_drop-shadow(0_2px_12px_rgba(0,0,0,0.3))]">
      <span
        // A new key per word remounts the span, which is what restarts the
        // entrance keyframe for each one.
        key={OCCASIONS[i]}
        className={cn(
          playfairItalic.className,
          "inline-block bg-gold-gradient bg-clip-text pr-[0.08em] italic text-transparent [text-shadow:none]",
          phase === "leaving" && "occasion-out",
          phase === "entering" && "occasion-in",
        )}
      >
        {OCCASIONS[i]}
      </span>
    </span>
  );
}
