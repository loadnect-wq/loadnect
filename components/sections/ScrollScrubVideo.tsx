"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/sections/ScrollScrubVideo.tsx — the homepage hero: a full-screen
// walk-through that plays forward as you scroll down and backward as you
// scroll up.
//
//   <div  h = lengthVh (300vh)  data-header-clear>   ← the scroll distance
//     <div sticky top-0 h-[100dvh]>                  ← pinned while you scroll
//       poster · video · shades
//       intro   (headline etc.)  — fades out over the first INTRO_FADE of it
//       footer  (search pill)    — stays pinned the whole way
//       progress line
//
// No library, no global CSS. The scrubbing is plain requestAnimationFrame.
//
// STICKY HAS ONE SILENT FAILURE: an ancestor with `overflow: hidden|auto|
// scroll` makes it stop pinning, with no error. Nothing between this and <body>
// sets overflow today (checked). If it stops pinning, look there first.
//
// ════════════════════════════════════════════════════════════════════════════
// TUNING
// ════════════════════════════════════════════════════════════════════════════
//   lengthVh     total height. The clip spans (lengthVh - 100)vh of scrolling:
//                300 = two screens for the whole walk-through.
//   EASE         how quickly the picture catches the scroll bar.
//                0.08 floaty ... 0.35 tight.
//   INTRO_FADE   how far into the scroll the headline has fully faded.
//
// ════════════════════════════════════════════════════════════════════════════
// THE VIDEO FILE IS HALF THE FEATURE
// ════════════════════════════════════════════════════════════════════════════
// A seek decodes forward from the nearest keyframe. The supplied clip had ONE
// keyframe in 240 frames plus 179 B-frames: measured in Chrome, 279ms median
// per seek, 982ms worst — the "freeze on scroll". Re-encoded with a keyframe
// every 6 frames and no B-frames: 6ms median, 25ms p95, 30ms worst. The
// current, processed clip uses the same structure at crf 27: 5.3 MB.
// lib/__tests__/scroll-scrub.test.ts has the command and fails the build if a
// replacement file would freeze again.
// ─────────────────────────────────────────────────────────────────────────────

import Image from "next/image";
import { useEffect, useRef } from "react";

/** Frames per second of the encoded clip. Seeks smaller than half a frame are skipped. */
const FPS = 24;
const FRAME = 1 / FPS;
/** Catch-up per 60Hz frame; scaled for other refresh rates. */
const EASE = 0.18;
/** Scroll progress at which the intro content has fully faded. */
const INTRO_FADE = 0.12;

// ── The shades, and why they are these numbers ────────────────────────────────
// Measured against the 95th-percentile brightest pixel of each text band,
// sampled at 4 frames per second across the whole clip, cropped the way a
// 1440x900 screen crops it. This footage is BRIGHT — the lit facade and the
// chandeliers. Every number below keeps at least a 20% margin over its bar,
// so a slightly brighter frame cannot tip text into unreadable.
//
// RE-MEASURE WHEN THE CLIP CHANGES. The current file is a processed version
// of the first walk-through and runs brighter: on it, the shades tuned for the
// original left the subhead 7% and the nav links 10% above their bars. They
// were raised just enough to restore the margin.
//
// TOP: the transparent header sits over EVERY frame for the whole pin, so this
// one stays. Nav links at the worst of 40 frames: 5.67:1 (needs 4.5, +26%).
const TOP_SHADE =
  "linear-gradient(to bottom, rgba(26,22,20,0.68) 0%, rgba(26,22,20,0.64) 8%, rgba(26,22,20,0) 24%)";
// INTRO: behind the headline, and it fades out WITH the headline, so once you
// are stepping inside, the picture is unshaded. Over the opening frames:
// headline 3.87:1 (needs 3.0, +29%), gold clause 4.15:1 (+38%), subhead 5.44:1
// (needs 4.5, +21%), trust strip 6.45:1 (+43%).
const INTRO_SHADE =
  "linear-gradient(to bottom, rgba(26,22,20,0) 16%, rgba(26,22,20,0.50) 28%, rgba(26,22,20,0.50) 62%, rgba(26,22,20,0.33) 74%, rgba(26,22,20,0) 88%)";

type Props = {
  src: string;
  poster: string;
  /** Content over the opening frames; fades out as scrubbing starts. */
  intro?: React.ReactNode;
  /** Content pinned to the bottom of the frame for the whole walk-through. */
  footer?: React.ReactNode;
  /** Total height in viewport-heights. See TUNING. */
  lengthVh?: number;
  className?: string;
};

export function ScrollScrubVideo({ src, poster, intro, footer, lengthVh = 300, className }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    const video = videoRef.current;
    const bar = barRef.current;
    if (!root || !stage || !video || !bar) return;

    // ── Who does not get the scrub ──────────────────────────────────────────
    // Reduced motion: scroll-linked motion is what that setting asks us to
    // stop. Data Saver: ~5 MB for an effect. Both keep the poster and the
    // intro, and the block collapses to one screen (see the root's classes).
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (reduced.matches || conn?.saveData === true) {
      root.dataset.scrub = "off";
      return;
    }

    let duration = 0;
    let target = 0;   // seconds the scroll position asks for
    let shown = 0;    // seconds the easing has reached
    let frame = 0;
    let lastTick = 0;
    let seeking = false;
    let seekStarted = 0;
    let lastP = -1;

    // Where the stage pins and how tall it is. Read on mount and resize, never
    // per frame, so a scrolling frame costs one layout read.
    let pinAt = 0;
    let stageHeight = 0;
    const measure = () => {
      pinAt = parseFloat(getComputedStyle(stage).top) || 0;
      stageHeight = stage.offsetHeight;
    };
    measure();

    /** 0 at the moment the stage pins, 1 at the moment it unpins. */
    const progress = () => {
      const rect = root.getBoundingClientRect();
      const travel = rect.height - stageHeight;
      if (travel <= 0) return 0;
      return Math.min(1, Math.max(0, (pinAt - rect.top) / travel));
    };

    // ── The loop ────────────────────────────────────────────────────────────
    // Runs only while there is something to do, then stops. An idle page runs
    // zero frames.
    const tick = (now: number) => {
      frame = 0;
      const p = progress();

      // Scroll-driven styling works before the video has loaded: the intro
      // fades and the progress line moves even over the poster.
      if (Math.abs(p - lastP) > 0.0005) {
        lastP = p;
        bar.style.transform = `scaleX(${p.toFixed(4)})`;
        root.style.setProperty("--scrub-intro", Math.max(0, 1 - p / INTRO_FADE).toFixed(3));
      }
      if (!duration) return;

      // One frame short of the end: a seek to exactly `duration` lands on the
      // "ended" state and some browsers paint black.
      target = p * (duration - FRAME);

      // Frame-rate independent easing; dt capped so a resumed tab cannot jump.
      const dt = lastTick ? Math.min(100, now - lastTick) : 16.7;
      lastTick = now;
      shown += (target - shown) * (1 - Math.pow(1 - EASE, dt / 16.7));
      if (Math.abs(target - shown) < 0.002) shown = target;

      // ONE SEEK AT A TIME. Setting currentTime while a seek is still decoding
      // makes Chrome abandon and restart work — the main cause of scrub
      // stutter. The next seek goes wherever the easing has got to by then.
      if (seeking && now - seekStarted > 500) seeking = false;
      if (!seeking && Math.abs(video.currentTime - shown) >= FRAME / 2) {
        seeking = true;
        seekStarted = now;
        video.currentTime = shown;
      }

      if (shown !== target || seeking) {
        frame = requestAnimationFrame(tick);
      } else {
        lastTick = 0;
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const onSeeked = () => {
      seeking = false;
      schedule();
    };

    // ── Loading ─────────────────────────────────────────────────────────────
    // As the hero this is the page's main visual, so it cannot wait for a
    // scroll — the first scrolls would move nothing. It waits for the page's
    // own load and an idle moment instead, so the poster (the LCP image) and
    // the rest of the page never compete with ~5 MB. A visitor who scrolls
    // before then starts it immediately. preload="auto" then buffers the
    // whole clip, so seeks land in memory, not on the network.
    //
    // AND ONLY IF IT IS ACTUALLY ON SCREEN. The homepage renders this inside
    // `hidden lg:block`, and display:none does not stop JavaScript: measured
    // on a 375px phone, the idle loader downloaded all 4,897 KB of video for a
    // hero the phone never shows. So loading is a wish that is granted only
    // while the block has a box — and re-checked on resize, so a tablet turned
    // to landscape, or a window widened into the desktop layout, still gets it.
    let loaded = false;
    let wanted = false;
    let rendered = root.getClientRects().length > 0;
    const load = () => {
      wanted = true;
      if (loaded || !rendered) return;
      loaded = true;
      video.preload = "auto";
      video.src = src;
      video.load();
    };
    let idleHandle = 0;
    const whenIdle = () => {
      const w = window as Window & {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      };
      idleHandle = w.requestIdleCallback
        ? w.requestIdleCallback(load, { timeout: 2000 })
        : window.setTimeout(load, 1200);
    };
    if (document.readyState === "complete") whenIdle();
    else window.addEventListener("load", whenIdle, { once: true });

    const onMeta = () => {
      duration = video.duration;
      // iOS Safari will not paint a seeked frame for a video that has never
      // played. A muted inline play-then-pause is allowed without a gesture.
      video
        .play()
        .then(() => video.pause())
        .catch(() => { /* refused — the poster stays */ });
      schedule();
    };
    const onData = () => {
      root.dataset.scrubReady = "";
    };
    // THIS VIDEO NEVER PLAYS — it is only ever seeked. The iOS unlock above
    // calls play(), and in a background tab that promise is held until the tab
    // is shown; it then resolves, the clip runs for a moment before pause()
    // lands, and the picture drifts past the scroll position. Measured: 7.18s
    // shown where the scroll asked for 6.97s. So any playback is stopped the
    // instant it starts, and every pause re-syncs the frame to the scrollbar.
    const onPlay = () => {
      video.pause();
    };
    const onPause = () => {
      schedule();
    };
    const onScroll = () => {
      // Hidden (the phone layout): nothing to scrub, so no work per scroll.
      if (!rendered) return;
      load();
      schedule();
    };
    const onResize = () => {
      rendered = root.getClientRects().length > 0;
      if (!rendered) return;
      measure();
      if (wanted) load();
      schedule();
    };

    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("loadeddata", onData);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    schedule();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      const w = window as Window & { cancelIdleCallback?: (h: number) => void };
      if (w.cancelIdleCallback) w.cancelIdleCallback(idleHandle);
      else window.clearTimeout(idleHandle);
      window.removeEventListener("load", whenIdle);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("loadeddata", onData);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [src]);

  return (
    <div
      ref={rootRef}
      // Tells the shared header logic (RevealObserver) to keep the navbar
      // transparent while this is pinned beneath it. A solid bar would sit on
      // top of the walk-through.
      data-header-clear=""
      style={{ "--scrub-length": `${lengthVh}vh` } as React.CSSProperties}
      className={[
        "group relative h-[var(--scrub-length)]",
        // No scrub for these visitors, so no scroll distance: one screen tall.
        // The media query covers reduced motion before JavaScript runs; the
        // attribute covers Data Saver, which CSS cannot detect.
        "motion-reduce:h-[100dvh] data-[scrub=off]:h-[100dvh]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div ref={stageRef} className="sticky top-0 h-[100dvh] w-full overflow-hidden bg-charcoal-950">
        {/* Frame 0 of the clip, so the hand-over to the first decoded frame is
            invisible. `priority`: it is the hero, and the LCP element. */}
        <Image
          src={poster}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <video
          ref={videoRef}
          aria-hidden
          muted
          playsInline
          preload="none"
          className="absolute inset-0 h-full w-full object-cover object-center opacity-0 group-data-[scrub-ready]:opacity-100"
        />

        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: TOP_SHADE }} />
        {intro && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: INTRO_SHADE, opacity: "var(--scrub-intro, 1)" }}
          />
        )}

        {intro && (
          <div
            // Fades and lifts away as you step inside. Nothing in here is
            // interactive; the search pill lives in `footer`, so it never
            // fades out from under a visitor.
            className="absolute inset-0 flex items-center justify-center px-6 pb-36 pt-16"
            style={{
              opacity: "var(--scrub-intro, 1)",
              transform: "translate3d(0, calc((1 - var(--scrub-intro, 1)) * -28px), 0)",
            }}
          >
            {intro}
          </div>
        )}

        {footer && (
          <div className="absolute inset-x-0 bottom-10 z-10 flex justify-center px-6">{footer}</div>
        )}

        {/* How much of the walk-through is left, so two screens of pinned
            scrolling never feel open-ended. White on a darkened track: it
            carries information and needs 3:1 against bright frames. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-black/35 motion-reduce:hidden group-data-[scrub=off]:hidden"
        >
          <div
            ref={barRef}
            className="h-full origin-left bg-white will-change-transform"
            style={{ transform: "scaleX(0)" }}
          />
        </div>
      </div>
    </div>
  );
}
