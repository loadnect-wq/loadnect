"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/sections/RotatingWord.tsx — one word in a sentence that cycles
// through a list, e.g. "book [wedding|party|reception|banquet] halls".
//
// NO LAYOUT SHIFT, WITHOUT MEASURING ANYTHING. Every word is rendered, stacked
// in the SAME grid cell (all of them `grid-area: 1 / 1`). A grid cell is as
// wide as its widest item, so the box is always exactly the width of the
// longest word — in whatever font, size and weight actually rendered — and the
// text around it never moves. No JavaScript measurement, no hard-coded width
// that goes stale when the font or the word list changes, and it is correct on
// the server's first paint rather than after hydration.
//
// THE SWAP. Each word is in one of three states, driven by a single index:
//   active   visible, in place
//   leaving  fades out while drifting up
//   waiting  invisible, parked just below
// So the outgoing word rises away as the incoming one rises into place. Only
// opacity and transform animate, which the compositor handles on its own.
//
// ACCESSIBILITY. The stacked words are aria-hidden and a single static word is
// given to screen readers instead; otherwise the sentence would be read as
// "book wedding party reception banquet halls", and a live region would
// announce a new word every couple of seconds. Reduced motion: no rotation at
// all — the first word, still.
//
// TUNING: `interval` (ms each word is shown, including its fade) and the
// duration-500 / 0.45em drift in the classes below.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";

type Props = {
  words: readonly string[];
  /** Milliseconds per word, including its 500ms fade. */
  interval?: number;
  className?: string;
};

export function RotatingWord({ words, interval = 2600, className }: Props) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (words.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Paused while the tab is hidden, so a visitor returning to the page does
    // not come back to a word mid-swap after a burst of throttled timers.
    let timer = 0;
    const start = () => {
      if (timer) return;
      timer = window.setInterval(() => setIndex((i) => (i + 1) % words.length), interval);
    };
    const stop = () => {
      window.clearInterval(timer);
      timer = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [words.length, interval]);

  const previous = (index - 1 + words.length) % words.length;

  return (
    <>
      <span className="sr-only">{words[0]}</span>
      <span
        aria-hidden
        className={["inline-grid justify-items-center align-baseline", className]
          .filter(Boolean)
          .join(" ")}
      >
        {words.map((word, i) => {
          const state = i === index ? "active" : i === previous ? "leaving" : "waiting";
          return (
            <span
              key={word}
              className="col-start-1 row-start-1 whitespace-nowrap transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none"
              style={{
                opacity: state === "active" ? 1 : 0,
                transform:
                  state === "active"
                    ? "translate3d(0, 0, 0)"
                    : state === "leaving"
                      ? "translate3d(0, -0.45em, 0)"
                      : "translate3d(0, 0.45em, 0)",
              }}
            >
              {word}
            </span>
          );
        })}
      </span>
    </>
  );
}
