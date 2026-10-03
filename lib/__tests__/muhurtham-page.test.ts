import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { busiestMonth, countInYear, groupByMonth, upcomingMuhurthamDates } from "../muhurtham";
import type { MuhurthamBookings } from "../muhurtham.server";
import {
  MuhurthamPage,
  muhurthamFaqs,
  muhurthamLanguageAlternates,
  muhurthamMeta,
  yearSpan,
} from "@/components/muhurtham/MuhurthamPage";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Anything only a count line or the counts note would print. */
const COUNT_TEXT = /booked on Hallnect yet|\d+ of \d+ halls? already booked|Counts are bookings/;
const render = (lang: "en" | "ta", bookings: MuhurthamBookings | null) =>
  renderToStaticMarkup(createElement(MuhurthamPage, { lang, today: "2026-10-03", bookings }));

describe("the list the page is built from", () => {
  it("shows what is still ahead, grouped by month", () => {
    const upcoming = upcomingMuhurthamDates("2026-11-12");
    expect(upcoming[0]).toBe("2026-11-13");
    const months = groupByMonth(upcoming);
    expect([...months.keys()][0]).toBe("2026-11");
    expect(months.get("2026-11")).toEqual(["2026-11-13", "2026-11-15", "2026-11-16", "2026-11-20", "2026-11-29"]);
  });

  it("names the span honestly as 2026 dates pass", () => {
    expect(yearSpan(upcomingMuhurthamDates("2026-10-03"))).toBe("2026–2027");
    expect(yearSpan(upcomingMuhurthamDates("2026-12-15"))).toBe("2027");
    expect(yearSpan([])).toBe("");
  });

  it("knows 2027's shape", () => {
    expect(countInYear(2027)).toBe(56);
    expect(busiestMonth(2027)).toEqual({ month: "2027-05", count: 8 });
  });
});

describe("the FAQ", () => {
  it("answers from the data, in both languages", () => {
    const en = muhurthamFaqs("en", "2026-10-03");
    expect(en[0].a).toContain("56 muhurtham dates in 2027");
    expect(en[1].a).toContain("May, with 8 dates");
    const ta = muhurthamFaqs("ta", "2026-10-03");
    expect(ta).toHaveLength(en.length);
    expect(ta[0].a).toContain("56 முகூர்த்த நாட்கள்");
    expect(ta[1].a).toContain("மே மாதத்தில், 8 நாட்கள்");
  });

  it("renders every question it puts in FAQPage markup", () => {
    for (const lang of ["en", "ta"] as const) {
      const html = render(lang, null);
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)![1]);
      const faq = ld["@graph"].find((n: { "@type": string }) => n["@type"] === "FAQPage");
      expect(faq.mainEntity).toHaveLength(muhurthamFaqs(lang, "2026-10-03").length);
      for (const q of faq.mainEntity) {
        const escaped = q.name.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
        expect(html.split(escaped).length - 1, q.name).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("keeps both meta descriptions under the 158-char clamp on every day of the list", () => {
    // buildMetadata cuts at 158 and adds "…"; the longest month names
    // ("September", "செப்டம்பர்") must still fit.
    for (let t = Date.UTC(2026, 9, 1); t <= Date.UTC(2028, 0, 1); t += 86_400_000) {
      const today = new Date(t).toISOString().slice(0, 10);
      for (const lang of ["en", "ta"] as const) {
        const { description } = muhurthamMeta(lang, today);
        expect(description.length, `${lang} ${today}`).toBeLessThanOrEqual(158);
      }
    }
    expect(muhurthamMeta("en", "2026-10-03").title).toBe("Tamil Muhurtham Dates 2026–2027 | Wedding Dates");
    expect(muhurthamMeta("en", "2028-01-01").hasDates).toBe(false);
  });
});

describe("what the counts may say", () => {
  const page = read("components/muhurtham/MuhurthamPage.tsx");
  const server = read("lib/muhurtham.server.ts");

  it("only ever counts BOOKED halls — never calls a date free", () => {
    const start = page.indexOf("const T = {");
    const strings = page.slice(start, page.indexOf("} as const;", start));
    expect(strings.length).toBeGreaterThan(1000);
    expect(strings).not.toMatch(/\bfree\b|available|காலி/i);
    expect(strings).toContain("already booked");
    expect(strings).toContain("each hall confirms your date");
  });

  it("shows no counts at all when the read failed, rather than zeros", () => {
    expect(server).toContain("return null;");
    const html = render("en", null);
    expect(html).toContain("Sun, 25 Oct 2026");
    expect(html).not.toMatch(COUNT_TEXT);
  });

  it("names booked halls on the date's row, and stays quiet on rows with none", () => {
    const html = render("en", { listedHalls: 5, bookedByDate: new Map([["2026-11-11", 3]]) });
    // The callout (25 Oct, nothing booked) says so, once.
    expect(html.match(/None booked on Hallnect yet/g)).toHaveLength(1);
    expect(html.match(/3 of 5 halls already booked/g)).toHaveLength(1);
    expect(html).toContain("Counts are bookings recorded on Hallnect");
  });

  it("counts in the callout too, in Tamil, and gets 1 hall right", () => {
    const one = render("en", { listedHalls: 1, bookedByDate: new Map([["2026-10-25", 1]]) });
    expect(one).toContain("1 of 1 hall already booked");
    const ta = render("ta", { listedHalls: 4, bookedByDate: new Map([["2026-10-25", 2]]) });
    expect(ta).toContain("4 மண்டபங்களில் 2 ஏற்கனவே முன்பதிவு");
  });

  it("shows nothing at all when no hall is listed yet", () => {
    expect(render("en", { listedHalls: 0, bookedByDate: new Map() })).not.toMatch(COUNT_TEXT);
  });

  it("counts full-day claims on public rows only", () => {
    expect(server).toContain('.in("status", FULL_BLOCK_STATUSES)');
    expect(server).toContain("getSupabasePublicClient()");
  });
});

describe("the pair, and getting found", () => {
  it("names both pages with one hreflang map", () => {
    expect(muhurthamLanguageAlternates()).toEqual({
      "en-IN": "/muhurtham-dates",
      "ta-IN": "/ta/muhurtham-dates",
      "x-default": "/muhurtham-dates",
    });
    for (const f of ["app/muhurtham-dates/page.tsx", "app/ta/muhurtham-dates/page.tsx"]) {
      expect(read(f), f).toContain("languages: muhurthamLanguageAlternates()");
    }
  });

  it("is listed in the sitemap and linked from the site", () => {
    expect(read("app/sitemap.ts")).toContain("absoluteUrl(MUHURTHAM_PATH[lang])");
    expect(read("lib/constants.ts")).toContain('href: "/muhurtham-dates"');
    expect(read("components/sections/DateRangeCalendar.tsx")).toContain('href="/muhurtham-dates"');
    expect(read("app/ta/wedding-halls/[city]/page.tsx")).toContain('href="/ta/muhurtham-dates"');
  });
});
