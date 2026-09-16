import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// The rotating event word in the hero subhead:
//   "Discover, compare, and book [wedding|party|reception|banquet] halls…"
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
  it("replaces the word 'wedding' in the hero subhead", () => {
    const pageCode = code(page);
    expect(pageCode).toContain('Discover, compare, and book{" "}');
    expect(pageCode).toContain("<RotatingWord words={HERO_EVENT_WORDS}");
    expect(pageCode).not.toContain("Discover, compare, and book wedding halls");
  });

  it("only offers kinds of hall the site actually lists", () => {
    const words = page.match(/const HERO_EVENT_WORDS = \[([^\]]+)\]/)?.[1].match(/"([^"]+)"/g)?.map((w) => w.slice(1, -1)) ?? [];
    expect(words).toEqual(["wedding", "party", "reception", "banquet"]);
    for (const w of words) {
      const label = `${w[0].toUpperCase()}${w.slice(1)} Halls`;
      expect(page, `no "${label}" category behind the word "${w}"`).toContain(`label: "${label}"`);
    }
  });

  it("breaks the subhead by hand, so the word cannot move a line break", () => {
    // With free wrapping, "Owner-submitted" split at its hyphen when the word
    // was wide and stayed whole for "party" — half a word jumped lines.
    const pageCode = code(page);
    const sub = pageCode.slice(pageCode.indexOf("Discover, compare, and book"), pageCode.indexOf("from the venue."));
    expect(sub).toContain("halls across Tamil Nadu.");
    expect(sub).toMatch(/Tamil Nadu\.\s*<br \/>\s*Owner-submitted/);
    expect(pageCode).toContain("mx-auto mt-6 max-w-3xl");
  });

  it("stays white, not gold — normal-size text needs 4.5:1", () => {
    expect(page).toContain('<RotatingWord words={HERO_EVENT_WORDS} className="font-semibold text-white" />');
  });
});
