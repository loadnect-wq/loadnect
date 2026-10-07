import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BUDGET_PATH, FAMILY_TOOLS, TOOLS_PATH, daysAway } from "../family-tools";
import { FOOTER_LINKS, NAV_LINKS } from "../constants";
import { budget, functionBudgetSummary } from "../budget";
import { FamilyToolTiles, MoreFamilyTools } from "@/components/tools/FamilyTools";
import { BudgetCalculator } from "@/components/budget/BudgetCalculator";
import { MuhurthamPage } from "@/components/muhurtham/MuhurthamPage";

// ─────────────────────────────────────────────────────────────────────────────
// The family planning tools are in front of people (2026-10-05). Each was
// built and then linked only from somewhere a family would already have to
// know about. These pin every way in, so a later edit cannot quietly bury one
// again — and that each tool says only what is true of it.
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const pageFor = (href: string) => join(root, "app", ...href.split("/").filter(Boolean), "page.tsx");

describe("the tools", () => {
  it("are the four a family needs, in the order they need them", () => {
    expect(FAMILY_TOOLS.map((t) => t.key)).toEqual(["muhurtham", "budget", "shortlist", "planner"]);
    expect(FAMILY_TOOLS.map((t) => t.href)).toEqual(["/muhurtham-dates", "/budget", "/saved", "/plan"]);
  });

  it("each lead to a page that exists, as do the hub and the calculator", () => {
    for (const href of [...FAMILY_TOOLS.map((t) => t.href), TOOLS_PATH, BUDGET_PATH]) {
      expect(existsSync(pageFor(href)), `${href} has no page`).toBe(true);
    }
  });

  it("say which need an account: only the planner, which is shared with the family", () => {
    expect(FAMILY_TOOLS.filter((t) => !t.noSignIn).map((t) => t.key)).toEqual(["planner"]);
  });

  it("count the days to a date the way a person says it", () => {
    expect(daysAway("2026-10-05", "2026-10-05")).toBe("today");
    expect(daysAway("2026-10-05", "2026-10-06")).toBe("tomorrow");
    expect(daysAway("2026-10-05", "2026-10-25")).toBe("in 20 days");
    expect(daysAway("2026-12-31", "2027-01-20")).toBe("in 20 days");
  });
});

describe("every way in", () => {
  it("the homepage shows all four, on phones and on desktop, second on the page", () => {
    const home = read("app/page.tsx");
    expect(home).toContain("<FamilyToolTiles next={nextMuhurtham} />");
    expect(home).toContain("<FamilyToolCards next={nextMuhurtham} />");
    // Straight after the occasions, ahead of the venue list, in both trees.
    const mobile = home.slice(0, home.indexOf("DESKTOP — premium adaptive layout"));
    expect(mobile.indexOf("<FamilyToolTiles")).toBeGreaterThan(mobile.indexOf('variant="mobile"'));
    expect(mobile.indexOf("<FamilyToolTiles")).toBeLessThan(mobile.indexOf("Featured Venues"));
    const desktop = home.slice(home.indexOf("DESKTOP — premium adaptive layout"));
    expect(desktop.indexOf("<FamilyToolCards")).toBeGreaterThan(desktop.indexOf('variant="desktop"'));
    expect(desktop.indexOf("<FamilyToolCards")).toBeLessThan(desktop.indexOf("Featured venues grid"));
  });

  it("the desktop header has ONE entry for them, whose menu lists every tool, and the saved list", () => {
    // Muhurtham Dates and Budget Calculator were header links beside "Plan
    // Your Function", though both are on the page it opens (2026-10-07).
    expect(NAV_LINKS.map((l) => l.href)).toEqual(["/halls", "/tools", "/premium"]);
    expect(NAV_LINKS.find((l) => l.href === "/tools")?.menu).toBe(true);
    for (const t of FAMILY_TOOLS) expect(NAV_LINKS.map((l) => l.href)).not.toContain(t.href);
    // All three fit beside the signed-in controls at 1024px.
    expect(NAV_LINKS.every((l) => !l.wide)).toBe(true);
    const navbar = read("components/layout/Navbar.tsx");
    expect(navbar).toContain("<PlanMenu key={href} label={link.label} href={href} pathname={pathname} />");
    expect(navbar).toContain("{FAMILY_TOOLS.map((tool) => {");
    expect(navbar).toContain("All planning tools →");
    // Over the homepage video every header link is whitened; the menu's links
    // sit on their own white panel and must opt out.
    expect(navbar.match(/hallnect-nav-solid/g)?.length).toBeGreaterThanOrEqual(3);
    expect(navbar).toContain('className={link.wide ? "hidden xl:block" : undefined}');
    expect(navbar).toContain('<SavedLink active={pathname.startsWith("/saved")} />');
    expect(navbar).toContain('href="/saved"');
  });

  it("the footer has a column of them", () => {
    const plan = FOOTER_LINKS.plan.map((l) => l.href);
    for (const t of FAMILY_TOOLS) expect(plan).toContain(t.href);
    expect(plan).toContain(TOOLS_PATH);
    expect(read("components/layout/Footer.tsx")).toContain("FOOTER_LINKS.plan.map");
  });

  it("the phone's Profile tab lists them for everyone, signed in or not", () => {
    const profile = read("app/profile/_components/ProfileView.tsx");
    expect(profile).toContain('<SettingsGroup title="Plan your function">');
    expect(profile).toContain('FAMILY_TOOLS.filter((t) => t.key !== "planner" || !profile || profile.role === "customer")');
  });

  it("each tool's own page points on to the others", () => {
    expect(read("app/budget/page.tsx")).toContain('<MoreFamilyTools current="budget" />');
    expect(read("app/saved/page.tsx")).toContain('<MoreFamilyTools current="shortlist" />');
    expect(read("components/muhurtham/MuhurthamPage.tsx")).toContain('{lang === "en" && <MoreFamilyTools current="muhurtham" />}');
    const more = renderToStaticMarkup(createElement(MoreFamilyTools, { current: "budget" }));
    expect(more).not.toContain('href="/budget"');
    for (const href of ["/muhurtham-dates", "/saved", "/plan"]) expect(more).toContain(`href="${href}"`);
  });

  it("the hall page's budget card leads to the calculator", () => {
    expect(read("components/budget/BudgetEstimate.tsx")).toContain("Open the budget calculator");
  });

  it("the hub and the calculator are in the sitemap", () => {
    const sitemap = read("app/sitemap.ts");
    expect(sitemap).toContain('absoluteUrl("/tools")');
    expect(sitemap).toContain('absoluteUrl("/budget")');
  });

  it("the assistant knows them, and is told not to invent dates or food rates", () => {
    const k = read("lib/ai/knowledge.server.ts");
    expect(k).toContain("(all listed at /tools)");
    for (const href of ["/muhurtham-dates", "/budget", "/saved", "/plan"]) expect(k).toContain(`(${href}`);
    expect(k).toContain("never call a date auspicious or inauspicious yourself");
    expect(k).toContain("never suggest a per-plate figure");
  });
});

describe("the homepage tiles", () => {
  it("name the real next muhurtham, and point at each tool", () => {
    const html = renderToStaticMarkup(createElement(FamilyToolTiles, { next: { date: "2026-10-25", today: "2026-10-05" } }));
    expect(html).toContain("Next: Sun, 25 Oct, in 20 days");
    for (const t of FAMILY_TOOLS) expect(html).toContain(`href="${t.href}"`);
  });

  it("still make sense once the listed dates run out", () => {
    const html = renderToStaticMarkup(createElement(FamilyToolTiles, { next: null }));
    expect(html).toContain("Wedding dates, month by month");
    expect(html).not.toContain("Next:");
  });
});

describe("the budget calculator", () => {
  it("starts empty: no invented hall price or food rate, no share link", () => {
    const html = renderToStaticMarkup(createElement(BudgetCalculator));
    expect(html).toContain("Hall price (₹)");
    expect(html).toContain('placeholder="From the hall&#x27;s page or its quote"');
    expect(html).toContain('placeholder="Ask for a rate"');
    expect(html).toContain("Add guests and a per-plate rate to see the full picture.");
    expect(html).toContain("not a quote");
    expect(html).not.toContain("wa.me");
    expect(html).not.toContain("Find halls for");
  });

  it("sends the family a summary that says it is an estimate and where to work out theirs", () => {
    const b = budget({ hallRent: 160000, guests: 400, perPlate: 350, meals: 2, decoration: 50000, other: null, addGst: true });
    const text = functionBudgetSummary(b, "https://hallnect.com/budget");
    expect(text.split("\n")).toEqual([
      "Our function budget estimate:",
      "Hall: ₹1,60,000",
      "GST on the hall (18%): ₹28,800",
      "Catering: ₹2,80,000 (400 guests × ₹350 × 2 meals)",
      "Decoration: ₹50,000",
      "Estimated total: ₹5,18,800 (about ₹1,297 a guest)",
      "Work it out on Hallnect: https://hallnect.com/budget",
    ]);
  });

  it("remembers its hall price beside the numbers every hall's page shares", () => {
    const store = read("lib/hooks/useBudgetInputs.ts");
    expect(store).toContain('hallRent: "", hallGst: ""');
    // A hall's page uses its own listed price, never the calculator's.
    expect(read("components/budget/BudgetEstimate.tsx")).not.toContain("fields.hallRent");
  });

  it("finds halls that hold the family's guests", () => {
    expect(read("components/budget/BudgetCalculator.tsx")).toContain("href={`/halls?capacity=${guests}`}");
  });
});

describe("the muhurtham page", () => {
  it("jumps to a month from a chip, landing below the sticky header", () => {
    const html = renderToStaticMarkup(createElement(MuhurthamPage, { lang: "en", today: "2026-10-05", bookings: null }));
    expect(html).toContain('aria-label="Jump to a month"');
    expect(html).toContain('href="#month-2026-11"');
    expect(html).toMatch(/<section id="month-2026-11"[^>]*class="scroll-mt-20/);
  });
});
