"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/motion/SmoothScroll.tsx — wheel easing on desktop, and nothing at
// all anywhere else.
//
// ════════════════════════════════════════════════════════════════════════════
// WHAT THIS DOES AND DOES NOT TOUCH
// ════════════════════════════════════════════════════════════════════════════
// Lenis intercepts the WHEEL and eases the scroll position toward its target,
// which is what turns a trackpad's notchy delta into a glide. It runs in
// "window" mode: it calls window.scrollTo and never transforms a wrapper, so it
// cannot re-parent the sticky headers or the portalled bottom sheet — the trap
// that this codebase has now hit twice.
//
// TOUCH IS LEFT ALONE, DELIBERATELY. `syncTouch` stays off and the whole thing
// is gated behind a pointer:fine media query, so a phone gets the browser's own
// scrolling. Easing touch means running JS on every touchmove to fight a
// gesture the OS already handles on the compositor — it reads as lag, it drains
// battery, and it breaks pull-to-refresh and the iOS address-bar collapse.
//
// REDUCED MOTION TURNS IT OFF ENTIRELY. Someone who has asked their OS to stop
// animations has not asked for their scrolling to be reinterpreted.
//
// ════════════════════════════════════════════════════════════════════════════
// SCROLL SENSITIVITY
// ════════════════════════════════════════════════════════════════════════════
// Two numbers, both below:
//   lerp       0.06 slow and floaty ... 0.2 tight and close to native.
//   wheelMultiplier   how much distance one wheel notch buys.
// Start by changing `lerp` alone. If it feels like the page lags behind the
// cursor, raise it; the default here is deliberately nearer "native" than the
// showreel setting, because this is a booking site and a search result that
// glides for 800ms is a search result you cannot click.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";

export function SmoothScroll() {
  useEffect(() => {
    // pointer:fine is the honest test for "has a mouse or trackpad". A width
    // breakpoint would catch a tablet in landscape and a phone in a desktop-mode
    // browser, both of which scroll by touch.
    const fine = window.matchMedia("(pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || reduced.matches) return;

    let lenis: { raf: (t: number) => void; destroy: () => void } | null = null;
    let frame = 0;
    let cancelled = false;

    // Loaded on demand so the ~3KB never reaches a phone, which is the majority
    // of this site's traffic and the one case that gains nothing from it.
    import("lenis")
      .then(({ default: Lenis }) => {
        if (cancelled) return;

        // globals.css:82 sets `scroll-behavior: smooth` and the root layout
        // carries data-scroll-behavior="smooth". Both fight Lenis for the same
        // job — the native smooth scroll animates to a target while Lenis is
        // also animating to it, and the result stutters. Lenis is told to
        // manage it, which sets scroll-behavior:auto for as long as it lives
        // and restores it on destroy.
        lenis = new Lenis({
          autoRaf: false,          // driven below, so it can be stopped cleanly
          lerp: 0.12,              // ← sensitivity: 0.06 floaty … 0.2 near-native
          wheelMultiplier: 1,      // ← distance per wheel notch
          syncTouch: false,        // touch stays native. See the header.

          // NOT OPTIONAL — measured. Lenis owns the scroll position, so a
          // native anchor jump is overwritten by its next eased frame and the
          // link does nothing at all. On /owner/register the "Register" CTA
          // targets #register at y=2168 and the page stayed at y=0; the skip
          // link in layout.tsx (href="#main") fails the same way, which is a
          // keyboard-accessibility regression, not a nicety.
          //
          // `anchors` makes Lenis intercept the click and scroll there itself,
          // so the jump goes through its own animation instead of fighting it.
          anchors: true,
        }) as unknown as { raf: (t: number) => void; destroy: () => void };

        const raf = (time: number) => {
          lenis?.raf(time);
          frame = window.requestAnimationFrame(raf);
        };
        frame = window.requestAnimationFrame(raf);
      })
      .catch(() => {
        // The chunk failed. Native scrolling is already working — there is
        // nothing to fall back to and nothing worth telling the user.
      });

    // If the OS setting changes mid-session, honour it without a reload.
    const onReducedChange = () => {
      if (reduced.matches) {
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
        lenis?.destroy();
        lenis = null;
      }
    };
    reduced.addEventListener("change", onReducedChange);

    return () => {
      cancelled = true;
      reduced.removeEventListener("change", onReducedChange);
      if (frame) window.cancelAnimationFrame(frame);
      lenis?.destroy();
    };
  }, []);

  return null;
}
