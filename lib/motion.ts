// ─────────────────────────────────────────────────────────────────────────────
// lib/motion.ts — the server-safe half of the scroll-reveal layer.
//
// NO "use client" HERE, and that is the point. Every export from a "use client"
// module becomes a client REFERENCE in the App Router, so a string exported
// from one cannot be inlined into the document head by a server component —
// you would get a module proxy where you wanted the script text. The boot
// script and the stagger helper therefore live here, and the component that
// needs the browser lives in components/motion/RevealObserver.tsx.
//
// See the block comment at the bottom of app/globals.css for the contract these
// two pieces implement, and why it fails safe.
// ─────────────────────────────────────────────────────────────────────────────

import type { CSSProperties } from "react";

/** Set by RevealObserver on mount; the boot script's failsafe watches for it. */
export const REVEAL_READY_ATTR = "data-reveal-ready";

/**
 * Runs in the document head, before the body paints, so nothing flashes from
 * visible to hidden.
 *
 * It refuses to engage without IntersectionObserver, adds the class that lets
 * the CSS hide things, and arms a 2-second failsafe: if RevealObserver has not
 * marked itself ready by then the bundle is broken or never arrived, so the
 * class comes back off and every pending element becomes visible. That is the
 * difference between "the animation did not run" and "the page is blank".
 */
export const REVEAL_BOOT_SCRIPT = `(function(){try{
if(!('IntersectionObserver' in window))return;
var r=document.documentElement;r.classList.add('reveal-js');
setTimeout(function(){if(!r.hasAttribute('${REVEAL_READY_ATTR}'))r.classList.remove('reveal-js');},2000);
}catch(e){}})();`;

/** Default step between staggered siblings, in milliseconds. */
const STAGGER_STEP_MS = 70;

/**
 * The cap is the important argument here. Without one, item 30 of a hall list
 * would wait 2.1 seconds after item 1 — the user has scrolled past it long
 * before it arrives, so the "animation" is just content that is late. Capping
 * the delay means a row or two carries the sense of sequence and everything
 * after it behaves like the rest of the page.
 */
const STAGGER_MAX_MS = 280;

/**
 * Inline style that staggers a reveal against its siblings.
 *
 *   {items.map((item, i) => (
 *     <Card key={item.id} data-reveal style={revealDelay(i)} />
 *   ))}
 *
 * Sets `--reveal-delay-base` rather than `--reveal-delay`: the stylesheet
 * derives the real delay from it, which is what lets the mobile media query
 * halve the stagger even though an inline style would otherwise win.
 */
export function revealDelay(
  index: number,
  step: number = STAGGER_STEP_MS,
  max: number = STAGGER_MAX_MS,
): CSSProperties {
  const ms = Math.min(Math.max(index, 0) * step, max);
  // The cast is unavoidable: React's CSSProperties does not model custom
  // properties, though the DOM accepts them.
  return { "--reveal-delay-base": `${ms}ms` } as CSSProperties;
}
