import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// SEO phase 2 (2026-10-08): the technical foundation the audit asked for.
//   • The public venue page is cached (ISR) and reads approved halls only, so
//     its metadata is in the <head>, a missing venue is a real 404, and the
//     page is in the HTML — previews moved to /halls/[slug]/preview.
//   • Crawlers Next does not list get metadata in the <head> anyway.
//   • robots.txt names the search and AI crawlers without opening anything.
//   • City aliases (trichy, kovai…) 301 to the page that exists.
//   • /llms.txt, from the live catalogue.
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// ── A fake Supabase for the venue read ──────────────────────────────────────
const h = vi.hoisted(() => ({
  filters: [] as [string, unknown][],
  hallReply: { data: null as unknown, error: null as { code?: string; message: string } | null },
  usedPublic: 0,
  usedSession: 0,
}));

class Q {
  table: string;
  constructor(t: string) { this.table = t; }
  select() { return this; }
  eq(col: string, v: unknown) { if (this.table === "halls") h.filters.push([col, v]); return this; }
  gte() { return this; }
  lte() { return this; }
  order() { return this; }
  limit() { return this; }
  neq() { return this; }
  maybeSingle() { return this; }
  then<T>(res: (v: unknown) => T) {
    const reply = this.table === "halls" ? h.hallReply : { data: [], error: null };
    return Promise.resolve(reply).then(res);
  }
}
const fakeDb = { from: (t: string) => new Q(t), rpc: async () => ({ data: null, error: null }) };

vi.mock("@/lib/supabase/public", () => ({ getSupabasePublicClient: () => { h.usedPublic++; return fakeDb; } }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: async () => { h.usedSession++; return fakeDb; } }));

const { fetchHallBySlug } = await import("../halls");
const { buildLlmsTxt } = await import("../seo/llms");
const { CITY_ALIASES, cityAliasRedirects } = await import("../seo/city-aliases");
const { SERVICE_AREA_CITIES } = await import("../seo/service-areas");
const { citySlug } = await import("../seo/cities");
const robots = (await import("../../app/robots")).default;
const nextConfig = (await import("../../next.config")).default;

beforeEach(() => {
  h.filters = [];
  h.hallReply = { data: null, error: null };
  h.usedPublic = 0;
  h.usedSession = 0;
});

describe("the public venue read (fetchHallBySlug publicOnly)", () => {
  it("reads cookie-free and asks for an APPROVED hall only", async () => {
    expect(await fetchHallBySlug("some-hall", { publicOnly: true })).toBeNull();
    expect(h.usedPublic).toBeGreaterThan(0);
    expect(h.usedSession).toBe(0);
    expect(h.filters).toEqual(expect.arrayContaining([["slug", "some-hall"], ["status", "approved"]]));
  });

  it("THROWS on a failed read, so ISR keeps the last good page instead of caching a 404", async () => {
    h.hallReply = { data: null, error: { code: "57014", message: "statement timeout" } };
    await expect(fetchHallBySlug("some-hall", { publicOnly: true })).rejects.toThrow(/venue read failed/);
  });

  it("the preview keeps the session client, no status filter, and null on error", async () => {
    h.hallReply = { data: null, error: { code: "57014", message: "statement timeout" } };
    expect(await fetchHallBySlug("some-hall")).toBeNull();
    expect(h.usedSession).toBeGreaterThan(0);
    expect(h.filters.some(([c]) => c === "status")).toBe(false);
  });
});

describe("the venue routes", () => {
  const page = read("app/halls/[slug]/page.tsx");
  const preview = read("app/halls/[slug]/preview/page.tsx");

  it("the public page is cached and reads live halls only", () => {
    expect(page).toContain("export const revalidate = 300;");
    expect(page).toContain("export async function generateStaticParams()");
    expect(page).toContain("fetchHallBySlug(slug, { publicOnly: true })");
    expect(page).not.toMatch(/getSession|cookies\(|headers\(|getSupabaseServerClient/);
    expect(page).toContain("if (!hall) notFound();");
  });

  it("the preview is noindex, session-aware, and sends a live hall to its public page", () => {
    expect(preview).toContain('noindexMetadata("Venue preview")');
    expect(preview).toContain("await fetchHallBySlug(slug);");
    expect(preview).toContain('if (hall.status === "approved") redirect(`/halls/${hall.slug}`);');
    expect(preview).toContain("<VenuePage hall={hall} isPreview />");
  });

  it("no loading boundary wraps the public venue page (it made a missing venue a soft 404)", () => {
    // A loading.tsx wraps every page below it in Suspense, and a boundary means
    // the response streams as 200 before notFound() can run. Found the hard
    // way: the listing's and the preview's loading.tsx were ALSO applied to the
    // venue page until each got a layout of its own — the production build
    // answered 200 for a missing venue and hid its text in a streamed block.
    const at = (p: string) => existsSync(join(root, p));
    expect(at("app/halls/loading.tsx")).toBe(false);
    expect(at("app/halls/[slug]/loading.tsx")).toBe(false);
    expect(at("app/loading.tsx")).toBe(false);
    // Each loading.tsx that remains nearby is scoped by its own layout.
    expect(at("app/halls/(browse)/loading.tsx") && at("app/halls/(browse)/layout.tsx")).toBe(true);
    expect(at("app/halls/[slug]/preview/loading.tsx") && at("app/halls/[slug]/preview/layout.tsx")).toBe(true);
  });

  it("owners and admins are sent to the preview for a hall that is not live", () => {
    expect(read("app/owner/(dashboard)/halls/page.tsx")).toContain('hall.status === "approved" ? `/halls/${hall.slug}` : `/halls/${hall.slug}/preview`');
    expect(read("app/admin/hall-approvals/page.tsx")).toContain("href={`/halls/${h.slug}/preview`}");
  });

  it("changes that show on a venue page refresh the cache at once", () => {
    const admin = read("app/admin/actions.ts");
    expect(admin.match(/revalidateVenuePages\(\);/g)?.length).toBeGreaterThanOrEqual(5);
    const owner = read("app/owner/(dashboard)/actions.ts");
    expect(owner.match(/revalidateVenuePages\(\);/g)?.length).toBeGreaterThanOrEqual(5);
    expect(read("lib/revalidate-venues.ts")).toContain('revalidatePath("/halls/[slug]", "page");');
  });
});

describe("crawlers Next does not list still get metadata in the <head>", () => {
  const bots = nextConfig.htmlLimitedBots as RegExp;
  const UA = {
    googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    gptbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
    oai: "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
    claude: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    perplexity: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    // Next's own list, which setting the option replaces — kept verbatim.
    bing: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    adsbot: "AdsBot-Google (+http://www.google.com/adsbot.html)",
    whatsapp: "WhatsApp/2.23.20.0",
  };
  it.each(Object.entries(UA))("%s", (_name, ua) => expect(bots.test(ua)).toBe(true));
  it("but not a person's browser, who keeps the streamed response", () => {
    expect(bots.test("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36")).toBe(false);
  });
});

describe("robots.txt", () => {
  const r = robots();
  const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
  const named = rules.find((x) => Array.isArray(x.userAgent))!;
  const star = rules.find((x) => x.userAgent === "*")!;

  it("names the search and AI crawlers", () => {
    expect(named.userAgent).toEqual(["Googlebot", "Bingbot", "GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]);
  });

  it("gives them the SAME blocks as everyone (a named group ignores *)", () => {
    expect(named.disallow).toEqual(star.disallow);
    expect(named.allow).toEqual(star.allow);
    for (const p of ["/admin", "/owner", "/customer", "/api/", "/halls/*/preview"]) expect(star.disallow).toContain(p);
    expect(star.allow).toContain("/owner/register");
    expect(r.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});

describe("city aliases", () => {
  const real = new Set(SERVICE_AREA_CITIES.map((c) => citySlug(c)));

  it("every alias lands on a real city page, never a 404", () => {
    for (const [alias, target] of Object.entries(CITY_ALIASES)) {
      expect(real.has(target), `${alias} -> ${target}`).toBe(true);
      expect(real.has(alias), `${alias} is itself a city`).toBe(false);
    }
    expect(CITY_ALIASES.trichy).toBe("tiruchirappalli");
  });

  it("are 301s, wired into next.config, with the wedding hub in one hop", async () => {
    const rs = cityAliasRedirects();
    expect(rs.every((x) => x.statusCode === 301)).toBe(true);
    const all = await nextConfig.redirects!();
    expect(all).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "/wedding-halls/trichy", destination: "/wedding-halls/tiruchirappalli" }),
      expect.objectContaining({ source: "/ta/wedding-halls/kovai", destination: "/ta/wedding-halls/coimbatore" }),
      expect.objectContaining({ source: "/pricing", destination: "/premium" }),
    ]));
    const wedding = all.findIndex((x) => x.source === "/venues/wedding/trichy");
    const generic = all.findIndex((x) => x.source === "/venues/:category/trichy");
    expect(wedding).toBeGreaterThan(-1);
    expect(wedding).toBeLessThan(generic);
    expect(all[wedding].destination).toBe("/wedding-halls/tiruchirappalli");
  });
});

describe("/llms.txt", () => {
  const base = {
    siteUrl: "https://hallnect.com",
    generatedOn: "2026-10-08",
    venues: [{ name: "NS KHALYAANA MAHAL", slug: "ns-khalyaana-mahal-madurai", city: "Madurai", capacityMax: 450, pricePerDay: 160000, bookingMode: "LEAD_GENERATION" }],
    cities: [{ city: "Madurai", slug: "madurai", venueCount: 1 }],
    directBookingEnabled: true,
    feeDisclosure: "₹100 platform fee plus 18% GST (₹118)",
    contact: { legalName: "HALLNECT LLP", email: "hallnect@gmail.com", phone: "+91 9344040013", address: "No. 68, Madurai" },
    supportHours: "every day, 9 AM – 9 PM IST",
  };

  it("says what Hallnect is, who runs it, and states only real venues and cities", () => {
    const t = buildLlmsTxt(base);
    expect(t.startsWith("# Hallnect\n\n> Hallnect is an online marketplace")).toBe(true);
    expect(t).toContain("Hallnect is run by HALLNECT LLP, based in Madurai.");
    expect(t).toContain("- Live venues: 1 venue (cities with a venue page: Madurai).");
    expect(t).toContain("- [NS KHALYAANA MAHAL, Madurai](https://hallnect.com/halls/ns-khalyaana-mahal-madurai): up to 450 guests; ₹1,60,000 per day; quotes");
    expect(t).toContain("- [Wedding halls in Madurai](https://hallnect.com/wedding-halls/madurai): 1 venue, prices and a city guide");
    expect(t).toContain("- [Sitemap](https://hallnect.com/sitemap.xml)");
  });

  it("never states the commission rate", () => {
    const t = buildLlmsTxt(base);
    expect(t).not.toMatch(/commission[^.\n]*\d/i);
    expect(t).not.toMatch(/2\.5\s*%/);
  });

  it("describes online booking only while it is switched on", () => {
    expect(buildLlmsTxt(base)).toContain("- Online booking (on halls that offer it)");
    const off = buildLlmsTxt({ ...base, directBookingEnabled: false });
    expect(off).not.toContain("Online booking");
    expect(off).not.toContain("book online with an advance");
  });

  it("caps the venue list and points to /halls for the rest", () => {
    const venues = Array.from({ length: 105 }, (_, i) => ({ ...base.venues[0], name: `Hall ${i}`, slug: `hall-${i}` }));
    const t = buildLlmsTxt({ ...base, venues });
    expect(t.match(/^- \[Hall \d+, Madurai\]/gm)?.length).toBe(100);
    expect(t).toContain("- [All 105 venues](https://hallnect.com/halls)");
  });

  it("is served from the live catalogue, hourly, as text", () => {
    const route = read("app/llms.txt/route.ts");
    expect(route).toContain("export const revalidate = 3600;");
    expect(route).toContain("fetchIndexableCities(), fetchLiveVenueFacts()");
    expect(route).toContain('"Content-Type": "text/plain; charset=utf-8"');
  });
});
