import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// The scroll-scrubbed walk-through that is the homepage hero.
//
// Half of this feature is the video FILE, and a replacement file is the most
// likely way to break it — silently. The source clip had ONE keyframe in 240
// frames plus 179 B-frames, and measured in Chrome that meant a median 279ms
// per seek, worst 982ms: the picture froze on every scroll. So the first block
// below parses the shipped MP4 and fails the build if it would scrub badly.
//
// To replace the clip, re-encode with (1280x720 shown; keep your source size):
//
//   ffmpeg -i SOURCE.mp4 -an -c:v libx264 -preset slow -crf 27 \
//     -g 6 -keyint_min 6 -bf 0 -tune fastdecode \
//     -x264-params scenecut=0 -pix_fmt yuv420p -movflags +faststart \
//     public/scrub/hall-walkthrough.mp4
//
// Measured alternatives on the first clip, Chrome: keyframe every 24 frames
// seeked in 7ms median but 119ms worst; every frame (crf 28) seeked in a flat
// 6ms but visibly smeared detail (SSIM 0.943 vs 0.974 at a keyframe every 6).
// The current, processed clip carries more fine detail: crf 26 came out at
// 5.8 MB, crf 27 at 5.3 MB with SSIM 0.973 and no visible difference.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

type Box = { type: string; start: number; end: number; path: string };

/** Walks the ISO-BMFF box tree. Enough of it to answer the questions below. */
function boxes(buf: Buffer): Box[] {
  const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "udta"]);
  const out: Box[] = [];
  const walk = (s: number, e: number, p: string) => {
    let i = s;
    while (i + 8 <= e) {
      let size = buf.readUInt32BE(i);
      const type = buf.toString("latin1", i + 4, i + 8);
      let header = 8;
      if (size === 1) {
        size = Number(buf.readBigUInt64BE(i + 8));
        header = 16;
      } else if (size === 0) {
        size = e - i;
      }
      if (size < header) break;
      out.push({ type, start: i + header, end: i + size, path: p });
      if (CONTAINERS.has(type)) walk(i + header, i + size, `${p}/${type}`);
      i += size;
    }
  };
  walk(0, buf.length, "");
  return out;
}

describe("the shipped video scrubs without freezing", () => {
  const file = path.join(ROOT, "public/scrub/hall-walkthrough.mp4");
  const buf = fs.readFileSync(file);
  const tree = boxes(buf);
  const find = (t: string) => tree.filter((b) => b.type === t);

  it("has a keyframe at least every 6 frames", () => {
    // stss lists the sync (key) samples. A seek decodes forward from the one
    // before it, so the largest gap is the worst-case decode per scroll step.
    const [stss] = find("stss");
    expect(stss, "no stss box — either every frame is a keyframe or the file is not H.264 MP4").toBeDefined();
    const count = buf.readUInt32BE(stss.start + 4);
    const keys = Array.from({ length: count }, (_, k) => buf.readUInt32BE(stss.start + 8 + 4 * k));
    const [stsz] = find("stsz");
    const samples = buf.readUInt32BE(stsz.start + 8);
    const gaps = keys.slice(1).map((k, i) => k - keys[i]).concat(samples + 1 - keys[keys.length - 1]);
    expect(Math.max(...gaps), `keyframes up to ${Math.max(...gaps)} frames apart`).toBeLessThanOrEqual(6);
  });

  it("has no B-frames", () => {
    // A ctts box means presentation order differs from decode order, i.e.
    // B-frames. They make a seek decode frames that are never shown.
    expect(find("ctts"), "B-frames are back").toHaveLength(0);
  });

  it("is faststart, so duration is known before the body downloads", () => {
    const top = tree.filter((b) => b.path === "").map((b) => b.type);
    expect(top.indexOf("moov")).toBeLessThan(top.indexOf("mdat"));
  });

  it("carries no audio track for a clip that is never heard", () => {
    const handlers = find("hdlr").map((h) => buf.toString("latin1", h.start + 8, h.start + 12));
    expect(handlers).toContain("vide");
    expect(handlers).not.toContain("soun");
  });

  it("stays a reasonable download", () => {
    expect(buf.length, `${Math.round(buf.length / 1024)} KB`).toBeLessThan(6 * 1024 * 1024);
  });

  it("has a poster, which is what everyone sees until the video is buffered", () => {
    expect(fs.existsSync(path.join(ROOT, "public/scrub/hall-walkthrough-poster.jpg"))).toBe(true);
  });
});

describe("the scrubbing logic", () => {
  const src = read("components/sections/ScrollScrubVideo.tsx");

  it("is vanilla: no animation or scroll library", () => {
    const imports = src.match(/^import .* from "([^"]+)";$/gm) ?? [];
    for (const line of imports) {
      expect(line, `unexpected dependency: ${line}`).toMatch(/from "(react|next\/image)"/);
    }
  });

  it("drives the video from requestAnimationFrame, and never plays it", () => {
    expect(src).toContain("requestAnimationFrame(tick)");
    expect(src).toContain("video.currentTime = shown");
    // The only play() is the iOS unlock, immediately paused.
    expect(src).toMatch(/\.play\(\)\s*\.then\(\(\) => video\.pause\(\)\)/);
  });

  it("stops any playback the instant it starts, and re-syncs on pause", () => {
    // In a background tab the unlock's play() is held until the tab is shown,
    // then runs the clip for a moment before pause() lands. Measured: 7.18s on
    // screen where the scroll asked for 6.97s.
    expect(src).toContain('video.addEventListener("play", onPlay)');
    expect(src).toContain('video.addEventListener("pause", onPause)');
    expect(src).toMatch(/const onPlay = \(\) => \{\s*video\.pause\(\);/);
  });

  it("issues one seek at a time", () => {
    // Setting currentTime while a seek is still decoding makes Chrome abandon
    // and restart the work — the main cause of scrub stutter.
    expect(src).toContain("if (!seeking && Math.abs(video.currentTime - shown) >= FRAME / 2)");
    expect(src).toContain('addEventListener("seeked", onSeeked)');
  });

  it("stops the loop once the picture has caught up", () => {
    expect(src).toContain("if (shown !== target || seeking)");
  });

  it("loads after the page, not with it", () => {
    // As the hero it cannot wait for a scroll — the first scrolls would move
    // nothing — but it must not compete with the poster, which is the LCP.
    expect(src).toContain('preload="none"');
    expect(src).toContain('window.addEventListener("load", whenIdle, { once: true })');
    expect(src).toContain("requestIdleCallback");
  });

  it("never downloads the video while it is not on screen", () => {
    // display:none does not stop JavaScript. Measured on a 375px phone before
    // this guard: all 4,897 KB of video, for a hero the phone never shows.
    expect(src).toContain("if (loaded || !rendered) return;");
    expect(src).toContain("rendered = root.getClientRects().length > 0");
    // Re-checked on resize, so a window widened into the desktop layout loads it.
    expect(src).toMatch(/const onResize = \(\) => \{\s*rendered = root\.getClientRects\(\)\.length > 0;/);
  });

  it("keeps the header transparent while pinned", () => {
    expect(src).toContain('data-header-clear=""');
  });

  it("fades the intro and its shade together, and never the footer", () => {
    expect(src).toContain('root.style.setProperty("--scrub-intro"');
    expect(src.match(/opacity: "var\(--scrub-intro, 1\)"/g)?.length).toBe(2);
    const footer = src.slice(src.indexOf("{footer && ("), src.indexOf("{footer && (") + 200);
    expect(footer).not.toContain("--scrub-intro");
  });

  it("uses the measured shades", () => {
    // On the current clip: nav over every frame 5.67:1 (+26%), headline over
    // the opening frames 3.87:1 (+29%), subhead 5.44:1 (+21%). Lighten either
    // and re-measure — the subhead is the first to lose its margin.
    expect(src).toContain("rgba(26,22,20,0.68) 0%, rgba(26,22,20,0.64) 8%");
    expect(src).toContain("rgba(26,22,20,0.50) 28%, rgba(26,22,20,0.50) 62%");
  });

  it("gives reduced-motion and Data Saver visitors the poster, not two screens of scroll", () => {
    expect(src).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
    expect(src).toContain("saveData");
    expect(src).toContain("motion-reduce:h-[100dvh]");
    expect(src).toContain("data-[scrub=off]:h-[100dvh]");
  });

  it("pins a full-screen, cover-fitted frame", () => {
    expect(src).toContain("sticky top-0 h-[100dvh]");
    expect(src).toContain("object-cover");
  });
});

describe("where it sits", () => {
  const page = read("app/page.tsx");
  const code = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
  const desktopStart = code.indexOf('className="hidden lg:block"');
  const use = code.indexOf("<ScrollScrubVideo");

  it("is in the desktop tree only", () => {
    expect(use).toBeGreaterThan(desktopStart);
    expect(code.slice(0, desktopStart)).not.toContain("<ScrollScrubVideo");
  });

  it("is the hero: the first thing in the desktop tree", () => {
    expect(use).toBeLessThan(code.indexOf("<section", desktopStart));
  });
});
