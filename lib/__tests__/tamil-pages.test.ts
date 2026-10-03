import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TAMIL_CITY_NAMES,
  cityLanguageAlternates,
  formatTamilDate,
  tamilCityName,
  tamilCityPath,
} from "../seo/tamil";
import { SERVICE_AREA_CITIES } from "../seo/service-areas";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const tamilPage = read("app/ta/wedding-halls/[city]/page.tsx");
const englishPage = read("app/wedding-halls/[city]/page.tsx");
const sitemap = read("app/sitemap.ts");

describe("lib/seo/tamil", () => {
  it("names every service-area city in Tamil script", () => {
    for (const city of SERVICE_AREA_CITIES) {
      const ta = TAMIL_CITY_NAMES[city];
      expect(ta, city).toBeTruthy();
      expect(ta, city).toMatch(/^[஀-௿]+$/);
    }
    expect(tamilCityName("Madurai")).toBe("மதுரை");
    expect(tamilCityName("Atlantis")).toBeNull();
  });

  it("writes dates out in full, with the right weekday", () => {
    expect(formatTamilDate("2026-10-25")).toBe("25 அக்டோபர், ஞாயிறு");
    expect(formatTamilDate("2026-11-11")).toBe("11 நவம்பர், புதன்");
    expect(formatTamilDate("2027-01-20")).toBe("20 ஜனவரி, புதன்");
  });

  it("builds one hreflang map that both twins share", () => {
    expect(cityLanguageAlternates("madurai")).toEqual({
      "en-IN": "/wedding-halls/madurai",
      "ta-IN": "/ta/wedding-halls/madurai",
      "x-default": "/wedding-halls/madurai",
    });
    expect(tamilCityPath("madurai")).toBe("/ta/wedding-halls/madurai");
  });
});

describe("the Tamil city page", () => {
  it("passes the English page's inventory gate, unchanged", () => {
    // Same function, same field: the Tamil twin is indexable exactly when the
    // English page is. A second language must not loosen the doorway rule.
    expect(tamilPage).toContain("fetchCityInventoryBySlug(slug)");
    expect(tamilPage).toContain("indexable: Boolean(inventory?.indexable)");
    expect(englishPage).toContain("indexable: Boolean(inventory?.indexable)");
  });

  it("declares the same hreflang pair as its English twin", () => {
    expect(tamilPage).toContain("languages: cityLanguageAlternates(citySlug(city))");
    expect(englishPage).toContain("languages: cityLanguageAlternates(citySlug(city))");
  });

  it("marks its content as Tamil and its og:locale as ta_IN", () => {
    expect(tamilPage).toContain('lang="ta"');
    expect(tamilPage).toContain('locale: "ta_IN"');
    expect(tamilPage).toContain('inLanguage: "ta-IN"');
  });

  it("renders every FAQ it puts in structured data", () => {
    expect(tamilPage).toContain("faqJsonLd(faqs)");
    expect(tamilPage).toContain("{faqs.map((f) => (");
  });

  it("branches its promises on the booking mode, like the English page", () => {
    // An enquiry-only city must not be told it can pay online.
    expect(tamilPage).toContain("const everyVenueIsEnquiryOnly = allLead(halls)");
    expect(tamilPage.match(/everyVenueIsEnquiryOnly\s*\n?\s*\?/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("never renders a missing price as ₹0", () => {
    expect(tamilPage).toContain("hasPrice(hall.price_per_day)");
    expect(tamilPage).toContain(".filter(hasPrice)");
  });

  it("puts the date question first, as a form that works without JavaScript", () => {
    const date = tamilPage.indexOf("உங்கள் விழா தேதி எப்போது?");
    const list = tamilPage.indexOf("பட்டியலிடப்பட்ட மண்டபங்கள்");
    expect(date).toBeGreaterThan(0);
    expect(date).toBeLessThan(list);
    expect(tamilPage).toContain('<form action="/halls" method="get"');
    expect(tamilPage).toContain("nextMuhurthamDates(today, 6)");
  });

  it("does not claim Hallnect charges no commission", () => {
    expect(tamilPage).not.toContain("கமிஷன் இல்லை");
  });
});

describe("the Tamil font", () => {
  it("is self-hosted everywhere — next/font/google's Noto_Sans_Tamil broke a production build", () => {
    // Google sometimes answers the build-time CSS fetch with /l/font?kit=…&skey=…
    // URLs that Turbopack cannot parse; the deploy of 59d7b23 failed on it.
    // Every Tamil surface, and no file anywhere still on the Google loader.
    for (const f of [
      "app/ta/wedding-halls/[city]/page.tsx",
      "app/ta/muhurtham-dates/page.tsx",
      "app/owner/(dashboard)/halls/[id]/standee/page.tsx",
    ]) {
      expect(read(f), f).toContain('from "@/app/fonts/noto-sans-tamil/font"');
    }
    const walk = (dir: string): string[] =>
      readdirSync(join(root, dir)).flatMap((f) => {
        const p = `${dir}/${f}`;
        if (statSync(join(root, p)).isDirectory()) return walk(p);
        return /\.(ts|tsx)$/.test(f) ? [p] : [];
      });
    for (const f of [...walk("app"), ...walk("components")]) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(code, f).not.toMatch(/import\s*\{[^}]*Noto_Sans_Tamil[^}]*\}\s*from\s*"next\/font\/google"/);
    }
    expect(read("app/fonts/noto-sans-tamil/font.ts")).toContain('src: "./NotoSansTamil-wght-tamil.woff2"');
  });
});

describe("the pair, from the outside", () => {
  it("links the English page to its Tamil twin", () => {
    expect(englishPage).toContain("tamilCityPath(citySlug(city))");
    expect(englishPage).toContain('hrefLang="ta-IN"');
  });

  it("lists both twins in the sitemap, behind the same gate", () => {
    expect(sitemap).toContain("cities.flatMap((c) =>");
    expect(sitemap).toContain("absoluteUrl(tamilCityPath(c.slug))");
    expect(sitemap).toContain("cityLanguageAlternates(c.slug)");
  });
});
