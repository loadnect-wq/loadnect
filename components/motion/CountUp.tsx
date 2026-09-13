"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Animates a number up to its real value when it scrolls into view.
//
// IT ONLY EVER COUNTS TO A VALUE THE PAGE ALREADY HAD. The `value` prop is the
// figure the server rendered; nothing here invents, rounds up or embellishes a
// statistic. A marketplace that animates a made-up number is lying with motion.
//
// THE RENDERED OUTPUT IS ALWAYS THE FINAL VALUE. React renders the real figure
// and never re-renders it: the count is written straight to the text node with
// requestAnimationFrame. That buys three things at once —
//
//   * the server HTML is correct, so a crawler and a JS-less reader see the
//     truth, and the number is never briefly a zero that isn't true;
//   * no state, so no cascading renders and nothing for the react-hooks
//     set-state-in-effect rule to object to;
//   * a counting number cannot re-render its parent card sixty times a second.
//
// If anything at all goes wrong, the text simply stays at the real value.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";

/** Matches formatPrice() in lib/mock-data.ts when prefix is "₹". */
function format(n: number, prefix: string, suffix: string): string {
  return prefix + Math.round(n).toLocaleString("en-IN") + suffix;
}

interface Props {
  /** The real, already-computed value. Rendered as-is on the server. */
  value: number;
  /**
   * Put in front of every frame — "₹" for money.
   *
   * A STRING AND NOT A FORMATTER FUNCTION, deliberately. Most callers are
   * Server Components, and a function cannot cross that boundary: passing
   * `formatPrice` here would be a runtime serialization error rather than a
   * type error. Prefix plus the en-IN grouping below reproduces formatPrice()
   * exactly, which is what these numbers were already rendered with.
   */
  prefix?: string;
  suffix?: string;
  /** Milliseconds for the full count. */
  duration?: number;
  className?: string;
}

export function CountUp({ value, prefix = "", suffix = "", duration = 1400, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  // Once this element has begun counting it never counts again, so a re-render
  // mid-count can never snap the number back to zero and start it over.
  const spent = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const render = (n: number) => {
      el.textContent = format(n, prefix, suffix);
    };

    // ALREADY COUNTED. Write the value we were just given and stop: this
    // effect re-runs when `value` changes, and on that path React has already
    // put the new figure in the text node. Returning without rendering was a
    // bug — paired with the cleanup below it left the OLD number on screen
    // permanently, so a dashboard figure could go stale and look confident.
    if (spent.current) {
      render(value);
      return;
    }

    // Four reasons to leave the real figure exactly where it is: a
    // reduced-motion reader, a browser with no observer, a value that isn't a
    // number, and a zero there is no point counting to.
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      !Number.isFinite(value) ||
      value === 0
    ) {
      return;
    }

    let raf = 0;

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || spent.current) return;
        spent.current = true;
        io.disconnect();

        // Drop to zero only at the instant the count actually begins, so the
        // real number is on screen for every frame before this one.
        render(0);
        const begin = performance.now();
        const step = (now: number) => {
          const t = Math.min((now - begin) / duration, 1);
          // The same decelerate curve as the scroll reveals, so a counter
          // finishing inside a card that is still settling reads as one move.
          if (t < 1) {
            render(value * (1 - Math.pow(1 - t, 3)));
            raf = requestAnimationFrame(step);
          } else {
            render(value); // land exactly on the real figure
          }
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );

    io.observe(el);

    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
      // NOTHING IS RENDERED HERE ON PURPOSE. This closure's `value` is the
      // value at the time this effect ran, which on a value change is the old
      // one — writing it back is how the figure used to freeze. React has
      // already committed the new text by the time a cleanup runs, and on
      // unmount there is no node left to correct.
    };
  }, [value, duration, prefix, suffix]);

  return (
    <span ref={ref} className={className}>
      {format(value, prefix, suffix)}
    </span>
  );
}
