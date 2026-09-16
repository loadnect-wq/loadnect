"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/sections/HeroVideo.tsx — the video behind the hero.
//
// STATIC. There is no parallax, no scale, no scroll-linked anything. The video
// fills its section and stays there. This component owns exactly two things:
// the element, and whether it is playing.
//
// ════════════════════════════════════════════════════════════════════════════
// HOW TO SWAP THE VIDEO
// ════════════════════════════════════════════════════════════════════════════
//   /public/hero/hero-1920.mp4   landscape, served to >=768px
//   /public/hero/hero-720.mp4    smaller file, served to <768px
//   /public/hero/hero-poster.jpg the first frame, ~60-100 KB
//
// THE POSTER IS NOT OPTIONAL. It paints while the video downloads, it stands in
// for a reduced-motion or data-saver visitor, and it keeps the Largest
// Contentful Paint an image rather than a video that has not arrived.
//
// SAME ORIGIN ONLY. The CSP is `default-src 'self'` with no media-src, so media
// falls back to 'self'. A CDN or Supabase Storage URL is blocked silently.
//
// Re-encode with (ffmpeg is deliberately not a project dependency):
//   ffmpeg -i SRC -an -vf "scale=1920:-2" -c:v libx264 -profile:v high \
//     -crf 30 -preset slow -pix_fmt yuv420p -g 60 -movflags +faststart \
//     public/hero/hero-1920.mp4
//   ffmpeg -i SRC -an -vf "scale=720:-2"  -c:v libx264 -profile:v main \
//     -crf 30 -preset slow -pix_fmt yuv420p -g 60 -movflags +faststart \
//     public/hero/hero-720.mp4
//   ffmpeg -i SRC -frames:v 1 -vf "scale=1280:-2" -q:v 4 \
//     public/hero/hero-poster.jpg
//
// `-movflags +faststart` is the one that must not be forgotten: without it the
// browser downloads nearly the whole file before the first frame.
// ─────────────────────────────────────────────────────────────────────────────

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type HeroVideoSources = { desktop: string; mobile: string; poster: string };

const DEFAULT_SOURCES: HeroVideoSources = {
  desktop: "/hero/hero-1920.mp4",
  mobile: "/hero/hero-720.mp4",
  poster: "/hero/hero-poster.jpg",
};

// ════════════════════════════════════════════════════════════════════════════
// THE SCRIM, AND WHY IT IS THIS LIGHT
// ════════════════════════════════════════════════════════════════════════════
// This used to be charcoal at 85%/75% plus a second multiply pass, which
// flattened the footage into a brown rectangle. It did not need to be: measured
// off the poster, the clip is ALREADY dark — mean luminance 0.118 behind the
// heading, which gives white text 6.25:1 with no scrim whatsoever.
//
// What does need covering is the top 5% of pixels: the palace lights blow out
// to near-white, and white-on-white is 1.47:1. So this is a VIGNETTE, not a
// wash — heaviest at the two edges where the navbar and the search pill sit,
// and barely there across the middle where the picture is.
//
// Measured minimum that clears WCAG AA in every band at the 95th-percentile
// brightest pixel: 26%. The middle sits at 30% for margin, because the poster
// is one frame and other frames run brighter (max pixel across 10 frames is
// (255,252,228) versus the poster's own max).
//
// RE-MEASURE IF YOU SWAP THE CLIP. A brighter video fails this silently and
// nothing in the build will tell you. lib/__tests__/hero-video.test.ts pins the
// numbers so at least the intent survives.
const SCRIM =
  "linear-gradient(to bottom," +
  "rgba(26,22,20,0.52) 0%," +   // navbar sits here — white nav links need 4.5:1
  "rgba(26,22,20,0.26) 16%," +
  "rgba(26,22,20,0.30) 46%," +  // heading + subhead band
  "rgba(26,22,20,0.26) 68%," +
  "rgba(26,22,20,0.58) 100%)";  // search pill, and the blend into the section below

type Props = {
  sources?: Partial<HeroVideoSources>;
  className?: string;
};

export function HeroVideo({ sources, className }: Props) {
  const src = { ...DEFAULT_SOURCES, ...sources };
  const videoRef = useRef<HTMLVideoElement>(null);
  // The poster is a real element underneath, and the video crossfades onto it
  // once it is genuinely playing. Before this the first painted frame replaced
  // the poster in a single tick, which read as a flicker on a slow connection.
  // It also means a visitor who never gets video — reduced motion, Data Saver,
  // refused autoplay — simply keeps the poster, with no transparent gap.
  const [videoShowing, setVideoShowing] = useState(false);

  // Play only while on screen. A looping decode costs real CPU, and on a phone
  // that is real battery — once the hero has scrolled away nobody is watching.
  //
  // This is NOT a scroll animation: nothing here reads scroll position or
  // writes a style. It is an IntersectionObserver deciding play/pause.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    // Two ways a visitor can decline the video, both honoured.
    //
    // REDUCED MOTION — the OS setting; the poster becomes the hero.
    // DATA SAVER — this site's traffic is mostly metered mobile data in Tamil
    // Nadu, and a decorative loop is exactly what "save data" asks us not to
    // fetch. Because the files are faststart, declining costs the few KB of
    // `moov` that preload="metadata" reads and never the ~440 KB body.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (reduced.matches || conn?.saveData === true) {
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
      { rootMargin: "100px", threshold: 0 },
    );
    io.observe(el);

    // Some browsers keep decoding a backgrounded tab, and IntersectionObserver
    // does not fire for one.
    const onVisibility = () => {
      if (document.hidden) el.pause();
      else if (el.getBoundingClientRect().bottom > 0) el.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div
      aria-hidden
      className={["pointer-events-none absolute inset-0 overflow-hidden", className]
        .filter(Boolean)
        .join(" ")}
    >
      {/* LCP candidate, so it is `priority`: preloaded, and served as AVIF or
          WebP rather than the raw 86 KB JPEG. */}
      <Image
        src={src.poster}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-center"
      />

      <video
        ref={videoRef}
        onPlaying={() => setVideoShowing(true)}
        // The four attributes iOS Safari and Android Chrome require before they
        // will autoplay. `muted` is load-bearing; `playsInline` is what stops
        // iOS taking the video fullscreen.
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        // No `poster` attribute: the <Image> above already paints it, and the
        // attribute would fetch the unoptimised original a second time.
        className={cn(
          "absolute inset-0 h-full w-full object-cover object-center",
          "transition-opacity duration-700 motion-reduce:transition-none",
          videoShowing ? "opacity-100" : "opacity-0",
        )}
      >
        {/* Narrowest first — the browser takes the FIRST matching source. */}
        <source src={src.mobile} media="(max-width: 767px)" type="video/mp4" />
        <source src={src.desktop} type="video/mp4" />
      </video>

      <div className="absolute inset-0" style={{ background: SCRIM }} />
    </div>
  );
}
