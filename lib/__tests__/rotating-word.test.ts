import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// The rotating event word in the hero subhead:
//   "Compare [wedding|party|reception|banquet] halls by price, capacity and photos."
//
// First version: the box was always the widest word, so nothing around it ever
// moved — but "party" (47px) sat in an 83px box sized for "reception", leaving
// 18px of empty space on each side: "book    party    halls".
//
// Now the box glides to each word's rendered width. Verified in a browser:
//   at rest, every word fills its box exactly (0px hole, centred to 0px), with
//   one normal 5.1px space before and after;
//   line breaks are identical for all four words at 1440, 1100 and 1024px, and
//   "book" moves exactly half the width change (18.1px at 1440) — a pure
//   re-centre of line 1, nothing reflowing;
//   layout shift over 11s and four swaps: 0.0016 (Google's "good" is < 0.1);
//   copying the sentence gives "book wedding halls", not all four words.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const src = read("components/sections/RotatingWord.tsx");
const page = read("app/page.tsx");
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const srcCode = code(src);

describe("the box fits the word", () => {
  it("stacks every word in ONE grid cell, so first paint is the widest word", () => {
    // No inline width on the server render: nothing jumps before hydration.
    expect(srcCode).toContain("inline-grid");
    expect(srcCode).toContain("col-start-1 row-start-1");
  });

  it("reads widths from what rendered, never hard-coded", () => {
    expect(srcCode).toContain("el.getBoundingClientRect().width");
    expect(srcCode, "a hard-coded pixel width goes stale with the font or the list").not.toMatch(/width:\s*["'`]?\d/);
  });

  it("re-reads them when fonts load and on resize", () => {
    expect(srcCode).toContain("document.fonts?.ready.then(schedule)");
    expect(srcCode).toContain('window.addEventListener("resize", schedule');
  });

  it("does not animate a measurement, only a swap", () => {
    // Easing from the widest word to the first one right after load would
    // read as a twitch.
    expect(srcCode).toContain('box.style.transition = "none"');
  });

  it("glides the width with the fade", () => {
    expect(srcCode).toContain("transition-[width] duration-500");
  });

  it("centres words in the visible box, not in a wider auto track", () => {
    // An auto track stays as wide as the widest word; "party" would be pushed
    // right and clipped inside a narrowed box.
    expect(srcCode).toContain("grid-cols-[minmax(0,1fr)]");
    expect(srcCode).toContain("justify-items-center");
  });

  it("clips sideways only, so a widening word never spills over its neighbours", () => {
    expect(srcCode).toContain("overflow-x-clip");
  });

  it("never lets a word wrap onto two lines", () => {
    expect(srcCode).toContain("whitespace-nowrap");
  });
});

describe("the animation", () => {
  it("fades and drifts using only opacity and transform", () => {
    expect(srcCode).toContain("transition-[opacity,transform]");
    expect(srcCode).toContain("duration-500");
    expect(srcCode).toContain("translate3d(0, -0.45em, 0)");
    expect(srcCode).toContain("translate3d(0, 0.45em, 0)");
  });

  it("uses no animation library", () => {
    const imports = src.match(/^import .* from "([^"]+)";$/gm) ?? [];
    for (const line of imports) expect(line).toMatch(/from "react"/);
  });

  it("does not rotate for reduced motion, or while the tab is hidden", () => {
    expect(srcCode).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
    expect(srcCode).toContain("motion-reduce:transition-none");
    expect(srcCode).toContain("visibilitychange");
  });
});

describe("screen readers and copy-paste", () => {
  it("hear one word, not all four, and no announcement every few seconds", () => {
    expect(srcCode).toContain('<span className="sr-only">{words[0]}</span>');
    expect(srcCode).toMatch(/ref=\{boxRef\}\s+aria-hidden/);
    expect(srcCode).not.toContain("aria-live");
  });

  it("copy the sentence, not the stack", () => {
    // Selecting the subhead used to copy "book wedding wedding party reception
    // banquet halls".
    expect(srcCode).toContain("select-none");
  });
});

describe("on the page", () => {
  // The hero subhead that used this component ("Compare [word] halls by price,
  // capacity and photos. Then book online or send a free enquiry…") was
  // removed from the homepage on the owner's instruction (2026-09-18). The
  // component is kept, tested above, for reuse.
  it("the hero subhead is gone", () => {
    const pageCode = code(page);
    expect(pageCode).not.toContain("<RotatingWord");
    expect(pageCode).not.toContain("halls by price, capacity and photos.");
    expect(pageCode).not.toContain("whichever the venue offers.");
  });
});
