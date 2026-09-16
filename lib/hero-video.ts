// ─────────────────────────────────────────────────────────────────────────────
// lib/hero-video.ts — the one switch that turns the hero video on.
//
// ════════════════════════════════════════════════════════════════════════════
// IT IS OFF, AND THAT IS DELIBERATE
// ════════════════════════════════════════════════════════════════════════════
// The video layer paints two dark scrims over whatever is behind it. With the
// .mp4 files missing that is a near-black rectangle where the hero used to be —
// strictly worse than the gradient it replaced. So the component ships wired in
// but switched off, and the homepage renders EXACTLY as it does today until the
// three files below actually exist.
//
// Turn it on in one step: put the files in /public/hero/, flip ENABLED to true.
//
// A filesystem check (fs.existsSync) was the obvious alternative and is wrong
// here: /public is served by the CDN and is NOT bundled into the serverless
// function, so the check would come back false in production for files that
// were being served perfectly well.
// ─────────────────────────────────────────────────────────────────────────────

export const HERO_VIDEO = {
  /** ← FLIP THIS once /public/hero/ has all three files. */
  ENABLED: false,

  sources: {
    desktop: "/hero/hero-1920.mp4",
    mobile: "/hero/hero-720.mp4",
    poster: "/hero/hero-poster.jpg",
  },

  /**
   * Scroll sensitivity. `scale` is how far the video has grown by the time the
   * hero has fully scrolled past (1.1 = 10%); `drift` is how far it travels
   * down over the same distance, which is what sells the depth.
   *
   * Keep drift under the 10% overscan in HeroVideo or the top edge shows.
   */
  scale: 1.1,
  driftPx: 60,
} as const;
