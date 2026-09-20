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
const mobileSearch = read("app/_components/MobileSearch.tsx");
const calendar   = read("components/sections/DateRangeCalendar.tsx");
const searchUrl  = read("lib/search-url.ts");
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
    expect(hero).toContain("starts with the right hall.");
    expect(hero).toContain("<HeroOccasionWord />");
    expect(hero).toMatch(/footer=\{\s*<HeroSearch/);
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

describe("the mobile hero card", () => {
  it("shows the walk-through's opening frame as a still", () => {
    // Not the scrub: pinning two screens of scroll on a phone would bury the
    // search and cost ~5 MB of mobile data.
    expect(mobile).toContain('src="/scrub/hall-walkthrough-poster.jpg"');
    expect(mobile).not.toContain("<video");
    expect(mobile).not.toContain("<ScrollScrubVideo");
  });

  it("uses the measured bottom-heavy shade", () => {
    // Measured on the poster cropped to the 343x272 card at 375px: H1 7.29:1
    // (bar 3.0), subline 14.23:1. The top stays light over the sky.
    expect(pageCode).toContain(
      '"linear-gradient(to bottom, rgba(26,22,20,0.20) 0%, rgba(26,22,20,0.45) 30%, rgba(26,22,20,0.80) 60%, rgba(26,22,20,0.90) 100%)"',
    );
    expect(mobile).toContain("style={{ background: MOBILE_HERO_SHADE }}");
  });

  it("puts the eyebrow on its own dark pill — the sky under it is that bright", () => {
    // Without the pill the eyebrow scored 2.05:1 against a 4.5 bar; on a 55%
    // pill, 7.82:1.
    const eyebrow = mobile.slice(mobile.lastIndexOf("<p", mobile.indexOf("Plan your celebration")));
    expect(eyebrow.slice(0, eyebrow.indexOf(">"))).toContain("bg-charcoal-950/55");
  });

  it("keeps the H1 in the mobile tree, in white", () => {
    const h1 = mobile.slice(mobile.indexOf("<h1"));
    expect(h1.slice(0, h1.indexOf(">"))).toContain("text-white");
    // WIDENED when Hallnect stopped being a wedding-only marketplace, but
    // "Wedding" still LEADS — this is the H1 Google indexes and the phrase the
    // ranking pages were built on. Both halves are pinned: the lead word, so a
    // future rewrite cannot quietly drop it, and the breadth, so the page does
    // not slide back to wedding-only.
    expect(h1).toContain("Wedding, Party &amp; Event Halls in Tamil Nadu");
    expect(h1.indexOf("Wedding")).toBeLessThan(h1.indexOf("Event"));
    expect(desktop).not.toContain("<h1");
  });

  it("overlaps the search card onto the photo, above the fold", () => {
    expect(mobile).toMatch(/className="relative z-10 -mt-10 px-2">\s*<MobileSearch/);
  });

  it("dropped the controls that only looked like search", () => {
    for (const gone of ["HomeSearchEntry", "HomeLocation", "CategoryRow", "CitiesRow"]) {
      expect(page, `${gone} is back`).not.toContain(gone);
      expect(exists(`app/_components/${gone}.tsx`), `${gone}.tsx is back`).toBe(false);
    }
  });
});

describe("the rest of the phone homepage", () => {
  it("lays hall types out as a grid of whole rows", () => {
    expect(mobile).toContain('className="container-app grid grid-cols-3 gap-2.5"');
    expect(pageCode).toContain("typeTiles.length % 3 === 0");
  });

  it("snaps the venue carousel card by card, with the next one peeking in", () => {
    expect(mobile).toContain("snap-x snap-mandatory");
    expect(mobile).toContain("w-[78vw] max-w-[300px] shrink-0 snap-start");
  });

  it("repeats the owner card's copy word for word, not new claims", () => {
    for (const line of [
      "List your wedding hall on Hallnect",
      "Free to list — pay only on booking",
    ]) {
      expect(mobile.match(new RegExp(line))?.length, line).toBe(1);
      expect(desktop, line).toContain(line);
    }
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

describe("every field in both searches is real", () => {
  // This codebase has already shipped one prominent dead control: the city
  // picker wrote a localStorage key nothing read.
  it("maps each answer to a parameter /halls actually reads", () => {
    for (const param of ["city", "date", "dateTo", "capacity"]) {
      expect(searchUrl, `${param} is not submitted`).toContain(`params.set("${param}"`);
      expect(hallsPage, `/halls does not read ${param}`).toContain(param);
    }
  });

  it("builds the URL in one place for desktop and phone", () => {
    for (const src of [heroSearch, mobileSearch]) {
      expect(src).toContain("buildHallSearchHref({ city, date, dateTo, capacity })");
      expect(src).not.toContain("new URLSearchParams");
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
    // Behaviour is covered in search-url.test.ts; this pins the nesting.
    const dateBlock = searchUrl.slice(searchUrl.indexOf('params.set("date"'));
    expect(dateBlock.indexOf('params.set("dateTo"')).toBeGreaterThan(0);
    expect(dateBlock.indexOf('params.set("dateTo"')).toBeLessThan(dateBlock.indexOf("}"));
  });

  it("offers only cities that hold inventory, with their real counts", () => {
    for (const src of [heroSearch, mobileSearch]) {
      expect(src, "back on the hardcoded mock list").not.toContain("mock-data");
    }
    expect(
      pageCode.match(/cities=\{citiesWithVenues\.map\(\(c\) => \(\{ city: c\.city, venueCount: c\.venueCount \}\)\)\}/g)
        ?.length,
    ).toBe(2);
  });

  it("offers the same guest steps as the /halls capacity filter", async () => {
    const { GUEST_PRESETS } = await import("../search-url");
    const { CAPACITY_OPTIONS } = await import("../mock-data");
    expect([...GUEST_PRESETS]).toEqual(CAPACITY_OPTIONS.map((o) => o.value));
  });

  it("takes today from the server, not the visitor's clock", () => {
    expect(pageCode).toContain("todayInBusinessTz()");
  });

  it("asks three questions — Where, When, Guests — and says Search in words", () => {
    for (const label of ['label="Where"', 'label="When"', 'label="Guests"']) {
      expect(heroSearch).toContain(label);
      expect(mobileSearch).toContain(label);
    }
    expect(heroSearch.match(/<Segment/g)?.length).toBe(3);
    const submit = heroSearch.slice(heroSearch.indexOf('type="submit"'));
    expect(submit.slice(0, submit.indexOf("</button>"))).toMatch(/\n\s*Search\n/);
  });

  it("opens its panels upward, because the pill is pinned to the bottom", () => {
    expect(heroSearch).toContain("absolute bottom-full");
    expect(heroSearch).not.toContain("top-full");
  });

  it("announces each panel and whether it is open", () => {
    expect(heroSearch).toContain('role="dialog"');
    expect(heroSearch).toContain("aria-expanded={active}");
    expect(heroSearch).toContain('aria-haspopup="dialog"');
  });

  it("closes on Escape and hands focus back to the segment", () => {
    expect(heroSearch).toContain('e.key === "Escape"');
    expect(heroSearch).toContain("triggers.current[current]?.focus()");
  });

  it("shows focus per segment, not just around the whole pill", () => {
    expect(heroSearch).toContain("focus-visible:ring-2 focus-visible:ring-maroon-600");
    const form = heroSearch.slice(heroSearch.indexOf("<form"));
    expect(form.slice(0, form.indexOf(">"))).not.toContain("focus-within:ring");
  });

  it("uses a placeholder colour that passes 4.5:1", () => {
    // The old "Any" placeholder was charcoal-400 on white, about 3.4:1.
    expect(heroSearch).toContain('"text-charcoal-600")');
    expect(mobileSearch).toContain('"text-charcoal-600")');
  });
});

describe("the date calendar", () => {
  it("disables past days and never picks one", () => {
    expect(calendar).toContain("disabled={past}");
    expect(calendar).toContain("if (day < today) return;");
  });

  it("is one tab stop, moved with the arrow keys", () => {
    expect(calendar).toContain("tabIndex={day === tabDay ? 0 : -1}");
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]) {
      expect(calendar).toContain(`${key}:`);
    }
  });

  it("names every day in full, with its place in the range", () => {
    expect(calendar).toContain("aria-label={`${formatFull(day)}${state}");
  });

  it("gives a phone one month with 44px days", () => {
    expect(mobileSearch).toContain("months={1}");
    expect(calendar).toContain('months === 1 ? "h-11 w-11" : "h-10 w-10"');
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
