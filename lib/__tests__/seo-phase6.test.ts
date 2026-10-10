import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BELOW_LG, LG_UP, NO_IMAGE_SRCSET } from "../responsive-image";

// ─────────────────────────────────────────────────────────────────────────────
// SEO phase 6 (2026-10-10): performance, on a phone.
//
// Measured before changing anything (Lighthouse mobile, and a real Chrome at
// Lighthouse's phone + slow-4G settings), the main image on each page was
// either held back by an entrance fade or competing with script and fonts it
// did not need:
//   • the home hero card and the first listing card faded up from opacity 0,
//     and Chrome does not count an image as painted until it is visible —
//     the city page's main image landed ~0.7s after the page first painted;
//   • the home page preloaded BOTH hero images (phone card and desktop
//     poster) on every device, with no priority hint (audit #19);
//   • framer-motion (139 KB) ran on the home page for one desktop-only word;
//   • the Supabase client (222 KB) was in every page's start-up script,
//     because the header — on every page — imported it to ask who is signed in;
//   • the italic Playfair (38 KB) was preloaded on every page for two uses.
// These tests keep each of those from coming back.
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
// Checkouts on Windows are CRLF; every pattern below is written with \n.
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const home = code("app/page.tsx");
const mobileTree = home.slice(home.indexOf('<div className="lg:hidden">'), home.indexOf('<div className="hidden lg:block">'));

describe("the main image is visible from the first frame", () => {
  it("the phone hero card does not fade in; only its photo zooms and its text rises", () => {
    const card = mobileTree.slice(mobileTree.indexOf('<section className="container-app pt-2">'));
    const cardOpen = card.slice(card.indexOf("<div"), card.indexOf(">", card.indexOf("<div")) + 1);
    expect(cardOpen).toBe('<div className="relative overflow-hidden rounded-[28px] bg-charcoal-950">');
    expect(card).toContain("<div data-hero-zoom");
    expect(card).toContain('<div data-hero style={heroDelay(0)} className="relative flex min-h-[272px]');
  });

  it("the photo entrances animate scale only — never opacity", () => {
    const css = read("app/globals.css");
    for (const name of ["hallnect-photo-in", "hallnect-hero-zoom"]) {
      const block = css.slice(css.indexOf(`@keyframes ${name}`), css.indexOf("}\n}", css.indexOf(`@keyframes ${name}`)));
      expect(block, name).toContain("transform");
      expect(block, name).not.toContain("opacity");
    }
  });

  it("the first listing card is never hidden; only its photo animates", () => {
    const card = code("app/halls/_components/HallCard.tsx");
    expect(card).toMatch(/: eager\s*\?\s*\{ "data-photo-in": "", style: revealDelay\(revealIndex\) \}/);
    // Both listing pages mark exactly the first card eager.
    for (const f of ["app/halls/(browse)/page.tsx", "app/wedding-halls/[city]/page.tsx"]) {
      expect(code(f), f).toContain("eager={i === 0}");
    }
  });
});

describe("one hero image per layout, fetched first", () => {
  it("the phone card's photo is not downloaded at desktop sizes", () => {
    expect(mobileTree).toContain("<source media={LG_UP} srcSet={NO_IMAGE_SRCSET} />");
    expect(mobileTree).toMatch(/src="\/scrub\/hall-walkthrough-poster\.jpg"[\s\S]{0,80}loading="eager"\s+fetchPriority="high"/);
  });

  it("the desktop poster is not downloaded at phone sizes", () => {
    expect(home).toMatch(/<ScrollScrubVideo[\s\S]{0,200}posterMedia=\{LG_UP\}/);
    const scrub = code("components/sections/ScrollScrubVideo.tsx");
    expect(scrub).toContain("<source media={`not all and ${posterMedia}`} srcSet={NO_IMAGE_SRCSET} />");
    expect(scrub).toMatch(/loading="eager"\s+fetchPriority="high"/);
  });

  it("neither uses `priority` — in Next 16 that is a head preload with no screen-size condition", () => {
    expect(mobileTree).not.toMatch(/^\s*priority\s*$/m);
    expect(code("components/sections/ScrollScrubVideo.tsx")).not.toMatch(/^\s*priority\s*$/m);
  });

  it("the two media queries split the screen sizes with no gap and no overlap", () => {
    expect(LG_UP).toBe("(min-width: 1024px)");
    expect(BELOW_LG).toBe(`not all and ${LG_UP}`);
    expect(NO_IMAGE_SRCSET).toMatch(/^data:image\/gif;base64,[A-Za-z0-9+/=]+$/);
  });
});

describe("no script a page does not need at start-up", () => {
  it("the homepage's rotating word uses CSS keyframes, not framer-motion", () => {
    const word = code("components/sections/HeroOccasionWord.tsx");
    expect(word).not.toMatch(/framer-motion|motion\/react/);
    expect(word).toContain("const SWAP_MS = 450;");
    const css = read("app/globals.css");
    expect(css).toContain(".occasion-in  { animation: occasion-in 450ms");
    expect(css).toContain(".occasion-out { animation: occasion-out 450ms");
  });

  it("nothing in the homepage tree imports framer-motion", () => {
    // The page and every component module it imports directly.
    const imports = [...home.matchAll(/from "(@\/components\/[^"]+|\.\/_components\/[^"]+|@\/app\/[^"]+)"/g)].map((m) => m[1]);
    for (const spec of imports) {
      const base = spec.replace(/^@\//, "").replace(/^\.\//, "app/");
      const file = [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`].find((f) => {
        try { return statSync(join(root, f)).isFile(); } catch { return false; }
      });
      if (file) expect(code(file), file).not.toMatch(/from ["'](framer-motion|motion\/react)["']/);
    }
  });

  it("the Supabase client loads on demand from the header and the live calendar", () => {
    for (const f of ["components/layout/Navbar.tsx", "lib/useLiveAvailability.ts"]) {
      const src = code(f);
      expect(src, f).not.toMatch(/^import [^;]*from "@\/lib\/supabase\/client";/m);
      expect(src, f).toContain('import("@/lib/supabase/client").then(');
    }
  });

  it("no other shared-layout component imports the Supabase client statically", () => {
    const layout = code("app/layout.tsx");
    const shared = [...layout.matchAll(/from "@\/(components\/[^"]+)"/g)].map((m) => `${m[1]}.tsx`);
    expect(shared.length).toBeGreaterThan(3);
    for (const f of shared) {
      try { statSync(join(root, f)); } catch { continue; }
      expect(code(f), f).not.toMatch(/^import [^;]*from "@\/lib\/supabase\/client";/m);
    }
  });
});

describe("fonts", () => {
  it("only the upright faces are preloaded site-wide", () => {
    const site = code("app/fonts/site-fonts.ts");
    expect(site).not.toContain("Italic");
    expect(site).not.toContain('style: "italic"');
  });

  it("the italic loads on demand, and only the two places that use it import it", () => {
    expect(code("app/fonts/playfair-italic.ts")).toContain("preload: false");
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(root, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(join(root, rel)).isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(name) && read(rel).includes("fonts/playfair-italic")) users.push(rel);
      }
    };
    walk("app");
    walk("components");
    expect(users.sort()).toEqual(["app/(auth)/login/page.tsx", "components/sections/HeroOccasionWord.tsx"]);
    // Each applies the font to the italic word itself.
    expect(code("components/sections/HeroOccasionWord.tsx")).toContain("playfairItalic.className");
    expect(code("app/(auth)/login/page.tsx")).toContain("${playfairItalic.className}");
  });
});
