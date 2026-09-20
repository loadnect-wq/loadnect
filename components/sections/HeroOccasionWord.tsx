"use client";

// The word in the desktop hero headline, "Every ___ starts with the right hall."
// Same words and the same swap as the sign-in page (app/(auth)/login/page.tsx):
// a gold italic word that blurs out upward while the next blurs in from below,
// every 2.6s.
//
// VISIBLE FROM THE SERVER HTML. AnimatePresence initial={false} means the first
// word renders with no entrance, so the headline never depends on JavaScript to
// appear (the lesson from the login page's first release). Reduced-motion
// visitors see "wedding" and nothing moves.

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

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
const EASE = [0.22, 1, 0.36, 1] as const;

export function HeroOccasionWord() {
  const reduceMotion = useReducedMotion() ?? false;
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const t = setInterval(() => setI((n) => (n + 1) % OCCASIONS.length), 2600);
    return () => clearInterval(t);
  }, [reduceMotion]);

  return (
    // The hero's .hero-ink text-shadow would show THROUGH gradient-clipped
    // (transparent) text and muddy the gold, so the word drops it and the
    // wrapper casts an equivalent drop-shadow instead. The filter sits on the
    // wrapper because the word's own filter is animated (blur).
    <span className="relative inline-block align-bottom [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.45))_drop-shadow(0_2px_12px_rgba(0,0,0,0.3))]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={OCCASIONS[i]}
          className="inline-block bg-gold-gradient bg-clip-text pr-[0.08em] italic text-transparent [text-shadow:none]"
          initial={{ opacity: 0, y: "0.45em", filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: "-0.45em", filter: "blur(6px)" }}
          transition={{ duration: 0.45, ease: EASE }}
        >
          {OCCASIONS[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
