"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/sections/RotatingWord.tsx — one word in a sentence that cycles
// through a list, e.g. "book [wedding|party|reception|banquet] halls".
//
// THE BOX GLIDES TO EACH WORD'S WIDTH. Every word is rendered, stacked in the
// same grid cell. On the server's first paint the cell is the width of the
// widest word, so nothing jumps on load. After mount, each word's width is read
// from what actually rendered — never hard-coded, re-read when fonts finish
// loading and on resize — and the cell eases to the active word's width in
// step with the fade.
//
// Why not just keep the widest-word box: measured at 1440px, "party" is 47px
// in an 83px box sized for "reception", which left 18px of empty space on
// EACH side — "book    party    halls". A fixed box keeps the surrounding text
// perfectly still but reads as a typo; a 500ms glide reads as the swap.
//
// The cell clips horizontally (overflow-x: clip) so that, while it widens, an
// incoming longer word is revealed from its centre instead of spilling over
// "book" and "halls". Vertical overflow stays visible for the drift.
//
// The column track is minmax(0, 1fr), NOT the default auto. An auto track stays
// as wide as the widest word even when the box is narrowed, and items centre
// in the TRACK — so "party" would sit centred in an 83px track inside a 47px
// box: pushed right and clipped. A 1fr track is the box, so items centre in
// what is visible.
//
// THE SWAP. Each word is in one of three states, driven by a single index:
//   active   visible, in place
//   leaving  fades out while drifting up
//   waiting  invisible, parked just below
// Only opacity, transform and the cell's width animate.
//
// ACCESSIBILITY. The stacked words are aria-hidden AND unselectable; a single
// static word is given to screen readers and to copy-paste instead. Otherwise
// the sentence reads (and copies) as "book wedding party reception banquet
// halls", and a live region would announce a new word every couple of seconds.
// Reduced motion: no rotation, no glide — the first word, still, in a box its
// own width.
//
// TUNING: `interval` (ms each word is shown, including its fade), and the
// duration-500 / 0.45em drift in the classes below.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";

type Props = {
  words: readonly string[];
  /** Milliseconds per word, including its 500ms fade. */
  interval?: number;
  className?: string;
};

export function RotatingWord({ words, interval = 2600, className }: Props) {
  const [index, setIndex] = useState(0);
  const boxRef = useRef<HTMLSpanElement>(null);
  const widths = useRef<number[]>([]);
  const indexRef = useRef(0);

  // ── Rotation ──────────────────────────────────────────────────────────────
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

  // ── Width: read from the rendered words, applied without animating ────────
  // Runs on mount, when web fonts finish loading (the fallback font measures
  // differently), and on resize (the subhead changes size at a breakpoint).
  // The first application of a measurement never animates: a box easing from
  // the widest word to the first word just after load would read as a twitch.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let raf = 0;

    const measure = () => {
      raf = 0;
      widths.current = [...box.children].map((el) => el.getBoundingClientRect().width);
      const w = widths.current[indexRef.current];
      if (!w) return;
      const previous = box.style.transition;
      box.style.transition = "none";
      box.style.width = `${w}px`;
      void box.offsetWidth; // commit the width before transitions come back
      box.style.transition = previous;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    schedule();
    document.fonts?.ready.then(schedule).catch(() => {});
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
    };
  }, [words]);

  // ── Width: glide to the active word on each swap ──────────────────────────
  useEffect(() => {
    indexRef.current = index;
    const box = boxRef.current;
    const w = widths.current[index];
    if (box && w) box.style.width = `${w}px`;
  }, [index]);

  const previous = (index - 1 + words.length) % words.length;

  return (
    <>
      <span className="sr-only">{words[0]}</span>
      <span
        ref={boxRef}
        aria-hidden
        className={[
          "inline-grid select-none grid-cols-[minmax(0,1fr)] justify-items-center overflow-x-clip align-baseline",
          "transition-[width] duration-500 ease-out motion-reduce:transition-none",
          className,
        ]
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
