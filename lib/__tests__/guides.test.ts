import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  GUIDES,
  GUIDES_INDEX_TEXT,
  GUIDES_PATH,
  guideIndexable,
  guideLanguageAlternates,
  guidePath,
  guidesIndexIndexable,
  type Guide,
} from "../guides";
import { guideMetadata, guidesIndexMetadata } from "../seo/guide-metadata";
import { DESCRIPTION_MAX, TITLE_MAX, renderedTitle } from "../seo/metadata";
import { ORGANIZATION_ID, articleJsonLd } from "../seo/jsonld";
import { PLAN_CATEGORIES } from "../plan";
import { CUSTOMER_REFUND_SCHEDULE } from "../refund-schedule";
import { buildLlmsTxt } from "../seo/llms";
import { FOOTER_LINKS } from "../constants";
import {
  EXPENSE_TEXT,
  ExpenseListGuide,
  expenseFaqs,
  expenseGroups,
  expenseLead,
} from "@/components/guides/ExpenseListGuide";
import { ADVANCE_QUESTIONS, HallAdvanceGuide, advanceFaqs, refundRows } from "@/components/guides/HallAdvanceGuide";
import { GuidesIndex, guidesIndexCards } from "@/components/guides/GuidesIndex";
import { thisMonthMuhurtham } from "@/components/muhurtham/MuhurthamPage";

// ─────────────────────────────────────────────────────────────────────────────
// The planning guides (2026-10-11): /guides, two guides in English and Tamil,
// and the "this month" block on the muhurtham page — the first three topics
// of the content plan, chosen because every fact they need already exists in
// the product.
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const visibleText = (html: string) =>
  decode(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
const jsonLdNodes = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => {
    const d = JSON.parse(m[1]);
    return d["@graph"] ?? [d];
  });

const renders = [
  { name: "expense list", slug: "wedding-expense-list", comp: ExpenseListGuide, faqs: expenseFaqs },
  { name: "hall advance", slug: "before-you-pay-a-hall-advance", comp: HallAdvanceGuide, faqs: advanceFaqs },
] as const;

describe("the guide list", () => {
  it("has unique slugs, real dates and nothing under /owner (robots.txt blocks that prefix)", () => {
    const slugs = GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const g of GUIDES) {
      expect(g.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(g.updated >= g.published).toBe(true);
      for (const lang of ["en", "ta"] as const) expect(guidePath(g.slug, lang).startsWith("/owner")).toBe(false);
    }
    expect(read("app/robots.ts")).not.toContain('"/guides');
    expect(read("app/robots.ts")).not.toContain('"/ta"');
  });

  it("fits every title and description in the space search results give it", () => {
    const texts = [...GUIDES.flatMap((g) => [g.en, g.ta]), GUIDES_INDEX_TEXT.en, GUIDES_INDEX_TEXT.ta];
    for (const t of texts) {
      expect(renderedTitle(t.title).length, t.title).toBeLessThanOrEqual(TITLE_MAX);
      expect(t.description.length, t.description).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });
});

describe("Tamil is indexed only after a native speaker has read it", () => {
  const unreviewed = GUIDES.filter((g) => !g.taReviewed);

  it("today: every Tamil twin is unreviewed, so noindex, out of hreflang", () => {
    expect(unreviewed.length).toBe(GUIDES.length);
    for (const g of GUIDES) {
      expect(guideIndexable(g, "en")).toBe(true);
      expect(guideIndexable(g, "ta")).toBe(false);
      expect(guideLanguageAlternates(g)).toBeUndefined();
      const ta = guideMetadata(g.slug, "ta");
      expect(ta.robots).toEqual({ index: false, follow: true });
      expect(ta.alternates).toBeUndefined();
      const en = guideMetadata(g.slug, "en");
      expect((en.robots as { index: boolean }).index).toBe(true);
      expect(en.alternates?.canonical).toMatch(new RegExp(`${guidePath(g.slug, "en")}$`));
      expect(en.alternates?.languages).toBeUndefined();
    }
    expect(guidesIndexIndexable("ta")).toBe(false);
    expect(guidesIndexMetadata("ta").robots).toEqual({ index: false, follow: true });
  });

  it("once reviewed, both twins name each other", () => {
    const reviewed: Guide = { ...GUIDES[0], taReviewed: true };
    expect(guideIndexable(reviewed, "ta")).toBe(true);
    expect(guideLanguageAlternates(reviewed)).toEqual({
      "en-IN": guidePath(reviewed.slug, "en"),
      "ta-IN": guidePath(reviewed.slug, "ta"),
      "x-default": guidePath(reviewed.slug, "en"),
    });
  });

  it("the sitemap and /llms.txt apply the same gate", () => {
    const sitemap = read("app/sitemap.ts");
    expect(sitemap).toContain("...guideSitemapEntries(),");
    expect(sitemap).toContain(".filter((lang) => guideIndexable(g, lang))");
    expect(sitemap).toContain(".filter((lang) => guidesIndexIndexable(lang))");
    const llms = buildLlmsTxt({
      siteUrl: "https://hallnect.com", generatedOn: "2026-10-11", venues: [], cities: [],
      directBookingEnabled: true, feeDisclosure: "f",
      contact: { legalName: "L", email: "e", phone: "p", address: "a" }, supportHours: "h",
    });
    for (const g of GUIDES) expect(llms).toContain(`(https://hallnect.com${guidePath(g.slug, "en")})`);
    expect(llms).not.toContain("/ta/guides/");
  });
});

describe("what the pages print is what the markup says", () => {
  for (const r of renders) {
    for (const lang of ["en", "ta"] as const) {
      it(`${r.name} (${lang}): Article headline is the H1, FAQ markup is the visible FAQ`, () => {
        const html = renderToStaticMarkup(createElement(r.comp, { lang }));
        const text = visibleText(html);
        const nodes = jsonLdNodes(html);
        const guide = GUIDES.find((g) => g.slug === r.slug)!;

        const h1 = decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)![1].replace(/<[^>]+>/g, "").trim());
        expect(h1).toBe(guide[lang].heading);
        expect((html.match(/<h1\b/g) ?? []).length).toBe(1);

        const article = nodes.find((n) => n["@type"] === "Article");
        expect(article.headline).toBe(h1);
        expect(article.inLanguage).toBe(lang === "ta" ? "ta-IN" : "en-IN");
        expect(article.dateModified).toBe(guide.updated);
        expect(html).toContain(`dateTime="${guide.updated}"`);

        const faq = nodes.find((n) => n["@type"] === "FAQPage");
        const expected = r.faqs(lang);
        expect(faq.mainEntity.map((q: { name: string }) => q.name)).toEqual(expected.map((f) => f.q));
        for (const f of expected) {
          expect(text).toContain(f.q);
          expect(text).toContain(f.a);
        }
        expect(nodes.some((n) => n["@type"] === "BreadcrumbList")).toBe(true);
      });
    }
  }

  it("the author is Hallnect, by reference, not an invented person", () => {
    const a = articleJsonLd({ path: "/guides/x", headline: "h", description: "d", inLanguage: "en-IN", datePublished: "2026-10-11", dateModified: "2026-10-11" });
    expect(a.author).toEqual({ "@id": ORGANIZATION_ID });
    expect(a.publisher).toEqual({ "@id": ORGANIZATION_ID });
  });
});

describe("the expense list is the planner's list", () => {
  it("covers every planner category, in the planner's order, in both languages", () => {
    expect(Object.keys(EXPENSE_TEXT).sort()).toEqual(PLAN_CATEGORIES.map((c) => c.key).sort());
    for (const lang of ["en", "ta"] as const) {
      const groups = expenseGroups(lang);
      expect(groups.map((g) => g.key)).toEqual(PLAN_CATEGORIES.map((c) => c.key));
      for (const g of groups) {
        expect(g.label.length).toBeGreaterThan(0);
        expect(g.covers.length).toBeGreaterThan(0);
        expect(g.price.length).toBeGreaterThan(0);
      }
    }
    expect(expenseGroups("en")[0].covers).toBe(PLAN_CATEGORIES[0].hint);
  });

  it("counts its groups from the list", () => {
    expect(expenseLead("en")).toContain(`fall into ${PLAN_CATEGORIES.length} groups`);
    expect(expenseLead("ta")).toContain(`${PLAN_CATEGORIES.length} வகைகளில்`);
  });

  it("states no prices — not one rupee figure anywhere on the page", () => {
    for (const lang of ["en", "ta"] as const) {
      const text = visibleText(renderToStaticMarkup(createElement(ExpenseListGuide, { lang })));
      expect(text, lang).not.toMatch(/₹\s?\d/);
      expect(text, lang).not.toMatch(/\b(?:Rs\.?|INR)\s?\d/);
      expect(text, lang).not.toMatch(/\baverage\b/i);
    }
  });
});

describe("the hall advance guide", () => {
  it("asks the twelve questions its card promises, in both languages", () => {
    expect(ADVANCE_QUESTIONS.en.length).toBe(12);
    expect(ADVANCE_QUESTIONS.ta.length).toBe(12);
    const g = GUIDES.find((x) => x.slug === "before-you-pay-a-hall-advance")!;
    expect(g.en.card).toMatch(/^Twelve /);
    expect(g.ta.card).toContain("பன்னிரண்டு");
  });

  it("prints the refund schedule the checkout applies, row for row", () => {
    expect(refundRows("en")).toEqual([
      { when: "31 days or more before the function", back: "100% of the advance" },
      { when: "15 to 30 days before", back: "75% of the advance" },
      { when: "7 to 14 days before", back: "50% of the advance" },
      { when: "Less than 7 days before", back: "Nothing" },
    ]);
    expect(refundRows("ta")).toHaveLength(CUSTOMER_REFUND_SCHEDULE.length);
    const html = renderToStaticMarkup(createElement(HallAdvanceGuide, { lang: "en" }));
    for (const row of refundRows("en")) expect(visibleText(html)).toContain(row.when);
    expect(visibleText(html)).toContain("₹100 platform fee plus 18% GST (₹118)");
  });
});

describe("the guides index and the links into it", () => {
  it("lists every guide and the muhurtham page, and its markup lists the same", () => {
    const html = renderToStaticMarkup(createElement(GuidesIndex, { lang: "en" }));
    const cards = guidesIndexCards("en");
    expect(cards.map((c) => c.href)).toEqual([...GUIDES.map((g) => guidePath(g.slug, "en")), "/muhurtham-dates"]);
    const list = jsonLdNodes(html).find((n) => n["@type"] === "CollectionPage").mainEntity;
    expect(list.numberOfItems).toBe(cards.length);
    for (const c of cards) expect(visibleText(html)).toContain(c.title);
  });

  it("is linked from the footer, the tools hub and the budget calculator", () => {
    expect(FOOTER_LINKS.plan.map((l) => l.href)).toContain(GUIDES_PATH.en);
    expect(read("app/tools/page.tsx")).toContain("href={guidePath(g.slug, \"en\")}");
    expect(read("app/budget/page.tsx")).toContain('guidePath("wedding-expense-list", "en")');
  });
});

describe("muhurtham dates this month", () => {
  it("shows what is left of this month and all of next month", () => {
    expect(thisMonthMuhurtham("2026-10-11")).toEqual([
      { month: "2026-10", dates: ["2026-10-25", "2026-10-30"] },
      { month: "2026-11", dates: ["2026-11-01", "2026-11-11", "2026-11-13", "2026-11-15", "2026-11-16", "2026-11-20", "2026-11-29"] },
    ]);
  });

  it("says a month has none left rather than hiding it", () => {
    const [current] = thisMonthMuhurtham("2026-10-31");
    expect(current).toEqual({ month: "2026-10", dates: [] });
  });

  it("rolls over the year", () => {
    expect(thisMonthMuhurtham("2026-12-20").map((m) => m.month)).toEqual(["2026-12", "2027-01"]);
  });

  it("never calls an unchecked month empty", () => {
    // December 2027 is the last month the list covers; January 2028 is not
    // "without dates", it has not been checked yet.
    expect(thisMonthMuhurtham("2027-12-01").map((m) => m.month)).toEqual(["2027-12"]);
  });
});
