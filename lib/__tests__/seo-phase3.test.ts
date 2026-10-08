import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMetadata, fitTitle, renderedTitle, fitSentences, TITLE_MAX, DESCRIPTION_MAX,
} from "../seo/metadata";
import { venueKind, venueTitle, venueSummary, venueFacts, listingUpdatedLabel, venueDescription } from "../seo/venue";
import { tamilDate } from "../seo/tamil";
import { SERVICE_AREA_CITIES } from "../seo/service-areas";
import { MIN_VENUES_FOR_INDEX } from "../seo/cities";
import { MIN_VENUES_FOR_CATEGORY_INDEX } from "../venue-categories.server";
import type { HallDetail } from "../halls";

// ─────────────────────────────────────────────────────────────────────────────
// SEO phase 3 (2026-10-08), on-page:
//   • titles fit 60 characters AS RENDERED (brand included), descriptions 155;
//     the brand gives way before the page's own words;
//   • venue titles say what kind of hall it is, from its declared occasions;
//   • the venue page opens with two answer-first sentences and an "At a
//     glance" list, built from stored fields only;
//   • "last updated" dates on venue and city pages;
//   • a category page needs 3 live venues to be indexed.
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("titles fit 60 characters as they render", () => {
  it("a short title keeps the brand (the layout template adds it)", () => {
    expect(fitTitle("Budget Calculator")).toBe("Budget Calculator");
    expect(renderedTitle("Budget Calculator")).toBe("Budget Calculator | Hallnect");
  });

  it("the brand gives way before the page's own words", () => {
    const t = "Sri Lakshmi Kalyana Mandapam | Wedding Hall in Madurai"; // 54: fits alone, not with the brand
    expect(fitTitle(t)).toEqual({ absolute: t });
  });

  it("a title already carrying the brand (the homepage) is kept as written", () => {
    expect(fitTitle("Wedding, Party & Event Halls in Tamil Nadu | Hallnect")).toEqual({
      absolute: "Wedding, Party & Event Halls in Tamil Nadu | Hallnect",
    });
  });

  it("only a title too long on its own is clamped", () => {
    const r = renderedTitle("A".repeat(30) + " " + "B".repeat(40));
    expect(r.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(r.endsWith("…")).toBe(true);
  });

  it("buildMetadata uses it, and clamps descriptions to 155", () => {
    const m = buildMetadata({ title: "Budget Calculator", description: "x ".repeat(120), path: "/budget" });
    expect(m.title).toBe("Budget Calculator");
    expect(String(m.description).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("every city title fits, even Tiruchirappalli", () => {
    for (const city of SERVICE_AREA_CITIES) {
      expect(renderedTitle(`Wedding & Marriage Halls in ${city}`).length, city).toBeLessThanOrEqual(TITLE_MAX);
    }
    expect(read("app/wedding-halls/[city]/page.tsx")).toContain("title: `Wedding & Marriage Halls in ${city}`,");
  });

  it("About has a real title", () => {
    expect(read("app/about/page.tsx")).toContain('title: "About Us: Who We Are and How It Works",');
  });
});

describe("venue titles", () => {
  const hall = (name: string, city: string, venue_types: string[]) => ({ name, city, venue_types });

  it("say what kind of hall it is, from the declared occasions", () => {
    expect(venueKind(["wedding", "reception"])).toBe("Wedding Hall");
    expect(venueKind(["reception"])).toBe("Reception Hall");
    expect(venueKind(["conference", "meeting"])).toBe("Conference Hall");
    expect(venueKind(["birthday-party"])).toBe("Party Hall");
    expect(venueKind([])).toBe("Event Venue");
    expect(venueTitle(hall("NS KHALYAANA MAHAL", "Madurai", ["wedding", "reception"]))).toBe("NS KHALYAANA MAHAL | Wedding Hall in Madurai");
    expect(venueTitle(hall("City Hub", "Chennai", ["conference"]))).toBe("City Hub | Conference Hall in Chennai");
  });

  it("stay within 60 rendered characters for long names, losing the kind before the name", () => {
    const long = hall("Sri Lakshmi Narasimha Kalyana Mandapam", "Tiruchirappalli", ["wedding"]);
    expect(venueTitle(long)).toBe("Sri Lakshmi Narasimha Kalyana Mandapam, Tiruchirappalli");
    expect(renderedTitle(venueTitle(long)).length).toBeLessThanOrEqual(TITLE_MAX);
    // The live hall keeps the brand.
    expect(renderedTitle(venueTitle(hall("NS KHALYAANA MAHAL", "Madurai", ["wedding"])))).toBe(
      "NS KHALYAANA MAHAL | Wedding Hall in Madurai | Hallnect",
    );
  });
});

describe("descriptions are whole sentences", () => {
  it("a sentence that does not fit is dropped, never cut", () => {
    const facts = "Compare 1 wedding venue in Tiruchirappalli from ₹1,60,000 per day — photos, capacity and amenities.";
    const tail = "Ask for a quote; the hall gets your number only if you accept.";
    const d = fitSentences([facts, tail]);
    expect(d).toBe(facts);
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(fitSentences(["Short facts.", tail])).toBe(`Short facts. ${tail}`);
  });

  it("the city and category pages build theirs with it", () => {
    for (const f of ["app/wedding-halls/[city]/page.tsx", "app/venues/[category]/page.tsx", "app/venues/[category]/[city]/page.tsx"]) {
      expect(read(f), f).toContain("return fitSentences([");
    }
  });
});

// A hall as the venue page holds it — only the fields the summary reads.
const base = {
  name: "NS KHALYAANA MAHAL",
  city: "Madurai",
  state: "Tamil Nadu",
  address: "139-H, Big Car Street, Thirupparankundram, Madurai-625005",
  capacity_min: 150,
  capacity_max: 450,
  price_per_day: 160000,
  price_morning: null,
  price_evening: null,
  booking_mode: "LEAD_GENERATION",
  amenities: [
    { name: "Air Conditioning", slug: "ac", icon: null },
    { name: "Free Parking", slug: "parking", icon: null },
  ],
  custom_amenities: ["Bridal Room"],
  venue_types: ["wedding", "reception"],
  updated_at: "2026-09-17T13:41:40.899814+00:00",
} as unknown as HallDetail;
const ctx = { categoryNames: ["Wedding", "Reception"], advancePercent: 25, directBookingEnabled: true };

describe("the venue's search snippet", () => {
  it("says how to book when the owner's first sentence is too long to fit whole", () => {
    const owner = {
      ...base,
      description:
        "NS KHALYAANA MAHAL is a premium wedding and event venue located in thirupparankundram,Madurai. " +
        "It provides a Morden fusion of traditional customs and upscale modern amenities.",
    } as HallDetail;
    const d = venueDescription(owner);
    expect(d).toBe(
      "NS KHALYAANA MAHAL in Madurai seats up to 450 guests from ₹1,60,000 per day. " +
        "Ask for a quote; the hall gets your number only if you accept.",
    );
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
});

describe("the venue page answers first", () => {
  it("two sentences from stored fields: what, where, how big, how much, how to book", () => {
    expect(venueSummary(base, ctx)).toBe(
      "NS KHALYAANA MAHAL is a wedding and reception venue in Madurai, Tamil Nadu, for 150 to 450 guests, listed at ₹1,60,000 per day. " +
        "It works on quotes: ask for its price for your date, and it gets your phone number only if you accept.",
    );
  });

  it("says online booking only for a hall that takes it, and never invents a price", () => {
    const direct = { ...base, booking_mode: "DIRECT_BOOKING" } as HallDetail;
    expect(venueSummary(direct, ctx)).toContain("It takes online bookings: you pay a 25% advance on Hallnect");
    expect(venueSummary(direct, { ...ctx, directBookingEnabled: false })).toContain("It works on quotes");
    const unpriced = { ...base, price_per_day: null } as unknown as HallDetail;
    expect(venueSummary(unpriced, ctx)).not.toMatch(/listed at|₹/);
    expect(venueSummary(unpriced, ctx)).toContain("publishes no price");
    const plain = { ...base, capacity_min: null, venue_types: [] } as unknown as HallDetail;
    expect(venueSummary(plain, { ...ctx, categoryNames: [] })).toMatch(/^NS KHALYAANA MAHAL is an event venue in Madurai, Tamil Nadu, for up to 450 guests/);
  });

  it("the At a glance list holds only what the listing has", () => {
    expect(venueFacts(base, ctx)).toEqual([
      { label: "Location", value: "139-H, Big Car Street, Thirupparankundram, Madurai-625005" },
      { label: "Capacity", value: "150 to 450 guests" },
      { label: "Price", value: "₹1,60,000 per day" },
      { label: "How to book", value: "Ask for a quote; the hall gets your number only if you accept" },
      { label: "Suitable for", value: "Wedding, Reception" },
      { label: "Amenities", value: "Air Conditioning, Free Parking, Bridal Room" },
      { label: "Listing updated", value: "17 September 2026", dateTime: "2026-09-17T13:41:40.899814+00:00" },
    ]);
    const sparse = { ...base, amenities: [], custom_amenities: [], updated_at: null, price_per_day: null } as unknown as HallDetail;
    const labels = venueFacts(sparse, { ...ctx, categoryNames: [] }).map((f) => f.label);
    expect(labels).toEqual(["Location", "Capacity", "Price", "How to book"]);
  });

  it("is computed on the server and rendered first, with the list after About", () => {
    const page = read("app/halls/[slug]/_components/VenuePage.tsx");
    expect(page).toContain("const summary = venueSummary(hall, factsContext);");
    const view = read("app/halls/[slug]/_components/HallDetailView.tsx");
    expect(view).toContain('import type { VenueFact } from "@/lib/seo/venue";');
    expect(view.indexOf("{summary && (")).toBeLessThan(view.indexOf("{/* Stat cards */}"));
    expect(view.indexOf(">At a glance</h2>")).toBeGreaterThan(view.indexOf(">About</h2>"));
    expect(view).toContain('<time dateTime={f.dateTime}>{f.value}</time>');
    expect(view).toContain('value={isLead ? "Quotes" : "Online"}');
  });
});

describe("last updated dates", () => {
  it("are India's date, in English and Tamil, and absent rather than guessed", () => {
    expect(listingUpdatedLabel("2026-09-17T13:41:40Z")).toBe("17 September 2026");
    // 20:00 UTC is already the next day in India.
    expect(listingUpdatedLabel("2026-09-17T20:00:00Z")).toBe("18 September 2026");
    expect(listingUpdatedLabel(null)).toBeNull();
    expect(listingUpdatedLabel("not a date")).toBeNull();
    expect(tamilDate("2026-09-17T13:41:40Z")).toBe("17 செப்டம்பர் 2026");
    expect(tamilDate("2026-09-17T20:00:00Z")).toBe("18 செப்டம்பர் 2026");
    expect(tamilDate(undefined)).toBeNull();
  });

  it("the city pages show the newest change among their live halls", () => {
    const cities = read("lib/seo/cities.ts");
    expect(cities).toContain('.select("city, updated_at")');
    expect(cities).toContain("lastUpdated: newest.get(city) ?? null,");
    expect(read("app/wedding-halls/[city]/page.tsx")).toContain("Listings updated <time dateTime={inventory.lastUpdated}>{listingsUpdated}</time>");
    expect(read("app/ta/wedding-halls/[city]/page.tsx")).toContain("<time dateTime={inventory.lastUpdated}>{listingsUpdated}</time>");
  });
});

describe("thin pages", () => {
  it("a category page needs three live venues; a city page still needs one", () => {
    expect(MIN_VENUES_FOR_CATEGORY_INDEX).toBe(3);
    expect(MIN_VENUES_FOR_INDEX).toBe(1);
  });
});
