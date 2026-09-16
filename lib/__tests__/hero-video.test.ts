import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { HERO_VIDEO } from "../hero-video";

// ─────────────────────────────────────────────────────────────────────────────
// The hero video is four files cooperating — a component, a shared rAF tick, a
// stylesheet and a feature gate — so most of what can break here is a broken
// connection between two of them rather than a bug inside one. These are the
// connections, each one measured in a real browser at 1440x900 first.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const heroVideo   = read("components/sections/HeroVideo.tsx");
const smooth      = read("components/motion/SmoothScroll.tsx");
const page        = read("app/page.tsx");
const css         = read("app/globals.css");
const observer    = read("components/motion/RevealObserver.tsx");

describe("--hero-progress reaches everything that reads it", () => {
  // Custom properties INHERIT. The video layer and the content that lifts are
  // siblings, so the property has to be written on their common ancestor. It
  // was briefly on HeroVideo's own root, where the video moved and the text
  // never faded, because the text is not inside the video.
  it("is written on the section, not inside the video component", () => {
    expect(page).toContain("data-hero-scroll");
    expect(heroVideo).not.toMatch(/^\s*data-hero-scroll/m);
  });

  it("the lifting content is a descendant of the element that carries it", () => {
    const section = page.indexOf("data-hero-scroll");
    const lift = page.indexOf("data-hero-lift");
    expect(section).toBeGreaterThan(-1);
    expect(lift).toBeGreaterThan(section);
  });

  it("the shared tick writes it, and no second rAF loop exists", () => {
    expect(observer).toContain('querySelectorAll<HTMLElement>("[data-hero-scroll]")');
    expect(observer).toContain('setProperty("--hero-progress"');
    // The brief's whole point: one tick, one layout read per frame.
    expect(heroVideo).not.toContain("requestAnimationFrame");
  });

  it("the stylesheet derives motion from it rather than JS touching layout", () => {
    expect(css).toContain("[data-hero-video]");
    expect(css).toContain("[data-hero-lift]");
    expect(css).toContain("translate3d");
  });
});

describe("it plays where browsers allow autoplay, and stops when nobody is looking", () => {
  it("carries all four attributes iOS and Android require", () => {
    for (const attr of ["autoPlay", "muted", "loop", "playsInline"]) {
      expect(heroVideo, `missing ${attr} — autoplay silently refused`).toContain(attr);
    }
  });

  it("pauses off-screen and on a hidden tab", () => {
    expect(heroVideo).toContain("IntersectionObserver");
    expect(heroVideo).toContain("visibilitychange");
    expect(heroVideo).toContain("el.pause()");
  });

  it("swallows a refused play() instead of throwing into the console", () => {
    expect(heroVideo).toMatch(/\.play\(\)\.catch\(/);
  });

  it("never plays under reduced motion", () => {
    expect(heroVideo).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
    expect(css).toContain("prefers-reduced-motion");
  });
});

describe("the media can actually load", () => {
  // next.config.ts sets default-src 'self' and declares NO media-src, so media
  // falls back to 'self'. A CDN or Supabase Storage URL here is blocked with
  // nothing in the server logs — it just never plays.
  it("every source is same-origin", () => {
    for (const url of Object.values(HERO_VIDEO.sources)) {
      expect(url, `${url} is not same-origin — CSP will block it`).toMatch(/^\//);
    }
  });

  it("offers the phone file first, since the browser takes the first match", () => {
    const mobile = heroVideo.indexOf('media="(max-width: 767px)"');
    const desktop = heroVideo.indexOf("src={src.desktop}");
    expect(mobile).toBeGreaterThan(-1);
    expect(mobile).toBeLessThan(desktop);
  });

  it("declares a poster, which is the LCP frame and the reduced-motion still", () => {
    expect(heroVideo).toContain("poster={src.poster}");
    expect(HERO_VIDEO.sources.poster).toMatch(/\.(jpg|jpeg|webp|avif)$/);
  });

  it("stays off until the files exist, so a missing video is not a black hero", () => {
    // Flip HERO_VIDEO.ENABLED in the same commit that adds /public/hero/*.
    const enabled = HERO_VIDEO.ENABLED as boolean;
    if (enabled) {
      for (const url of Object.values(HERO_VIDEO.sources)) {
        expect(
          fs.existsSync(path.join(ROOT, "public", url)),
          `HERO_VIDEO.ENABLED is true but public${url} is missing`,
        ).toBe(true);
      }
    }
  });
});

describe("smoothing the wheel does not break the page", () => {
  // MEASURED: with Lenis owning the scroll position, a native anchor jump is
  // overwritten by its next eased frame. On /owner/register the "Register" CTA
  // targets #register at y=2168 and the page stayed at y=0. layout.tsx's skip
  // link (href="#main") fails identically, which is a keyboard regression.
  it("hands anchor links to Lenis instead of letting them fight it", () => {
    expect(smooth, "anchors:true removed — #main and #register stop working").toContain(
      "anchors: true",
    );
  });

  it("leaves touch scrolling to the OS", () => {
    expect(smooth).toContain("syncTouch: false");
    expect(smooth).toContain('matchMedia("(pointer: fine)")');
  });

  it("does nothing at all under reduced motion", () => {
    expect(smooth).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
    expect(smooth).toContain("reduced.matches) return;");
  });

  it("loads on demand so a phone never downloads the chunk", () => {
    expect(smooth).toContain('import("lenis")');
  });

  it("stops its own loop and destroys the instance on unmount", () => {
    expect(smooth).toContain("cancelAnimationFrame");
    expect(smooth).toContain("lenis?.destroy()");
  });
});
