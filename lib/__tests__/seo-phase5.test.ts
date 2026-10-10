import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hallnectDefinition, hallsAnswer } from "../seo/definition";
import { buildLlmsTxt } from "../seo/llms";
import { CONTACT } from "../constants";

// ─────────────────────────────────────────────────────────────────────────────
// SEO phase 5 (2026-10-10): AI search.
//   • One definition of Hallnect — what it is, who it serves, where, who runs
//     it — printed the same way by the home page ("What is Hallnect?"), About
//     and /llms.txt.
//   • /halls opens with an answer built from the live list.
//   • Name, email, phone and address come from one constant everywhere.
// Already in place from earlier phases: /llms.txt, "last updated" dates, the
// facts lists, the city FAQ answered from data ("How much does a wedding hall
// in Madurai cost?"), and About/Contact/policy pages naming who runs Hallnect.
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("one definition of Hallnect", () => {
  const on = hallnectDefinition({ directBookingEnabled: true, legalName: "HALLNECT LLP" });

  it("says what it is, who it serves, where it operates and who runs it", () => {
    expect(on).toMatch(/^Hallnect is an online marketplace for wedding halls, kalyana mandapams/);
    expect(on).toContain("in Tamil Nadu, India");
    expect(on).toContain("Families compare venues");
    expect(on).toContain("Venue owners list their halls for free");
    expect(on).toContain("Hallnect is run by HALLNECT LLP, based in Madurai.");
  });

  it("mentions online booking only while it exists", () => {
    expect(on).toContain("book online with an advance");
    expect(hallnectDefinition({ directBookingEnabled: false, legalName: "X" })).not.toContain("book online");
  });

  it("is what the home page, About and /llms.txt all print", () => {
    const home = read("app/page.tsx");
    expect(home).toContain('q: "What is Hallnect?",');
    expect(home).toContain("a: hallnectDefinition({ directBookingEnabled: DIRECT_BOOKING_ENABLED, legalName: CONTACT.legalName }),");
    // First question in BOTH versions of the FAQ (and so in the FAQPage markup).
    expect(home).toContain("const FAQ_ITEMS = DIRECT_BOOKING_ENABLED ? [\n  WHAT_IS_HALLNECT,");
    expect(home).toContain("] : [\n  WHAT_IS_HALLNECT,");
    expect(read("app/about/page.tsx")).toContain("{hallnectDefinition({ directBookingEnabled: DIRECT_BOOKING_ENABLED, legalName: CONTACT.legalName })}");
    const llms = buildLlmsTxt({
      siteUrl: "https://hallnect.com", generatedOn: "2026-10-10", venues: [], cities: [],
      directBookingEnabled: true, feeDisclosure: "f",
      contact: { legalName: "HALLNECT LLP", email: "e", phone: "p", address: "a" }, supportHours: "h",
    });
    expect(llms).toContain(`> ${on}`);
  });
});

describe("/halls answers first", () => {
  const hall = (city: string, capacity_max: number, price_per_day: number | null, booking_mode = "LEAD_GENERATION") =>
    ({ city, capacity_max, price_per_day, booking_mode });

  it("from the live list: venues, cities, starting price, largest capacity, how to book", () => {
    expect(hallsAnswer([hall("Madurai", 450, 160000)], true)).toBe(
      "Hallnect lists 1 venue in 1 city of Tamil Nadu, from ₹1,60,000 per day, for up to 450 guests. " +
        "Ask a hall for a quote; it gets your number only if you accept.",
    );
    expect(hallsAnswer([hall("Madurai", 450, 160000), hall("Chennai", 800, 90000, "DIRECT_BOOKING")], true)).toBe(
      "Hallnect lists 2 venues in 2 cities of Tamil Nadu, from ₹90,000 per day, for up to 800 guests. " +
        "Ask a hall for a quote, or book online where the hall offers it.",
    );
  });

  it("never invents a price, and has nothing to say with nothing listed", () => {
    expect(hallsAnswer([hall("Madurai", 300, null)], true)).not.toContain("₹");
    expect(hallsAnswer([], true)).toBeNull();
    expect(hallsAnswer([hall("Chennai", 800, 90000, "DIRECT_BOOKING")], false)).toContain("Ask a hall for a quote; it gets");
  });

  it("only on the unfiltered page", () => {
    expect(read("app/halls/(browse)/page.tsx")).toContain("(!isFiltered(sp) && hallsAnswer(halls, DIRECT_BOOKING_ENABLED))");
  });
});

describe("name, address and phone are one set everywhere", () => {
  // Every page that shows Hallnect's contact details reads them from CONTACT,
  // so the footer, Contact, About, the policies and the structured data cannot
  // drift apart (lib/__tests__/seo-phase4.test.ts ties the structured data to
  // CONTACT). The one exception renders when the whole app has crashed and is
  // deliberately dependency-free.
  const EXEMPT = new Set(["app/global-error.tsx"]);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(root, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (/\.tsx$/.test(name)) files.push(rel);
    }
  };
  walk("app");
  walk("components");

  it("no page types the email, phone or office address by hand", () => {
    const literals = [CONTACT.email, CONTACT.phone, "9344040013", "Venkateshwara Nagar"];
    const offenders = files.filter((f) => !EXEMPT.has(f)).flatMap((f) => {
      const src = read(f);
      return literals.filter((l) => src.includes(l)).map((l) => `${f}: ${l}`);
    });
    expect(offenders).toEqual([]);
  });
});
