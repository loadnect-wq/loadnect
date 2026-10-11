import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// /halls: the banner's read runs beside the listing's (2026-10-11).
//
// Measured on a local production build: <AdSlot> is an async component, so its
// query began only after the page's six listing reads had finished, and the
// loading.tsx boundary revealed the cards only once it returned — one more
// round trip to Sydney on every /halls view, filtered or not (~0.3 s locally).
// The page now starts that read first. Nothing is cached across requests: a
// 60 s cache of the list was built and then dropped by the owner once live
// /halls measured LCP 1.99 s (branch halls-browse-cache-60s keeps it).
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
// Checkouts on Windows are CRLF; every pattern below is written with \n.
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const h = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/supabase/public", () => ({
  getSupabasePublicClient: () => {
    if (h.fail) throw new Error("client unavailable");
    return {};
  },
}));

const { preloadActiveAds, fetchActiveAds } = await import("../ads-server");

describe("the /halls banner read starts first", () => {
  const page = code("app/halls/(browse)/page.tsx");

  it("is started before the page waits on the listing", () => {
    const preload = page.indexOf("preloadActiveAds(BANNER.placement, BANNER.limit);");
    expect(preload).toBeGreaterThan(-1);
    expect(preload).toBeLessThan(page.indexOf("await Promise.all(["));
  });

  it("asks for exactly what the slot renders, so the slot reuses it", () => {
    expect(page).toContain("<AdSlot placement={BANNER.placement} limit={BANNER.limit} />");
    expect(page.match(/<AdSlot /g)).toHaveLength(1);
    // The slot gets the started promise only because the read is per-request cached.
    expect(code("lib/ads-server.ts")).toContain("export const fetchActiveAds = cache(async function fetchActiveAds(");
  });

  it("caches nothing across requests — the listing still reads live on every visit", () => {
    expect(page).not.toContain("unstable_cache");
    expect(page).toContain("fetchHallsResult({");
  });

  it("a failing banner read is not left as an unhandled rejection", async () => {
    h.fail = true;
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      expect(() => preloadActiveAds("search_page_banner", 1)).not.toThrow();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
      // The slot's own await still sees the failure, exactly as before.
      await expect(fetchActiveAds("search_page_banner", 1)).rejects.toThrow("client unavailable");
    } finally {
      process.off("unhandledRejection", onUnhandled);
      h.fail = false;
    }
  });
});
