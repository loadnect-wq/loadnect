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
  guideText,
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
import {
  HallCostGuide,
  MIN_HALLS_FOR_CITY_PRICES,
  cityPriceRanges,
  costFaqs,
  type CityPriceRow,
} from "@/components/guides/HallCostGuide";
import { PARTY_FAQS, PartyHallGuide } from "@/components/guides/PartyHallGuide";
import { RECEIPT_FAQS, ReceiptGuide } from "@/components/guides/ReceiptGuide";
import { PAYMENT_MODES, paymentModeText, receiptAmounts, receiptDate } from "@/components/guides/ReceiptTemplate";
import { existsSync } from "node:fs";
import type { ReactElement } from "react";
import type { GuideLang } from "../guides";

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

const SAMPLE_ROWS: CityPriceRow[] = [{ city: "Madurai", slug: "madurai", halls: 3, from: 90_000, to: 2_10_000 }];

/** Every guide page, rendered the way its route renders it, in each language it has. */
const renders: {
  name: string;
  slug: string;
  langs: readonly GuideLang[];
  render: (lang: GuideLang) => ReactElement;
  faqs: (lang: GuideLang) => { q: string; a: string }[];
}[] = [
  { name: "expense list", slug: "wedding-expense-list", langs: ["en", "ta"], render: (lang) => createElement(ExpenseListGuide, { lang }), faqs: expenseFaqs },
  { name: "hall advance", slug: "before-you-pay-a-hall-advance", langs: ["en", "ta"], render: (lang) => createElement(HallAdvanceGuide, { lang }), faqs: advanceFaqs },
  { name: "hall cost", slug: "wedding-hall-cost-tamil-nadu", langs: ["en", "ta"], render: (lang) => createElement(HallCostGuide, { lang, rows: SAMPLE_ROWS, asOf: "2026-10-11" }), faqs: costFaqs },
  { name: "party hall", slug: "birthday-party-hall", langs: ["en"], render: () => createElement(PartyHallGuide), faqs: () => PARTY_FAQS },
  { name: "booking receipt", slug: "marriage-hall-booking-receipt", langs: ["en"], render: () => createElement(ReceiptGuide), faqs: () => RECEIPT_FAQS },
];

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
    const texts = [...GUIDES.flatMap((g) => (g.ta ? [g.en, g.ta] : [g.en])), GUIDES_INDEX_TEXT.en, GUIDES_INDEX_TEXT.ta];
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
      if (g.ta) {
        const ta = guideMetadata(g.slug, "ta");
        expect(ta.robots).toEqual({ index: false, follow: true });
        expect(ta.alternates).toBeUndefined();
      }
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
  it("every guide in the list is rendered here, in every language it has", () => {
    expect(renders.map((r) => r.slug).sort()).toEqual(GUIDES.map((g) => g.slug).sort());
    for (const r of renders) {
      const g = GUIDES.find((x) => x.slug === r.slug)!;
      expect([...r.langs], r.slug).toEqual(g.ta ? ["en", "ta"] : ["en"]);
    }
  });

  for (const r of renders) {
    for (const lang of r.langs) {
      it(`${r.name} (${lang}): Article headline is the H1, FAQ markup is the visible FAQ`, () => {
        const html = renderToStaticMarkup(r.render(lang));
        const text = visibleText(html);
        const nodes = jsonLdNodes(html);
        const guide = GUIDES.find((g) => g.slug === r.slug)!;

        const h1 = decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)![1].replace(/<[^>]+>/g, "").trim());
        expect(h1).toBe(guideText(guide, lang).heading);
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
    expect(guideText(g, "ta").card).toContain("பன்னிரண்டு");
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
    // Families' guides, then the muhurtham page, then the owners' guides.
    const forWhom = (a: "families" | "owners") => GUIDES.filter((g) => g.audience === a).map((g) => guidePath(g.slug, "en"));
    expect(cards.map((c) => c.href)).toEqual([...forWhom("families"), "/muhurtham-dates", ...forWhom("owners")]);
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

// ── The second three (2026-10-11): hall cost, party halls, booking receipt ──

describe("English-only guides have no Tamil page and no link to one", () => {
  for (const g of GUIDES.filter((x) => x.ta === null)) {
    it(g.slug, () => {
      expect(existsSync(join(root, `app/ta/guides/${g.slug}/page.tsx`))).toBe(false);
      expect(guideIndexable(g, "ta")).toBe(false);
      expect(guideLanguageAlternates(g)).toBeUndefined();
      const r = renders.find((x) => x.slug === g.slug)!;
      const html = renderToStaticMarkup(r.render("en"));
      expect(html).not.toContain(`/ta/guides/${g.slug}`);
      expect(html).not.toContain("தமிழில் படிக்க");
    });
  }

  it("and every guide that has Tamil has its Tamil route", () => {
    for (const g of GUIDES.filter((x) => x.ta !== null)) {
      expect(existsSync(join(root, `app/ta/guides/${g.slug}/page.tsx`)), g.slug).toBe(true);
    }
  });

  it("the Tamil index lists only Tamil guides; the English one groups owners apart", () => {
    const ta = guidesIndexCards("ta").map((c) => c.href);
    expect(ta.every((h) => h.startsWith("/ta/"))).toBe(true);
    expect(ta).not.toContain("/ta/guides/birthday-party-hall");
    const en = guidesIndexCards("en");
    expect(en.at(-1)?.audience).toBe("owners");
    expect(en.filter((c) => c.audience === "owners").map((c) => c.href)).toEqual(["/guides/marriage-hall-booking-receipt"]);
    const html = renderToStaticMarkup(createElement(GuidesIndex, { lang: "en" }));
    expect(visibleText(html)).toContain("For hall owners");
  });
});

describe("hall cost: only listed prices, only from three halls", () => {
  const hall = (city: string, price_per_day: number | null) => ({ city, price_per_day });

  it("gives a city a range only once three of its halls list a price", () => {
    expect(MIN_HALLS_FOR_CITY_PRICES).toBe(3);
    const halls = [
      hall("Madurai", 1_60_000), hall("Madurai", 90_000), hall("Madurai", 2_10_000), hall("Madurai", null),
      hall("Chennai", 3_00_000), hall("Chennai", 2_50_000),
    ];
    expect(cityPriceRanges(halls)).toEqual([{ city: "Madurai", slug: "madurai", halls: 3, from: 90_000, to: 2_10_000 }]);
  });

  it("never counts a price on request, a zero or a hall without a city", () => {
    expect(cityPriceRanges([hall("Salem", null), hall("Salem", 0), hall("Salem", 50_000), hall("", 1), hall("", 2), hall("", 3)])).toEqual([]);
  });

  it("with no city qualifying, the page states no figure at all", () => {
    for (const lang of ["en", "ta"] as const) {
      const text = visibleText(renderToStaticMarkup(createElement(HallCostGuide, { lang, rows: [], asOf: "2026-10-11" })));
      expect(text, lang).not.toMatch(/₹\s?\d/);
    }
    const en = visibleText(renderToStaticMarkup(createElement(HallCostGuide, { lang: "en", rows: [], asOf: "2026-10-11" })));
    expect(en).toContain("No city has 3 halls with a listed price on Hallnect yet");
  });

  it("with rows, prints the listed range, dated, linking each city page", () => {
    const html = renderToStaticMarkup(createElement(HallCostGuide, { lang: "en", rows: SAMPLE_ROWS, asOf: "2026-10-11" }));
    const text = visibleText(html);
    expect(text).toContain("₹90,000");
    expect(text).toContain("₹2,10,000");
    expect(text).toContain("as listed on Hallnect on Sun, 11 Oct 2026");
    expect(html).toContain('href="/wedding-halls/madurai"');
    const ta = renderToStaticMarkup(createElement(HallCostGuide, { lang: "ta", rows: SAMPLE_ROWS, asOf: "2026-10-11" }));
    expect(ta).toContain('href="/ta/wedding-halls/madurai"');
  });

  it("reads approved halls only, and throws rather than reporting an empty catalogue", () => {
    const src = read("lib/guides.server.ts");
    expect(src).toContain('.eq("status", "approved")');
    expect(src).toContain("throw new Error(");
    for (const f of ["app/guides/wedding-hall-cost-tamil-nadu/page.tsx", "app/ta/guides/wedding-hall-cost-tamil-nadu/page.tsx"]) {
      expect(read(f), f).toContain("export const revalidate = 3600;");
      expect(read(f), f).toContain("fetchListedPricesStrict()");
    }
  });
});

describe("party halls: what Hallnect can say, and no more", () => {
  it("never promises a slot picker the enquiry form does not have", () => {
    const text = visibleText(renderToStaticMarkup(createElement(PartyHallGuide)));
    expect(text).toContain("say the time you need in your message");
    expect(text).not.toMatch(/choose (a|your|the) slot|pick (a|your|the) slot|select (a|your|the) slot/i);
    expect(text).not.toMatch(/₹\s?\d/);
  });
});

describe("the booking receipt template", () => {
  it("reads amounts the way people write them, and works out the balance", () => {
    expect(receiptAmounts("1,60,000", "50,000")).toEqual({ total: 1_60_000, advance: 50_000, balance: 1_10_000, problem: null });
    expect(receiptAmounts("₹ 2,00,000", "")).toEqual({ total: 2_00_000, advance: null, balance: null, problem: null });
    expect(receiptAmounts("", "")).toEqual({ total: null, advance: null, balance: null, problem: null });
  });

  it("says what is wrong instead of printing a wrong number", () => {
    expect(receiptAmounts("50,000", "60,000").problem).toBe("The advance is more than the agreed price.");
    expect(receiptAmounts("fifty", "").problem).toMatch(/agreed price in digits/);
    expect(receiptAmounts("1,00,000", "abc").problem).toMatch(/advance in digits/);
  });

  it("prints dates the way a receipt states them", () => {
    expect(receiptDate("2026-10-25")).toBe("25 October 2026");
    expect(receiptDate("not a date")).toBe("");
  });

  it("says how it was paid in ordinary words, keeping UPI in capitals", () => {
    expect(PAYMENT_MODES.map(paymentModeText)).toEqual(["cash", "UPI", "bank transfer", "cheque"]);
  });

  it("keeps everything in the browser: no network, no storage, no server action", () => {
    const src = read("components/guides/ReceiptTemplate.tsx").replace(/\/\/[^\n]*/g, "");
    for (const banned of ["fetch(", "localStorage", "sessionStorage", "indexedDB", "use server", "navigator.sendBeacon", "XMLHttpRequest"]) {
      expect(src, banned).not.toContain(banned);
    }
    expect(src).toContain('"use client"');
  });

  it("prints the receipt alone, and only on a page that has one", () => {
    const css = read("app/globals.css");
    // display:none, not visibility:hidden — the latter kept the page's height
    // and printed three blank pages after the receipt.
    expect(css).toContain("body:has(.receipt-print) *:not(:has(.receipt-print)):not(.receipt-print):not(.receipt-print *)");
    expect(css).not.toMatch(/body:has\(\.receipt-print\) \* \{ visibility: hidden/);
    expect(css).not.toMatch(/\n\s*body \* \{/);
    expect(read("components/guides/ReceiptTemplate.tsx")).toContain('className="receipt-print');
  });
});
