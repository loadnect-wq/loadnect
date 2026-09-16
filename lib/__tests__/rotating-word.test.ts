import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// The rotating event word in the hero subhead:
//   "Discover, compare, and book [wedding|party|reception|banquet] halls…"
//
// Verified in a browser at 1440x900 over 11s and four swaps: the text after the
// word stayed at exactly the same pixel (x=750.31, y=431.42), the reserved box
// never changed width (82.8px — "reception" as rendered at 600 18px), the
// paragraph height never changed, and opacity was caught mid-transition.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const src = read("components/sections/RotatingWord.tsx");
const page = read("app/page.tsx");
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const srcCode = code(src);

describe("no layout shift", () => {
  it("stacks every word in ONE grid cell, so the box is the widest word", () => {
    expect(srcCode).toContain("inline-grid");
    expect(srcCode).toContain("col-start-1 row-start-1");
  });

  it("measures nothing — no width that can go stale with the font or the list", () => {
    for (const api of ["getBoundingClientRect", "offsetWidth", "scrollWidth", "ResizeObserver"]) {
      expect(srcCode, `${api} — the grid already sizes the box`).not.toContain(api);
    }
    expect(srcCode).not.toMatch(/width:\s*["'`]?\d/);
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

describe("screen readers", () => {
  it("hear one word, not all four, and no announcement every few seconds", () => {
    expect(srcCode).toContain('<span className="sr-only">{words[0]}</span>');
    expect(srcCode).toMatch(/<span\s+aria-hidden/);
    expect(srcCode).not.toContain("aria-live");
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

  it("stays white, not gold — normal-size text needs 4.5:1", () => {
    expect(page).toContain('<RotatingWord words={HERO_EVENT_WORDS} className="font-semibold text-white" />');
  });
});
