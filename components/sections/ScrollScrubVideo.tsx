"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/sections/ScrollScrubVideo.tsx — a full-screen video that plays
// forward as you scroll down and backward as you scroll up.
//
// ════════════════════════════════════════════════════════════════════════════
// DROP-IN, AND HOW IT STAYS THAT WAY
// ════════════════════════════════════════════════════════════════════════════
// One self-contained block. It adds no global CSS, no library, no scroll
// listener that outlives it, and touches nothing outside its own box:
//
//   <div  height = lengthVh (e.g. 300vh)>        ← creates the scroll distance
//     <div sticky top-0 h-[100dvh]>              ← pins while you scroll past
//       poster <Image>, <video object-cover>
//
// The tall outer box is the ONLY thing it adds to page flow. Everything above
// and below keeps its layout; it simply sits lengthVh further down.
//
// STICKY HAS ONE SILENT FAILURE: an ancestor with `overflow: hidden|auto|
// scroll` makes it stop pinning, with no error anywhere. Nothing between this
// and <body> sets overflow today (checked). If it stops pinning, look there
// first — not here.
//
// ════════════════════════════════════════════════════════════════════════════
// TUNING
// ════════════════════════════════════════════════════════════════════════════
//   lengthVh   total height of the block. The clip spans (lengthVh - 100)vh of
//              scrolling, so 300 = two screens of scroll for the whole clip.
//              Raise it for a slower, more cinematic walk-through.
//   EASE       below. How quickly the picture catches up to the scroll bar.
//              0.08 floaty ... 0.35 tight. Too tight and a trackpad's uneven
//              deltas show as judder; too loose and it lags your hand.
//
// ════════════════════════════════════════════════════════════════════════════
// THE VIDEO FILE IS HALF THE FEATURE
// ════════════════════════════════════════════════════════════════════════════
// Scrubbing works by seeking, and a seek decodes from the nearest keyframe. The
// source clip had ONE keyframe in 240 frames and 179 B-frames, so seeking near
// the end decoded almost the whole clip each time — measured in Chrome:
// median 279ms per seek, worst 982ms. That is the "freeze on scroll".
//
// Encoded with a keyframe every 6 frames and no B-frames it measured 6ms median,
// 25ms p95, 30ms worst, at 4.9 MB. Every-frame keyframes were faster still but
// visibly smeared detail at a similar size. The exact command is in the commit
// that added this file and in lib/__tests__/scroll-scrub.test.ts, which also
// fails if a replacement file loses its short keyframe interval.
// ─────────────────────────────────────────────────────────────────────────────

import Image from "next/image";
import { useEffect, useRef } from "react";

/** Frames per second of the encoded clip. Used to skip seeks smaller than a frame. */
const FPS = 24;
const FRAME = 1 / FPS;
/** Catch-up per 60Hz frame; scaled for other refresh rates below. */
const EASE = 0.18;

type Props = {
  src: string;
  poster: string;
  /** Total block height in viewport-heights. See TUNING above. */
  lengthVh?: number;
  className?: string;
};

export function ScrollScrubVideo({ src, poster, lengthVh = 300, className }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const video = videoRef.current;
    if (!root || !video) return;

    // ── Who does not get the scrub ──────────────────────────────────────────
    // Reduced motion: scroll-linked motion is exactly what that setting asks
    // us to stop. Data Saver: a ~5 MB file for a decorative effect. Both keep
    // the poster, and the block collapses to one screen (see the classes on
    // the root) so nobody scrolls two screens past a still picture. The video
    // element never receives a src, so nothing is downloaded.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (reduced.matches || conn?.saveData === true) {
      root.dataset.scrub = "off";
      return;
    }

    let duration = 0;
    let target = 0;       // seconds the scroll position asks for
    let shown = 0;        // seconds the easing has reached
    let frame = 0;
    let lastTick = 0;
    let seeking = false;
    let seekStarted = 0;
    let near = false;

    /** 0 at the moment the block pins, 1 at the moment it unpins. */
    const progress = () => {
      const rect = root.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      if (travel <= 0) return 0;
      return Math.min(1, Math.max(0, -rect.top / travel));
    };

    // ── The loop ────────────────────────────────────────────────────────────
    // Runs only while there is something to do: started by a scroll or resize,
    // it keeps scheduling itself until the picture has caught up and the last
    // seek has landed, then stops. An idle page runs zero frames.
    const tick = (now: number) => {
      frame = 0;
      if (!duration) return;

      // One frame short of the end: a seek to exactly `duration` lands on the
      // "ended" state and some browsers paint black.
      target = progress() * (duration - FRAME);

      // Frame-rate independent easing, so a 120Hz screen does not scrub twice
      // as tightly as a 60Hz one. dt is capped so a backgrounded tab resuming
      // does not jump.
      const dt = lastTick ? Math.min(100, now - lastTick) : 16.7;
      lastTick = now;
      shown += (target - shown) * (1 - Math.pow(1 - EASE, dt / 16.7));
      if (Math.abs(target - shown) < 0.002) shown = target;

      // ONE SEEK AT A TIME. Setting currentTime while a previous seek is still
      // decoding makes Chrome abandon and restart work, which is where most
      // "scrub stutter" comes from. Wait for `seeked`, then jump straight to
      // wherever the easing is by then — intermediate positions are skipped,
      // not queued. A seek that never reports back is released after 500ms.
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
      if (near && !frame) frame = requestAnimationFrame(tick);
    };
    // A restored scroll position (back button, reload mid-page) also fires
    // `scroll`, so a visitor who returns to the middle of the block loads too.
    const onScroll = () => {
      if (!userScrolled) {
        userScrolled = true;
        if (near) load();
      }
      schedule();
    };
    const onSeeked = () => {
      seeking = false;
      schedule();
    };

    // ── Loading ─────────────────────────────────────────────────────────────
    // TWO CONDITIONS: the visitor has scrolled at all, AND the block is within
    // a screen of the viewport. The first one is the important one.
    //
    // A distance margin alone cannot do this job on the homepage, where the
    // block starts ~1135px down. A one-screen margin fired on page load for
    // everyone; a quarter-screen margin measured 10px short of firing at a
    // 900px-tall window and would fire on load for any taller one — i.e. most
    // desktops. Either way, a visitor who read the hero and left paid for 5 MB.
    // Gating on a real scroll makes that zero, and the one-screen margin still
    // starts the download a full screen before the block pins. preload="auto"
    // then buffers the whole clip, so seeks land in memory, not on the network.
    let loaded = false;
    let userScrolled = false;
    const load = () => {
      if (loaded || !userScrolled) return;
      loaded = true;
      video.preload = "auto";
      video.src = src;
      video.load();
    };

    const onMeta = () => {
      duration = video.duration;
      // iOS Safari will not paint a seeked frame for a video that has never
      // played. A muted, inline play-then-pause is allowed without a gesture
      // and unlocks it; everywhere else it is harmless.
      video
        .play()
        .then(() => video.pause())
        .catch(() => { /* refused — the poster stays, nothing breaks */ });
      schedule();
    };
    const onData = () => {
      root.dataset.scrubReady = "";
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        near = entry.isIntersecting;
        if (near) {
          load();
          schedule();
        }
      },
      { rootMargin: "0px 0px 100% 0px" },
    );
    io.observe(root);

    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("loadeddata", onData);
    video.addEventListener("seeked", onSeeked);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    return () => {
      io.disconnect();
      if (frame) cancelAnimationFrame(frame);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("loadeddata", onData);
      video.removeEventListener("seeked", onSeeked);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", schedule);
    };
  }, [src]);

  return (
    <div
      ref={rootRef}
      // Decorative: a screen reader gains nothing from a silent walk-through,
      // and nothing inside is focusable.
      aria-hidden
      style={{ "--scrub-length": `${lengthVh}vh` } as React.CSSProperties}
      className={[
        "group relative h-[var(--scrub-length)]",
        // No scrub for these visitors, so no scroll distance either. The media
        // query covers reduced motion before JavaScript runs; the attribute
        // covers Data Saver, which CSS cannot detect.
        "motion-reduce:h-[100dvh] data-[scrub=off]:h-[100dvh]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="sticky top-0 h-[100dvh] w-full overflow-hidden bg-charcoal-950">
        {/* Frame 0 of the clip, so the hand-over to the first decoded frame
            is invisible. Not `priority`: this block is below the fold. */}
        <Image src={poster} alt="" fill sizes="100vw" className="object-cover object-center" />
        <video
          ref={videoRef}
          muted
          playsInline
          // No src until the block is near — see "Loading" above.
          preload="none"
          // Hidden until a real frame exists, so an empty element never covers
          // the poster.
          className="absolute inset-0 h-full w-full object-cover object-center opacity-0 group-data-[scrub-ready]:opacity-100"
        />
      </div>
    </div>
  );
}
