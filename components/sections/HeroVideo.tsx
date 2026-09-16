"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/sections/HeroVideo.tsx — the video layer behind the hero.
//
// ════════════════════════════════════════════════════════════════════════════
// HOW TO SWAP THE VIDEO
// ════════════════════════════════════════════════════════════════════════════
// Put the files in /public/hero/ and pass the names in, or edit DEFAULT_SOURCES
// below. Three files, not one:
//
//   /public/hero/hero-1920.mp4   landscape, served to >=768px
//   /public/hero/hero-720.mp4    portrait/small, served to <768px
//   /public/hero/hero-poster.jpg the first frame, ~60-100 KB
//
// THE POSTER IS NOT OPTIONAL. It is what paints while the video downloads, it
// is what a reduced-motion or data-saver visitor sees instead of the video, and
// it is what keeps the Largest Contentful Paint an IMAGE rather than a video
// that has not arrived. Without it this section is a black rectangle for the
// first second or two of every visit.
//
// SAME ORIGIN ONLY. The site's CSP is `default-src 'self'` with NO media-src
// (next.config.ts), so media falls back to 'self'. A video served from Supabase
// Storage — or any CDN — is BLOCKED, silently, with nothing in the server logs.
// Serve from /public, or add an explicit media-src first.
//
// ════════════════════════════════════════════════════════════════════════════
// WHY THERE IS NO rAF LOOP IN THIS FILE
// ════════════════════════════════════════════════════════════════════════════
// The parallax is driven by the tick that already exists in
// components/motion/RevealObserver.tsx, which coalesces reveals, parallax and
// the header state into ONE rAF with at most one layout read per frame. A
// second loop here would double that cost for every scrolling frame on the
// page, which is the opposite of what a battery-conscious hero wants.
//
// This component owns exactly two things: the element, and whether it plays.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";

export type HeroVideoSources = {
  /** >= 768px. Landscape master, e.g. 1920x1080. */
  desktop: string;
  /** < 768px. Portrait or smaller landscape crop — saves the phone the bytes. */
  mobile: string;
  /** First frame. Paints instantly and stands in whenever the video does not. */
  poster: string;
};

const DEFAULT_SOURCES: HeroVideoSources = {
  desktop: "/hero/hero-1920.mp4",
  mobile: "/hero/hero-720.mp4",
  poster: "/hero/hero-poster.jpg",
};

type Props = {
  sources?: Partial<HeroVideoSources>;
  /**
   * How far the video drifts and grows across one screen of scrolling.
   *
   * SCROLL SENSITIVITY LIVES HERE. `scale` is the end value at the bottom of
   * the hero (1.1 = grows 10%); `driftPx` is how far it travels down as you
   * scroll, which is what makes it read as "behind" the content. Both are
   * written to CSS custom properties and consumed by the stylesheet — see the
   * `[data-hero-scroll]` block in app/globals.css.
   *
   * Keep drift well under the overscan (the video is inset by -10% on each
   * edge) or you will expose an edge at the bottom of the travel.
   */
  scale?: number;
  driftPx?: number;
  className?: string;
};

export function HeroVideo({ sources, scale = 1.1, driftPx = 60, className }: Props) {
  const src = { ...DEFAULT_SOURCES, ...sources };
  const videoRef = useRef<HTMLVideoElement>(null);

  // ── Play only while on screen ───────────────────────────────────────────────
  // A looping 1080p decode costs real CPU, and on a phone that is real battery.
  // Once the hero has scrolled away there is nobody to see it, so it stops.
  //
  // `play()` returns a promise that REJECTS when autoplay is refused (a data
  // saver, a battery saver, an iOS low-power mode). That rejection is caught and
  // ignored on purpose: the poster is already showing, so a refused play is a
  // still image rather than an error, and an unhandled rejection in the console
  // would be the only thing that actually broke.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    // Respect the OS setting. Under reduced motion the element never plays and
    // the poster is the hero — matching how globals.css disables every other
    // animation on the site.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) {
      el.pause();
      return;
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.play().catch(() => { /* autoplay refused — the poster stands in */ });
        } else {
          el.pause();
        }
      },
      // A little margin so playback resumes just before it is visible rather
      // than a frame after, which would otherwise show as a stutter on the way
      // back up.
      { rootMargin: "100px", threshold: 0 },
    );
    io.observe(el);

    // Stop decoding entirely when the tab is hidden. IntersectionObserver does
    // not fire for a backgrounded tab, and some browsers keep decoding.
    const onVisibility = () => {
      if (document.hidden) el.pause();
      else if (el.getBoundingClientRect().bottom > 0) {
        el.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    // NOTE: `data-hero-scroll` belongs on the SECTION that wraps this, not
    // here. --hero-progress is a custom property and custom properties INHERIT
    // — the video layer and the content that lifts are siblings, so the value
    // has to be written on their common ancestor or only one of them sees it.
    // Putting it on this element instead was my first attempt and the content
    // simply never faded.
    <div
      aria-hidden
      className={["pointer-events-none absolute inset-0 overflow-hidden", className]
        .filter(Boolean)
        .join(" ")}
    >
      {/* The element is INSET BY -10% on every edge ("overscan"). The parallax
          drifts and scales it, and without the bleed the top edge would slide
          into view as a hard line the moment the drift went positive. */}
      <div
        data-hero-video
        className="absolute -inset-[10%]"
        style={
          {
            "--hero-scale-to": String(scale),
            "--hero-drift": `${driftPx}px`,
          } as React.CSSProperties
        }
      >
        <video
          ref={videoRef}
          // The four attributes iOS Safari and Android Chrome require before
          // they will autoplay anything. `muted` is the load-bearing one and
          // `playsInline` is what stops iOS taking the video fullscreen.
          autoPlay
          muted
          loop
          playsInline
          // Tells the browser it may fetch the media; the poster still paints
          // first. "auto" would race the rest of the page for bandwidth.
          preload="metadata"
          poster={src.poster}
          // object-cover + centre keeps the focal point of a 16:9 master visible
          // in a 9:16 window with no letterboxing and no horizontal overflow.
          className="h-full w-full object-cover object-center"
        >
          {/* Ordered narrowest-first: the browser takes the FIRST matching
              source, so the mobile file must be listed before the fallback. */}
          <source src={src.mobile} media="(max-width: 767px)" type="video/mp4" />
          <source src={src.desktop} type="video/mp4" />
        </video>
      </div>

      {/* Contrast scrim. Two stops rather than a flat wash: the text sits in the
          upper half, so that half is darkened hardest while the lower half stays
          readable enough to show the footage. Tuned to keep white body text at
          or above 4.5:1 over the brightest frame of the reference clip — if you
          swap in a brighter video, re-check it rather than assuming. */}
      <div className="absolute inset-0 bg-gradient-to-b from-charcoal-950/80 via-charcoal-950/65 to-charcoal-950/80" />
      {/* A second, hero-tinted pass so the footage reads as Hallnect's rather
          than as stock video behind a grey sheet. */}
      <div className="absolute inset-0 bg-hero-gradient opacity-60 mix-blend-multiply" />
    </div>
  );
}
