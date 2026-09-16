import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// The filter sheet opened in the wrong place, and there were TWO reasons.
//
// Measured in a real browser at 1025x768 before the fix:
//   panel x=512 (centred would be 257), bottom=909 against a 768px viewport.
// So it was pushed into the right half of the screen AND hung below the fold,
// with "Clear all" / "Show results" unreachable.
//
//   1. CONTAINING BLOCK. `position: fixed` is viewport-relative only while no
//      ancestor establishes a containing block — and transform, filter,
//      perspective, contain and BACKDROP-FILTER all do. /halls renders the sheet
//      inside `<div class="sticky top-14 ... backdrop-blur">`, so `bottom: 0`
//      resolved to the bottom of that sticky search bar (y=217) rather than the
//      window. The sheet now portals to <body>, which no ancestor can reach.
//
//   2. TRANSFORM COLLISION. The panel carried `sm:-translate-x-1/2`, which
//      Tailwind implements as a `transform` declaration — and framer-motion
//      animates `y` by writing an INLINE transform on the same element, which
//      beats a class. The -50% X shift was silently discarded while `left: 50%`
//      survived. Centring moved to a flex wrapper so position and motion no
//      longer share a property.
//
// Source-level invariants: the behaviour is browser geometry, which a jsdom
// test cannot honestly assert. These fail the build if either guard is undone.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const sheet = fs.readFileSync(path.join(ROOT, "components/app/BottomSheet.tsx"), "utf8");

/** The rendered JSX, not the comments explaining it. */
function renderBody(): string {
  const start = sheet.indexOf("return createPortal(");
  expect(start, "the sheet no longer portals — see reason 1").toBeGreaterThan(-1);
  const body = sheet.slice(start);
  expect(body, "slice missed the panel").toContain('role="dialog"');
  return body;
}

describe("the sheet escapes whatever it is rendered inside", () => {
  it("portals to document.body", () => {
    expect(sheet).toContain('import { createPortal } from "react-dom";');
    expect(renderBody()).toContain("document.body");
  });

  it("decides client-side without a hydration mismatch or setState in an effect", () => {
    // A mounted flag set in useEffect would trip react-hooks/set-state-in-effect,
    // which this repo lints as an error-shaped warning at a zero baseline.
    expect(sheet).toContain("useSyncExternalStore");
    expect(sheet).toContain("if (!onClient) return null;");
  });
});

describe("position and motion no longer fight over `transform`", () => {
  const body = renderBody();

  it("the animated panel carries no Tailwind translate class", () => {
    // This is the whole of reason 2. framer-motion's inline transform wins, so
    // any translate utility on this element is dead code that silently changes
    // where the sheet lands.
    const panelStart = body.indexOf('role="dialog"');
    const panelEnd = body.indexOf(">", body.indexOf("transition={{", panelStart));
    const panel = body.slice(panelStart, panelEnd);
    expect(panel).not.toMatch(/-?translate-x-/);
    expect(panel).not.toMatch(/-?translate-y-/);
    expect(panel).not.toContain("left-1/2");
  });

  it("centring is done by the wrapper, with flexbox", () => {
    expect(body).toContain("fixed inset-x-0 bottom-0");
    expect(body).toContain("justify-center");
  });

  it("the wrapper cannot swallow clicks meant for the backdrop", () => {
    // It spans the full width at the bottom of the screen; without this the
    // empty areas either side of the panel would eat backdrop clicks.
    expect(body).toContain("pointer-events-none");
    expect(body).toContain("pointer-events-auto");
  });

  it("the panel still animates on the axis it is supposed to", () => {
    expect(body).toContain('initial={{ y: "100%" }}');
    expect(body).toContain("animate={{ y: 0 }}");
  });
});

describe("a tall sheet stays usable", () => {
  const body = renderBody();

  it("is capped and scrolls internally, so the footer is always reachable", () => {
    expect(body).toContain("max-h-[90vh]");
    expect(body).toContain("flex-col");
    expect(body).toContain("overflow-y-auto");
  });

  it("is full-bleed on a phone and capped on a larger screen", () => {
    expect(body).toContain("w-full");
    expect(body).toContain("sm:max-w-lg");
  });
});
