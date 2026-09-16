import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// The homepage hero.
//
// The hero IS the scroll walk-through: a pinned, scroll-scrubbed video with the
// headline over its opening frames and the search pill pinned at the bottom.
// It replaced a looping background video, which has been removed entirely.
// The walk-through's own mechanics and its video file are covered in
// scroll-scrub.test.ts; this file pins how the hero is assembled on the page,
// the navbar over it, and the search pill.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

const page       = read("app/page.tsx");
const css        = read("app/globals.css");
const observer   = read("components/motion/RevealObserver.tsx");
const navbar     = read("components/layout/Navbar.tsx");
const scrub      = read("components/sections/ScrollScrubVideo.tsx");
const heroSearch = read("components/sections/HeroSearch.tsx");
const halls      = read("lib/halls.ts");
const hallsPage  = read("app/halls/page.tsx");
const pkg        = JSON.parse(read("package.json"));

/** Source with comments stripped, so notes quoting old markup cannot pass or fail a test. */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
const pageCode = code(page);
const cssCode = code(css);

const desktopStart = pageCode.indexOf('className="hidden lg:block"');
const desktop = pageCode.slice(desktopStart);
const mobile = pageCode.slice(pageCode.indexOf('className="lg:hidden"'), desktopStart);

describe("the hero is the scroll walk-through", () => {
  it("opens the desktop tree, before anything else", () => {
    const hero = desktop.indexOf("<ScrollScrubVideo");
    expect(hero, "walk-through missing from the desktop tree").toBeGreaterThan(-1);
    expect(hero).toBeLessThan(desktop.indexOf("<section"));
  });

  it("appears exactly once — the separate lower block is gone", () => {
    expect(pageCode.match(/<ScrollScrubVideo/g)?.length).toBe(1);
  });

  it("carries the headline as intro and the search pill as footer", () => {
    const hero = desktop.slice(desktop.indexOf("<ScrollScrubVideo"), desktop.indexOf("/>", desktop.indexOf("footer={")) + 2);
    expect(hero).toContain("intro={");
    expect(hero).toContain("The hall you want,");
    expect(hero).toContain("footer={<HeroSearch");
  });

  it("keeps the search pill out of the part that fades", () => {
    // The intro fades out as scrubbing starts; the pill is the primary action
    // and must stay usable for the whole walk-through.
    const introStart = desktop.indexOf("intro={");
    const footerStart = desktop.indexOf("footer={");
    expect(desktop.slice(introStart, footerStart)).not.toContain("<HeroSearch");
  });

  it("reaches up under the header by its full height, border included", () => {
    // 64px left a 1px hairline of page background above the video, because
    // the header is 64px plus a 1px bottom border.
    expect(desktop).toContain('className="-mt-[calc(4rem+1px)]"');
  });

  it("names no venue — the footage is a generated hall, not a listing", () => {
    const hero = desktop.slice(desktop.indexOf("<ScrollScrubVideo"), desktop.indexOf("footer={"));
    expect(hero).not.toMatch(/Mahal|Kalyana|Khalyaana|Hall of/i);
  });
});

describe("the old looping hero is removed, not just hidden", () => {
  it("has no component, config or media left", () => {
    expect(exists("components/sections/HeroVideo.tsx")).toBe(false);
    expect(exists("lib/hero-video.ts")).toBe(false);
    for (const f of ["hero-1920.mp4", "hero-720.mp4", "hero-poster.jpg"]) {
      expect(exists(`public/hero/${f}`), `public/hero/${f} still ships`).toBe(false);
    }
  });

  it("is referenced nowhere on the page", () => {
    expect(pageCode).not.toContain("HeroVideo");
    expect(pageCode).not.toContain("HERO_VIDEO");
    expect(pageCode).not.toContain("/hero/hero-");
  });

  it("left no smooth-scroll hijacker behind", () => {
    // Lenis broke anchor links while it was here; native smooth scrolling does
    // the job without it.
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps)).not.toContain("lenis");
    expect(cssCode).toContain("scroll-behavior: smooth");
  });
});

describe("the mobile header band", () => {
  it("shows the walk-through's opening frame as a still", () => {
    // Not the scrub: pinning two screens of scroll in a ~225px app-shell band
    // would bury the search entry and cost ~5 MB of mobile data.
    expect(mobile).toContain('src="/scrub/hall-walkthrough-poster.jpg"');
    expect(mobile).not.toContain("<video");
    expect(mobile).not.toContain("<ScrollScrubVideo");
  });

  it("uses the heavier, measured shade for this brighter frame", () => {
    // On the current clip, 65% left the eyebrow only 16% above 4.5 over the
    // dusk sky; 70% gives 6.06:1.
    expect(mobile).toContain("from-charcoal-950/70 to-charcoal-950/50");
  });

  it("keeps white ink on the band", () => {
    expect(mobile.match(/"hero-ink text-white"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(mobile).toContain("<HomeLocation cities={citiesWithVenues} onDark />");
  });
});

describe("the navbar over the hero", () => {
  it("is transparent on the homepage only", () => {
    expect(navbar).toContain('pathname === "/"');
    expect(navbar).toContain("hallnect-header--over-hero");
  });

  it("stays transparent while the pinned hero is underneath it", () => {
    // Going solid after 24px would lay an opaque bar over the walk-through.
    expect(scrub).toContain('data-header-clear=""');
    expect(observer).toContain('document.querySelector("[data-header-clear]")');
    expect(observer).toContain("const scrolled = !held && ");
  });

  it("goes solid as soon as the hero starts to release, not when it is gone", () => {
    // Held until fully gone, white nav text would sit over the bright bottom
    // of the last frame — outside the top shade — for a screen of scrolling.
    expect(observer).toContain("hold.getBoundingClientRect().bottom > window.innerHeight + 1");
  });

  it("drops backdrop-filter while transparent", () => {
    expect(cssCode).toMatch(/\.hallnect-header--over-hero\s*\{[^}]*backdrop-filter:\s*none/);
  });

  it("fades its ink with its surface rather than snapping", () => {
    expect(cssCode).toMatch(/\.hallnect-header a,[\s\S]*?text-shadow 320ms/);
  });
});

describe("every field in the search pill is real", () => {
  // This codebase has already shipped one prominent dead control: the city
  // picker wrote a localStorage key nothing read.
  it("maps each control to a parameter /halls actually reads", () => {
    for (const param of ["city", "date", "dateTo", "capacity"]) {
      expect(heroSearch, `${param} is not submitted`).toContain(`"${param}"`);
      expect(hallsPage, `/halls does not read ${param}`).toContain(param);
    }
  });

  it("backs Available Till with a real range query", () => {
    expect(halls).toContain("dateTo");
    expect(halls).toMatch(/\.gte\("date"/);
    expect(halls).toMatch(/\.lte\("date"/);
  });

  it("excludes a hall blocked on ANY day of the range", () => {
    expect(halls).toContain("FULL_BLOCK_STATUSES");
    expect(halls).toContain("useRange");
  });

  it("never sends a range without its start", () => {
    expect(heroSearch).toContain('params.has("date")');
  });

  it("offers only cities that hold inventory", () => {
    expect(heroSearch, "back on the hardcoded mock list").not.toContain("mock-data");
    expect(pageCode).toContain("<HeroSearch cities={citiesWithVenues.map((c) => c.city)}");
  });

  it("takes today from the server, not the visitor's clock", () => {
    expect(pageCode).toContain("todayInBusinessTz()");
  });

  it("is a pill with four cells, three dividers and a round submit", () => {
    expect(heroSearch).toContain("rounded-full");
    expect(heroSearch.match(/w-px shrink-0/g)?.length).toBe(3);
    expect(heroSearch).toContain("h-14 w-14 shrink-0");
  });

  it("labels every control", () => {
    expect(heroSearch.match(/htmlFor=/g)?.length).toBeGreaterThanOrEqual(4);
    expect(heroSearch).toContain('aria-label="Search"');
  });

  it("shows focus per cell, not just around the whole pill", () => {
    expect(heroSearch).toContain("focus-within:ring-2");
    const form = heroSearch.slice(heroSearch.indexOf("<form"));
    expect(form.slice(0, form.indexOf(">"))).not.toContain("focus-within:ring");
  });
});

describe("the category row", () => {
  it("has as many columns as tiles, so no gap opens on the right", () => {
    // grid-cols-8 with six categories left 308px empty, measured at 1440px.
    expect(desktop).toContain("grid-cols-[repeat(var(--cat-cols),minmax(0,1fr))]");
    expect(desktop).toContain('"--cat-cols": visibleCategories.length');
  });

  it("no longer reserves room for a pill that used to overhang it", () => {
    const cats = desktop.slice(desktop.indexOf("visibleCategories.map") - 400, desktop.indexOf("visibleCategories.map"));
    expect(cats).toContain('className="container-page py-12"');
  });
});
