"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The one piece of JavaScript behind every scroll reveal in the app.
//
// Mounted ONCE in the root layout. It watches for elements carrying
// `data-reveal` and sets `data-revealed` on them when they enter the viewport;
// app/globals.css does the rest. Nothing else in the codebase has to import
// anything, and no page pays a per-element JavaScript cost — a server component
// adds an attribute and gets the animation.
//
// WHY NOT framer-motion's whileInView, which is already installed. Because it
// server-renders the initial state: `initial={{ opacity: 0 }}` ships
// `style="opacity:0"` in the HTML. If the bundle fails, hydration throws, or a
// crawler does not run scripts, the content is invisible with nothing to undo
// it. This is a marketplace whose listings are the product and the SEO. Here
// the hidden state is applied only under `.reveal-js`, which only JavaScript
// can add — so the failure mode is "no animation", never "no content".
//
// framer-motion stays where it already is (page-level entrance transitions);
// this is for the scroll layer, which is everywhere.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { REVEAL_READY_ATTR } from "@/lib/motion";

export function RevealObserver() {
  useEffect(() => {
    const root = document.documentElement;

    // If the head script decided against it (no IntersectionObserver), it never
    // added the class and nothing is hidden — there is nothing to do.
    if (!("IntersectionObserver" in window)) {
      root.classList.remove("reveal-js");
      return;
    }

    // Cancels the head script's failsafe: we are here, the observer works.
    root.setAttribute(REVEAL_READY_ATTR, "");

    // Every element that finished revealing and is waiting to be cleaned up.
    const pending = new Set<number>();

    /**
     * LEAVE NO TRACE. Once the transition has run, both attributes come off, so
     * not one of the reveal rules in globals.css matches this element any more.
     *
     * That is what makes it safe to put `data-reveal` on something that also
     * has a hover effect. The rules only ever assert `transform` while hidden,
     * so the hover itself was never at risk — but the `transition` on the base
     * selector is unlayered, and it would otherwise outrank a `transition-all`
     * utility and stretch a 150ms hover into a 560ms one for the life of the
     * page. After this runs, the element is byte-for-byte what it would have
     * been without any of this.
     *
     * A timer rather than `transitionend`: reduced motion sets
     * `transition: none`, which fires no such event, and a listener per element
     * is more bookkeeping than a number. 1000ms clears the worst case (560ms
     * duration + 280ms stagger).
     */
    function scheduleCleanup(el: Element) {
      const id = window.setTimeout(() => {
        pending.delete(id);
        el.removeAttribute("data-reveal");
        el.removeAttribute("data-revealed");
      }, 1000);
      pending.add(id);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-revealed", "");
          // ONE-SHOT. Nothing re-hides on the way back up: re-animating content
          // a user has already read is the exact thing that makes a scroll
          // effect feel gimmicky, and it doubles the work for no gain.
          observer.unobserve(entry.target);
          scheduleCleanup(entry.target);
        }
      },
      {
        // THE HUGE TOP MARGIN IS A BUG FIX, NOT A TUNING CHOICE.
        //
        // IntersectionObserver only calls back when `isIntersecting` CHANGES.
        // Jump the scroll position — the End key, dragging the scrollbar, an
        // anchor link, a restored scroll position on back-navigation — and an
        // element goes straight from "below the viewport" to "above the
        // viewport" without ever being reported as intersecting: false to
        // false, no callback, and it stays at opacity 0 for the life of the
        // page. Measured: five elements stranded invisible after one
        // instant jump down a page.
        //
        // Extending the root 99999px upward means anything at or above the
        // viewport is permanently inside it, so a passed-over element is
        // reported the moment it is evaluated and reveals. The bottom stays at
        // -10% so content still waits until it is genuinely approaching.
        // Cheaper and steadier than a scroll listener, which the brief rules
        // out anyway.
        rootMargin: "99999px 0px -10% 0px",
        // A sliver is enough. Requiring more would never fire for an element
        // taller than the viewport.
        threshold: 0.01,
      },
    );

    // No bookkeeping set. IntersectionObserver.observe() on a target it is
    // already watching is a no-op per spec, so re-scanning is free and cannot
    // double-register — and NOT tracking is what makes the re-observe below
    // correct, since an element whose attribute came back has to be picked up
    // again even though it was seen once before.
    function observe(scope: ParentNode) {
      const nodes = scope.querySelectorAll?.("[data-reveal]:not([data-revealed])");
      if (!nodes) return;
      for (const node of nodes) observer.observe(node);
    }

    observe(document);

    // TWO THINGS ARRIVE LATE, and missing either one strands content at
    // opacity 0 — which on this product means a blank listing grid.
    //
    // childList: content added after the first paint — a filtered hall list, a
    //   dashboard tab, anything streamed in by a Suspense boundary.
    //
    // attributeFilter: `data-reveal` COMING BACK. scheduleCleanup takes the
    //   attribute off when the animation finishes, but React still believes it
    //   rendered one; the moment that element re-renders, React writes the
    //   attribute back onto a node this observer has already finished with and
    //   stopped watching. Caught in the browser: the footer grid sat at
    //   opacity 0 in the middle of the viewport after a re-render, with nothing
    //   left to reveal it. Watching the attribute closes that loop.
    //   No feedback loop: cleanup REMOVES the attribute, so the re-scan it
    //   triggers matches nothing, and `data-revealed` is not in the filter.
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          const el = record.target as Element;
          if (el.hasAttribute("data-reveal") && !el.hasAttribute("data-revealed")) {
            observer.observe(el);
          }
          continue;
        }
        for (const added of record.addedNodes) {
          if (added.nodeType !== Node.ELEMENT_NODE) continue;
          const el = added as Element;
          if (el.hasAttribute("data-reveal") && !el.hasAttribute("data-revealed")) {
            observer.observe(el);
          }
          observe(el);
        }
      }
    });
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributeFilter: ["data-reveal"],
    });

    // ── The guarantee ────────────────────────────────────────────────────────
    //
    // Everything above is an optimisation. THIS is what makes the feature safe.
    //
    // IntersectionObserver only delivers its callbacks as part of the browser's
    // rendering steps. Anything that suspends rendering — a throttled or
    // occluded tab, a compositor that has stopped painting, an embedded webview
    // — suspends the reveals with it, and content that is merely waiting to be
    // revealed is content that is blank. I could not rule that out in testing,
    // and on a marketplace the failure mode is an empty listings grid, so
    // correctness must not depend on the observer firing at all.
    //
    // A single passive, rAF-coalesced scroll/resize listener sweeps whatever is
    // still pending and reveals anything that has reached the viewport. It is
    // NOT the per-element scroll handling the brief rules out: one listener,
    // one rect read per element still waiting, and the whole thing detaches
    // itself the moment nothing is left to reveal.
    let frame = 0;
    function sweep() {
      frame = 0;
      const waiting = document.querySelectorAll("[data-reveal]:not([data-revealed])");
      if (waiting.length === 0) {
        // Nothing left anywhere on the page: stop listening entirely.
        window.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", schedule);
        return;
      }
      const limit = window.innerHeight;
      for (const el of waiting) {
        // Top edge has reached the viewport — or is above it, which is the case
        // IntersectionObserver misses when the scroll position jumps.
        if (el.getBoundingClientRect().top < limit) {
          el.setAttribute("data-revealed", "");
          observer.unobserve(el);
          scheduleCleanup(el);
        }
      }
    }
    function schedule() {
      if (frame) return;
      frame = window.requestAnimationFrame(sweep);
    }
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    return () => {
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      for (const id of pending) window.clearTimeout(id);
      pending.clear();
      root.removeAttribute(REVEAL_READY_ATTR);
    };
  }, []);

  return null;
}
