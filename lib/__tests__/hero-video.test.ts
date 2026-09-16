import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { HERO_VIDEO } from "../hero-video";

// ─────────────────────────────────────────────────────────────────────────────
// The hero is a static video block with a floating search pill. Most of what
// can break here is a connection between files rather than a bug inside one,
// so these pin the connections — and the two decisions that were measured
// rather than eyeballed: the scrim opacity, and every search field being real.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const heroVideo  = read("components/sections/HeroVideo.tsx");
const heroSearch = read("components/sections/HeroSearch.tsx");
const page       = read("app/page.tsx");
const css        = read("app/globals.css");
const observer   = read("components/motion/RevealObserver.tsx");
const navbar     = read("components/layout/Navbar.tsx");
const halls      = read("lib/halls.ts");
const hallsPage  = read("app/halls/page.tsx");
const pkg        = JSON.parse(read("package.json"));

/**
 * Source with comments stripped.
 *
 * Absence assertions search for the very attributes the comments discuss — a
 * note explaining why the hero has no parallax would otherwise read as parallax.
 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const pageCode = code(page);
const cssCode  = code(css);

describe("the hero is static", () => {
  // The point of the redesign. Scroll-linked motion was removed on request;
  // these fail the build if any of it creeps back in.
  it("has no scroll-linked hooks in the markup", () => {
    for (const hook of ["data-hero-scroll", "data-hero-lift", "data-parallax"]) {
      expect(pageCode, `${hook} is back in the hero`).not.toContain(hook);
    }
  });

  it("has no scroll-driven transform rules left in the stylesheet", () => {
    for (const rule of ["[data-hero-video]", "[data-hero-lift]", "--hero-progress", "--parallax-y"]) {
      expect(cssCode, `${rule} is back in globals.css`).not.toContain(rule);
    }
  });

  it("the shared tick no longer runs a parallax pass", () => {
    expect(observer).not.toContain("parallaxNodes");
    expect(observer).not.toContain("hero-progress");
    // The reveal sweep and the header state are still its job.
    expect(observer).toContain("is-scrolled");
  });

  it("does not ship a smooth-scroll hijacker", () => {
    // Lenis was added for the old animated hero and broke anchor links while it
    // was here: /owner/register's CTA scrolled nowhere. It went with the hero.
    expect(fs.existsSync(path.join(ROOT, "components/motion/SmoothScroll.tsx"))).toBe(false);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps)).not.toContain("lenis");
  });

  it("the video component owns no animation of its own", () => {
    expect(heroVideo).not.toContain("requestAnimationFrame");
  });
});

describe("the video still behaves", () => {
  it("carries the four attributes iOS and Android need to autoplay", () => {
    for (const attr of ["autoPlay", "muted", "loop", "playsInline"]) {
      expect(heroVideo, `missing ${attr}`).toContain(attr);
    }
  });

  it("pauses off-screen and on a hidden tab", () => {
    expect(heroVideo).toContain("IntersectionObserver");
    expect(heroVideo).toContain("visibilitychange");
  });

  it("lets a visitor decline it", () => {
    expect(heroVideo).toContain("prefers-reduced-motion");
    expect(heroVideo).toContain("saveData");
  });

  it("swallows a refused play() rather than throwing into the console", () => {
    expect(heroVideo).toMatch(/\.play\(\)\.catch\(/);
  });

  it("serves same-origin media, because the CSP has no media-src", () => {
    for (const url of Object.values(HERO_VIDEO.sources)) {
      expect(url, `${url} would be blocked by default-src 'self'`).toMatch(/^\//);
    }
  });

  it("offers the phone file first, since the browser takes the first match", () => {
    expect(heroVideo.indexOf('media="(max-width: 767px)"'))
      .toBeLessThan(heroVideo.indexOf("src={src.desktop}"));
  });

  it("ships the files it points at", () => {
    if (HERO_VIDEO.ENABLED) {
      for (const url of Object.values(HERO_VIDEO.sources)) {
        expect(fs.existsSync(path.join(ROOT, "public", url)), `public${url} missing`).toBe(true);
      }
    }
  });
});

describe("the scrim is as light as the measurement allows", () => {
  // The old scrim was charcoal at 85%/75% plus a multiply pass, which flattened
  // the footage into a brown rectangle. It did not need to be: measured off the
  // poster, the clip is already dark — mean luminance 0.118 behind the heading,
  // i.e. 6.25:1 for white text with NO scrim at all. What needs covering is the
  // brightest 5% of pixels, where the palace lights blow out and white-on-white
  // falls to 1.47:1.
  //
  // Lightest alpha that clears WCAG AA in every band at the 95th percentile: 26%.
  it("keeps the middle near the measured floor, not far above it", () => {
    const mid = heroVideo.match(/rgba\(26,22,20,(0\.\d+)\) 46%/);
    expect(mid, "the mid-gradient stop moved or was reformatted").not.toBeNull();
    const alpha = Number(mid ? mid[1] : "0");
    expect(alpha, "below the measured 26% floor — white text fails AA").toBeGreaterThanOrEqual(0.26);
    expect(alpha, "drifting back toward a heavy wash").toBeLessThanOrEqual(0.4);
  });

  it("is a vignette, so the edges carry the navbar and the pill", () => {
    expect(heroVideo).toContain("linear-gradient(to bottom,");
    expect(heroVideo, "the second multiply pass is back").not.toContain("mix-blend-multiply");
  });

  it("backs the gradient with a text shadow rather than leaning on it", () => {
    // WCAG gives no credit for a shadow. It covers the frames the 95th
    // percentile does not, and is never the thing carrying contrast.
    expect(cssCode).toContain(".hero-ink");
    expect(pageCode).toContain("hero-ink");
  });
});

describe("the navbar is transparent over the hero and solid everywhere else", () => {
  it("only goes transparent on the homepage", () => {
    expect(navbar).toContain('pathname === "/"');
    expect(navbar).toContain("hallnect-header--over-hero");
  });

  it("comes back on scroll, or it would vanish over white content", () => {
    // `.is-scrolled .hallnect-header` outranks `.hallnect-header--over-hero`
    // on specificity, which is what restores the solid bar.
    expect(cssCode).toContain(".is-scrolled .hallnect-header");
    expect(cssCode).toContain("html:not(.is-scrolled) .hallnect-header--over-hero");
  });

  it("drops backdrop-filter while transparent", () => {
    // It blurs the video behind it, and it is a containing block for fixed
    // descendants — the trap that has already cost this repo two fixes.
    expect(cssCode).toMatch(/\.hallnect-header--over-hero\s*\{[^}]*backdrop-filter:\s*none/);
  });

  it("the hero reaches up behind the bar", () => {
    expect(pageCode).toContain("-mt-16");
    expect(pageCode).toContain("pt-16");
  });
});

describe("every field in the search pill is real", () => {
  // This codebase has already shipped one prominent dead control: the city
  // picker wrote a localStorage key nothing read. A four-part search bar whose
  // fourth part does nothing would be the same mistake in a nicer shape.
  it("maps each control to a parameter /halls actually reads", () => {
    for (const param of ["city", "date", "dateTo", "capacity"]) {
      expect(heroSearch, `${param} is not submitted`).toContain(`"${param}"`);
      expect(hallsPage, `/halls does not read ${param}`).toContain(param);
    }
  });

  it("Available Till is backed by a real range query", () => {
    // Before this, `date` was a single .eq() and a second date box would have
    // been decoration.
    expect(halls).toContain("dateTo");
    expect(halls).toMatch(/\.gte\("date"/);
    expect(halls).toMatch(/\.lte\("date"/);
  });

  it("excludes a hall blocked on ANY day of the range, not every day", () => {
    // A venue taken on the Saturday of a Friday-to-Sunday booking is no use.
    expect(halls).toContain("FULL_BLOCK_STATUSES");
    expect(halls).toContain("useRange");
  });

  it("never sends a range without its start, which would silently do nothing", () => {
    expect(heroSearch).toContain('params.has("date")');
  });

  it("offers only cities that hold inventory", () => {
    // The old control listed seventeen hardcoded names, several of which
    // Hallnect has never had a venue in — every one an empty search.
    expect(heroSearch).toContain("cities");
    expect(heroSearch, "back on the hardcoded mock list").not.toContain("mock-data");
    expect(pageCode).toContain("citiesWithVenues.map");
  });

  it("takes today from the server, not the visitor's clock", () => {
    expect(heroSearch).toContain("today");
    expect(pageCode).toContain("todayInBusinessTz()");
  });

  it("is a pill with four cells, three dividers and a round submit", () => {
    expect(heroSearch).toContain("rounded-full");
    expect(heroSearch.match(/w-px shrink-0/g)?.length).toBe(3);
    expect(heroSearch).toContain("h-14 w-14 shrink-0");
  });

  it("labels every control", () => {
    // A pill of bare inputs is unusable with a screen reader.
    expect(heroSearch.match(/htmlFor=/g)?.length).toBeGreaterThanOrEqual(4);
    expect(heroSearch).toContain('aria-label="Search"');
  });

  it("cannot be clipped by the section it hangs out of", () => {
    // It straddles the hero's bottom edge; overflow-hidden there would cut it.
    const hero = pageCode.slice(pageCode.indexOf("hidden lg:block"));
    const section = hero.slice(hero.indexOf("<section"), hero.indexOf("</section>"));
    expect(section, "overflow-hidden would cut the pill in half").not.toContain("overflow-hidden");
    expect(section).toContain("translate-y-1/2");
  });
});
