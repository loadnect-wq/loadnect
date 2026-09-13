import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// SEO invariants, pinned.
//
// WHY THIS FILE EXISTS. An audit of the SEO layer found six meta descriptions
// shipping to Google cut off mid-phrase ("…keep 97.5% of the hall…"), a
// homepage with no brand in its title, an invalid schema.org property on the
// venue node, and two reads that returned [] on a database error — which for
// the sitemap means publishing "these URLs are gone" with an HTTP 200. Every
// one of those was invisible in the repo: metadata is strings, and strings with
// no test are strings that drift.
//
// These assert PROPERTIES, not current values, so they keep working when copy
// legitimately changes. They are deliberately static — no network, no database,
// no dev server — so they run in CI in milliseconds alongside the rest of the
// suite. The things that genuinely need a live origin (does /sitemap.xml
// return 200, does every URL in it resolve) belong in SEO_MONITORING.md as a
// post-deploy check, not here, because a test that needs production to be up
// is a test that fails for reasons unrelated to the commit.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

/** Every page that is meant to be indexable, and the file that owns its metadata. */
const INDEXABLE_PAGES: { route: string; file: string }[] = [
  { route: "/",                     file: "app/page.tsx" },
  { route: "/halls",                file: "app/halls/page.tsx" },
  { route: "/about",                file: "app/about/page.tsx" },
  { route: "/premium",              file: "app/premium/page.tsx" },
  { route: "/contact",              file: "app/contact/layout.tsx" },
  { route: "/owner/register",       file: "app/owner/register/layout.tsx" },
  { route: "/terms",                file: "app/(legal)/terms/page.tsx" },
  { route: "/privacy",              file: "app/(legal)/privacy/page.tsx" },
  { route: "/refund-policy",        file: "app/(legal)/refund-policy/page.tsx" },
  { route: "/cancellation-policy",  file: "app/(legal)/cancellation-policy/page.tsx" },
  { route: "/disclaimer",           file: "app/(legal)/disclaimer/page.tsx" },
  { route: "/grievance-redressal",  file: "app/(legal)/grievance-redressal/page.tsx" },
];

/**
 * Pulls the literal string passed to `title:` / `description:` in a
 * buildMetadata call, joining adjacent "a" + "b" concatenations the way the
 * TypeScript compiler will. Template literals (the dynamic routes) are skipped
 * by design — they are covered by the length tests further down instead.
 */
function literalField(source: string, field: "title" | "description"): string | null {
  // SCOPED TO THE buildMetadata CALL. Searching the whole file finds the first
  // `title:` anywhere — in app/page.tsx that is HOW_IT_WORKS[0].title
  // ("Discover"), which is how the first version of this test cheerfully
  // asserted things about entirely the wrong string.
  const start = source.indexOf("buildMetadata({");
  if (start === -1) return null;
  const scope = source.slice(start, start + 1200);
  const re = new RegExp(`${field}:\\s*((?:"(?:[^"\\\\]|\\\\.)*"\\s*\\+?\\s*)+),`, "m");
  const m = scope.match(re);
  if (!m) return null;
  const parts = m[1].match(/"(?:[^"\\]|\\.)*"/g) ?? [];
  return parts.map((p) => JSON.parse(p) as string).join("");
}

describe("metadata: every indexable page declares one", () => {
  it.each(INDEXABLE_PAGES)("$route has a metadata source file", ({ file }) => {
    expect(exists(file), `${file} is missing`).toBe(true);
  });

  it.each(INDEXABLE_PAGES)("$route builds metadata through buildMetadata", ({ file }) => {
    // One builder is what makes canonical, robots, Open Graph and the Twitter
    // card impossible to forget on a new page. A page that hand-rolls its own
    // Metadata object is the one that will be missing a canonical.
    expect(read(file)).toMatch(/buildMetadata\(/);
  });

  it("no two indexable pages share a title or a description", () => {
    const titles = new Map<string, string>();
    const descriptions = new Map<string, string>();
    for (const { route, file } of INDEXABLE_PAGES) {
      const src = read(file);
      const t = literalField(src, "title");
      const d = literalField(src, "description");
      if (t) {
        expect(titles.has(t), `duplicate title ${JSON.stringify(t)} on ${route} and ${titles.get(t)}`).toBe(false);
        titles.set(t, route);
      }
      if (d) {
        expect(descriptions.has(d), `duplicate description on ${route} and ${descriptions.get(d)}`).toBe(false);
        descriptions.set(d, route);
      }
    }
    // Sanity: the extractor must actually be finding things, or this test
    // passes vacuously forever.
    expect(titles.size).toBeGreaterThanOrEqual(8);
    expect(descriptions.size).toBeGreaterThanOrEqual(8);
  });
});

describe("meta descriptions are never truncated by the clamp", () => {
  // buildMetadata clamps at 158 and appends an ellipsis. A clamped description
  // is one Google prints ending mid-clause, so the source string must fit.
  const LIMIT = 158;

  it.each(INDEXABLE_PAGES)("$route's description fits in 158 characters", ({ route, file }) => {
    const d = literalField(read(file), "description");
    if (d === null) return; // dynamic (template literal) — covered below
    expect(d.length, `${route} is ${d.length} chars and will ship cut off: …${d.slice(-45)}`).toBeLessThanOrEqual(LIMIT);
  });

  it("the homepage title carries the brand", () => {
    // A layout's title.template does NOT apply to a page in the same segment,
    // so app/page.tsx is the one page that must spell the brand out itself.
    // This is the site's only target for the query "hallnect".
    const t = literalField(read("app/page.tsx"), "title");
    expect(t).toBeTruthy();
    expect(t!.toLowerCase()).toContain("hallnect");
  });

  it("no page-owned title prints the brand twice", () => {
    // buildMetadata's template appends " | Hallnect"; a page-owned half that
    // also contains it renders "Contact Hallnect | Hallnect".
    for (const { route, file } of INDEXABLE_PAGES) {
      if (route === "/") continue; // the homepage owns its brand, see above
      const t = literalField(read(file), "title");
      if (!t) continue;
      expect(t.toLowerCase().includes("hallnect"), `${route} title "${t}" duplicates the brand the template adds`).toBe(false);
    }
  });
});

describe("robots.txt", () => {
  const src = read("app/robots.ts");

  it.each(["/admin", "/owner", "/customer", "/api/"])("blocks %s", (p) => {
    expect(src).toContain(`"${p}"`);
  });

  it("keeps /owner/register crawlable despite blocking /owner", () => {
    // The one public page under an otherwise-private subtree, and the page
    // whose entire job is winning inventory. Longest-match wins in robots.txt.
    expect(src).toMatch(/allow:\s*\[[^\]]*"\/owner\/register"/);
  });

  it("does NOT disallow pages that rely on noindex to be removed", () => {
    // A Disallow stops Googlebot fetching the URL, so it never reads the
    // noindex — and a linked-but-uncrawlable URL can still be indexed from the
    // anchor text alone. /login, /signup and /book/ are all linked from
    // crawlable pages and all carry noindex, so blocking them would preserve
    // exactly the listings the noindex exists to remove.
    const disallowBlock = src.slice(src.indexOf("const disallow"), src.indexOf("return {"));
    for (const p of ['"/login"', '"/signup"', '"/book/"']) {
      expect(disallowBlock.includes(p), `${p} is disallowed but depends on noindex being readable`).toBe(false);
    }
  });

  it("never blocks the static asset paths a renderer needs", () => {
    // Blocking CSS or JS makes Google render the page unstyled and judge it
    // that way. Nothing here should ever name /_next.
    expect(src).not.toContain("/_next");
  });
});

describe("sitemap", () => {
  const src = read("app/sitemap.ts");

  it("builds every URL through absoluteUrl", () => {
    // absoluteUrl strips query and hash and resolves the canonical apex, so a
    // relative or query-bearing entry cannot get in.
    expect(src).toContain("absoluteUrl(");
    expect(src).not.toMatch(/url:\s*["'`]\//);
  });

  it("filters through isPublishableUrl", () => {
    // The last guard against a preview, localhost or retired host shipping in
    // the sitemap if an env var is misconfigured at build time.
    expect(src).toContain("isPublishableUrl");
  });

  it("includes /about and /owner/register", () => {
    // Both are indexable pages that have been missing from this file before.
    expect(src).toContain('absoluteUrl("/about")');
    expect(src).toContain('absoluteUrl("/owner/register")');
  });

  it("lists no route that robots.txt disallows", () => {
    const robots = read("app/robots.ts");
    const disallowed = [...robots.matchAll(/^\s*"(\/[^"]*)",/gm)].map((m) => m[1]);
    const sitemapPaths = [...src.matchAll(/absoluteUrl\("([^"]+)"\)/g)].map((m) => m[1]);
    for (const p of sitemapPaths) {
      const blocked = disallowed.find(
        (d) => p === d || (d.endsWith("/") ? p.startsWith(d) : p === d || p.startsWith(d + "/")),
      );
      // /owner/register is the documented exception: an explicit Allow overrides
      // the broader /owner Disallow.
      if (p === "/owner/register") continue;
      expect(blocked, `${p} is in the sitemap but disallowed by ${blocked}`).toBeUndefined();
    }
  });
});

describe("reads that decide indexability must not fail open", () => {
  // THE DEFECT THIS PROJECT KEEPS REDISCOVERING. Returning [] on a query error
  // makes a city page noindex and empties the sitemap behind an HTTP 200 —
  // both look perfectly healthy. Both routes are ISR, so throwing instead keeps
  // the last good render.
  it("fetchIndexableCities uses the strict reader", () => {
    const src = read("lib/seo/cities.ts");
    const fn = src.slice(src.indexOf("export async function fetchIndexableCities"));
    expect(fn).toContain("fetchCityInventoryStrict");
  });

  it("fetchCityInventoryBySlug uses the strict reader", () => {
    const src = read("lib/seo/cities.ts");
    const fn = src.slice(
      src.indexOf("export async function fetchCityInventoryBySlug"),
      src.indexOf("export async function fetchIndexableCities"),
    );
    expect(fn).toContain("fetchCityInventoryStrict");
  });

  it("the strict reader throws rather than returning a value", () => {
    const src = read("lib/seo/cities.ts");
    const fn = src.slice(src.indexOf("export async function fetchCityInventoryStrict"));
    expect(fn.slice(0, 600)).toContain("throw new Error");
  });

  it("the sitemap's venue query throws on error", () => {
    const src = read("lib/seo/sitemap-data.ts");
    expect(src).toContain("throw new Error");
    // The specific regression: `return []` inside the error branch.
    const errBranch = src.slice(src.indexOf("if (error)"), src.indexOf("if (error)") + 700);
    expect(errBranch).not.toMatch(/return\s*\[\s*\]/);
  });
});

describe("structured data claims nothing the page cannot show", () => {
  const src = read("lib/seo/jsonld.ts");

  it("does not put priceRange on the EventVenue node", () => {
    // schema.org defines priceRange on LocalBusiness. An invalid property on a
    // type is at best ignored and at worst counted against the markup.
    const venue = src.slice(src.indexOf("EventVenue"));
    expect(venue).not.toMatch(/^\s*priceRange:/m);
  });

  it("never multi-types the venue as a LocalBusiness", () => {
    // That would imply a storefront Hallnect does not operate, and contradict
    // the Google Business Profile's service-area registration.
    expect(src).not.toMatch(/"@type":\s*\[\s*"EventVenue"\s*,\s*"LocalBusiness"/);
  });

  it("emits aggregateRating only when there are real ratings", () => {
    // A rating invented from zero reviews is the single most common cause of a
    // structured-data manual action.
    expect(src).toMatch(/aggregateRating:\s*hasRatings\s*\?/);
  });

  it("declares no social profiles", () => {
    // sameAs must stay absent until a verified profile actually exists —
    // inventing one is fabricating business information.
    expect(src).not.toMatch(/^\s*sameAs:/m);
  });

  it("normalises the state before publishing it", () => {
    expect(src).toContain("canonicalState(");
  });
});

describe("canonical host", () => {
  const config = read("lib/seo/config.ts");

  it("names the hosts that must never appear in a canonical", () => {
    for (const host of ["vercel.app", "localhost"]) {
      expect(config).toContain(host);
    }
  });

  it("strips query and hash when building a canonical", () => {
    // /halls?sort=rating is the same page as /halls for indexing.
    const fn = config.slice(config.indexOf("export function absoluteUrl"));
    expect(fn).toContain('split("?")');
    expect(fn).toContain('split("#")');
  });
});

describe("public images carry real alt text", () => {
  it("the venue card's alt describes the venue, not the file", () => {
    const src = read("app/halls/_components/HallCard.tsx");
    expect(src).toMatch(/alt=\{`\$\{hall\.name\}/);
  });

  it("gallery alt text is generated per image rather than repeated", () => {
    // Every image on a venue page once rendered the same string, which is
    // useless to a screen reader and to image search alike.
    expect(read("lib/seo/venue.ts")).toContain("export function venueImageAlt");
  });
});
