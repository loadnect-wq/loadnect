import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// The scroll-scrubbed walk-through on the homepage.
//
// Half of this feature is the video FILE, and a replacement file is the most
// likely way to break it — silently. The source clip had ONE keyframe in 240
// frames plus 179 B-frames, and measured in Chrome that meant a median 279ms
// per seek, worst 982ms: the picture froze on every scroll. So the first block
// below parses the shipped MP4 and fails the build if it would scrub badly.
//
// To replace the clip, re-encode with (1280x720 shown; keep your source size):
//
//   ffmpeg -i SOURCE.mp4 -an -c:v libx264 -preset slow -crf 26 \
//     -g 6 -keyint_min 6 -bf 0 -tune fastdecode \
//     -x264-params scenecut=0 -pix_fmt yuv420p -movflags +faststart \
//     public/scrub/hall-walkthrough.mp4
//
// Measured alternatives, same clip, Chrome: keyframe every 24 frames seeked in
// 7ms median but 119ms worst; every frame (crf 28) seeked in a flat 6ms but
// visibly smeared detail (SSIM 0.943 vs 0.974 for the command above).
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

  it("issues one seek at a time", () => {
    // Setting currentTime while a seek is still decoding makes Chrome abandon
    // and restart the work — the main cause of scrub stutter.
    expect(src).toContain("if (!seeking && Math.abs(video.currentTime - shown) >= FRAME / 2)");
    expect(src).toContain('addEventListener("seeked", onSeeked)');
  });

  it("stops the loop once the picture has caught up", () => {
    expect(src).toContain("if (shown !== target || seeking)");
  });

  it("does not download until the visitor has actually scrolled", () => {
    // A distance margin alone fired on page load for most desktop heights.
    expect(src).toContain("if (loaded || !userScrolled) return;");
    expect(src).toContain('preload="none"');
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

  it("is not in the hero, which stays static with the search pill on its edge", () => {
    const heroEnd = code.indexOf("</section>", desktopStart);
    expect(use).toBeGreaterThan(heroEnd);
  });
});
