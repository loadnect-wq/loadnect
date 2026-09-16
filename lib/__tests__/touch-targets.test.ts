import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// 44px touch targets on the phone homepage.
//
// Measured on a 375x812 emulated phone (Android UA, touch), six controls were
// under this project's own 44px rule:
//
//   "Browse by city"   141x20      "See all →" (x2)   54x16
//   Save hall (heart)   32x32      Notifications      36x36
//   Hallnect home logo  96x28
//
// None of them was resized — that would change the design. `.hit-44` grows only
// the TAP area with an invisible, centred ::after. Verified with
// elementFromPoint 2px inside the 44px halo but outside each visible box: every
// probe landed on the control, and no halo overlapped a neighbouring control.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe(".hit-44", () => {
  const css = read("app/globals.css");
  const rule = css.slice(css.indexOf(".hit-44::after"));
  const block = rule.slice(0, rule.indexOf("}"));

  it("guarantees 44px each way while never shrinking a larger control", () => {
    expect(block).toContain("width: max(100%, 44px)");
    expect(block).toContain("height: max(100%, 44px)");
  });

  it("takes no layout space, so nothing on the page moves", () => {
    expect(block).toContain("position: absolute");
    expect(block).toContain('content: ""');
  });

  it("is centred on the control, so the halo grows evenly", () => {
    expect(block).toContain("left: 50%");
    expect(block).toContain("top: 50%");
    expect(block).toContain("translate(-50%, -50%)");
  });

  it("anchors to the control itself", () => {
    expect(css).toMatch(/\.hit-44\s*\{\s*position:\s*relative;/);
  });
});

describe("the controls that were under 44px carry it", () => {
  const cases: [string, string, RegExp][] = [
    ["Clear dates (mobile search)", "app/_components/MobileSearch.tsx", /className="hit-44 text-sm font-semibold/],
    ["See all (section headings)", "app/page.tsx", /<Link href=\{linkHref\} className="hit-44 /],
    ["Save hall heart", "app/_components/SaveHeart.tsx", /"hit-44 flex items-center justify-center rounded-full/],
    ["Notifications bell", "components/app/AppHeader.tsx", /className="hit-44 flex h-9 w-9 items-center justify-center rounded-full bg-ivory-200/],
    ["Back button", "components/app/AppHeader.tsx", /className="hit-44 flex h-9 w-9 items-center justify-center rounded-full bg-white/],
    ["Logo home link", "components/app/AppHeader.tsx", /<Link href="\/" className="hit-44 /],
  ];
  for (const [name, file, pattern] of cases) {
    it(name, () => {
      expect(read(file), `${name} lost its 44px tap area`).toMatch(pattern);
    });
  }
});

describe("the mobile search is built at 44px or more", () => {
  const src = read("app/_components/MobileSearch.tsx");

  it("rows are 56px, chips 44px, buttons 48px", () => {
    expect(src).toContain("flex min-h-14 w-full");
    expect(src).toContain("inline-flex min-h-11 items-center");
    expect(src.match(/h-12/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
