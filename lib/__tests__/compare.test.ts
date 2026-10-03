import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  type CompareHall,
  amenityRows,
  compareCode,
  comparePath,
  compareRows,
  compareShareText,
  decodeCompare,
  mapsUrl,
  versusLine,
} from "../compare";
import { encodeShortlist } from "../shortlist";
import { ComparePicker } from "@/components/compare/ComparePicker";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const A = "fda1a579-57b5-4def-acc4-ee27b060a67f";
const B = "0b6c2f4e-1d3a-4c5b-9e8f-7a6b5c4d3e2f";
const C = "ffffffff-ffff-4fff-bfff-ffffffffffff";
const D = "11111111-1111-4111-8111-111111111111";

const hall = (over: Partial<CompareHall>): CompareHall => ({
  id: A, slug: "a", name: "A", city: "Madurai", address: null, capacityMin: null, capacityMax: 300,
  pricePerDay: null, priceMorning: null, priceEvening: null, bookingMode: "LEAD_GENERATION",
  ratingAverage: 0, ratingCount: 0, venueTypes: [], amenities: [], customAmenities: [],
  coverUrl: null, latitude: null, longitude: null, ...over,
});

describe("the compare code", () => {
  it("holds two or three halls, never one or four", () => {
    expect(compareCode([A])).toBeNull();
    expect(compareCode([A, A])).toBeNull(); // a repeat is one hall
    expect(decodeCompare(compareCode([A, B])!)).toEqual([A, B]);
    expect(decodeCompare(compareCode([A, B, C, D])!)).toEqual([A, B, C]); // first three
    expect(decodeCompare(encodeShortlist([A])!)).toBeNull();
    expect(decodeCompare(encodeShortlist([A, B, C, D])!)).toBeNull();
    expect(decodeCompare("junk!")).toBeNull();
    expect(comparePath("x")).toBe("/compare/x");
  });
});

describe("the rows", () => {
  const a = hall({ id: A, name: "NS Mahal", pricePerDay: 160000, priceMorning: 90000, capacityMin: 150, capacityMax: 450, venueTypes: ["wedding", "reception"] });
  const b = hall({ id: B, name: "Sri Mahal", pricePerDay: 120000, capacityMax: 800, bookingMode: "DIRECT_BOOKING", ratingAverage: 4.6, ratingCount: 12, customAmenities: ["20 rooms"] });
  const c = hall({ id: C, name: "Kovai Hall", capacityMax: 300 });
  const labels = { wedding: "Wedding", reception: "Reception" };
  const rows = compareRows([a, b, c], labels);
  const row = (key: string) => rows.find((r) => r.key === key)!;

  it("crowns the lowest PUBLISHED price, and never the hall with none", () => {
    expect(row("price").cells).toEqual(["₹1,60,000", "₹1,20,000", "Contact for pricing"]);
    expect(row("price").best).toEqual([1]);
    expect(row("price").bestLabel).toBe("Lowest");
  });

  it("names no winner on a tie, or with only one value", () => {
    const tie = compareRows([hall({ pricePerDay: 100000 }), hall({ id: B, pricePerDay: 100000 })], {});
    expect(tie.find((r) => r.key === "price")!.best).toEqual([]);
    const lone = compareRows([hall({ pricePerDay: 100000 }), hall({ id: B })], {});
    expect(lone.find((r) => r.key === "price")!.best).toEqual([]);
  });

  it("shows guests as a range when the hall gave one, and marks the most", () => {
    expect(row("guests").cells).toEqual(["150–450 guests", "Up to 800 guests", "Up to 300 guests"]);
    expect(row("guests").best).toEqual([1]);
  });

  it("says how each hall is booked, briefly", () => {
    expect(row("booking").cells).toEqual(["Send an enquiry", "Book online with an advance", "Send an enquiry"]);
  });

  it("drops rows nobody filled, and keeps the ones somebody did", () => {
    expect(row("slots").cells).toEqual(["Morning ₹90,000", "—", "—"]);
    expect(row("rating").cells).toEqual(["No reviews yet", "4.6 ★ (12 reviews)", "No reviews yet"]);
    expect(row("occasions").cells).toEqual(["Wedding, Reception", "—", "—"]);
    expect(row("extras").cells).toEqual(["—", "20 rooms", "—"]);
    const bare = compareRows([hall({}), hall({ id: B })], {}).map((r) => r.key);
    expect(bare).toEqual(["price", "guests", "booking"]);
  });

  it("never claims a hall lacks something — only that it has not listed it", () => {
    const all = rows.flatMap((r) => [r.label, ...r.cells]).join(" ");
    expect(all).not.toMatch(/\bno parking\b|not available|\bnone\b|\bfree\b/i);
    const page = read("app/compare/[code]/page.tsx") + read("components/compare/CompareTable.tsx");
    expect(page).toContain("A dash means the hall hasn&apos;t listed it, so ask the hall.");
    expect(page).toContain('aria-label="Not listed"');
  });
});

describe("amenities", () => {
  it("lists what any hall lists, families' order first, with a tick per hall", () => {
    const rows = amenityRows([
      hall({ amenities: [{ slug: "generator-backup", name: "Generator Backup" }, { slug: "air-conditioning", name: "Air Conditioning" }] }),
      hall({ id: B, amenities: [{ slug: "free-parking", name: "Free Parking" }, { slug: "zz-custom", name: "Aardvark Lawn" }] }),
    ]);
    expect(rows.map((r) => r.slug)).toEqual(["air-conditioning", "free-parking", "generator-backup", "zz-custom"]);
    expect(rows.find((r) => r.slug === "free-parking")!.has).toEqual([false, true]);
  });
});

describe("sharing and finding it", () => {
  it("writes the message and the map link", () => {
    expect(compareShareText(3)).toBe("I'm comparing these 3 halls on Hallnect. Which one should we pick?");
    expect(versusLine([{ name: "A" }, { name: "B" }])).toBe("A vs B");
    expect(mapsUrl(hall({ latitude: 9.9, longitude: 78.1 }))).toBe("https://maps.google.com/?q=9.9,78.1");
    expect(mapsUrl(hall({ address: "No. 12, Bypass Road" }))).toBe(
      `https://maps.google.com/?q=${encodeURIComponent("No. 12, Bypass Road, Madurai")}`,
    );
  });

  it("the picker: one tap for two or three halls, ticks for more, nothing for one", () => {
    const two = renderToStaticMarkup(createElement(ComparePicker, { halls: [{ id: A, name: "A" }, { id: B, name: "B" }] }));
    expect(two).toContain(`href="/compare/${compareCode([A, B])}"`);
    expect(two).toContain("Compare these 2 halls");
    expect(two).not.toContain('type="checkbox"');
    const five = renderToStaticMarkup(createElement(ComparePicker, {
      halls: [A, B, C, D, "22222222-2222-4222-8222-222222222222"].map((id, i) => ({ id, name: `H${i}` })),
    }));
    expect(five.match(/type="checkbox"/g)).toHaveLength(5);
    expect(five).toContain("Tick at least 2 halls.");
    expect(renderToStaticMarkup(createElement(ComparePicker, { halls: [{ id: A, name: "A" }] }))).toBe("");
  });

  it("is reachable from the saved list and a shared shortlist", () => {
    expect(read("app/saved/_components/SavedView.tsx")).toContain("<ComparePicker");
    expect(read("app/shortlist/[code]/page.tsx")).toContain("<ComparePicker");
  });
});

describe("guard rails", () => {
  const page = read("app/compare/[code]/page.tsx");
  const load = read("app/compare/[code]/load.ts");
  const server = read("lib/compare.server.ts");

  it("never indexed, never robots-blocked (WhatsApp must read the preview)", () => {
    expect(page).toContain("indexable: false");
    expect(page).toContain('noindexMetadata("Comparison not found")');
    expect(read("app/robots.ts")).not.toContain("/compare");
  });

  it("a failed read says so, instead of calling the halls gone", () => {
    expect(load).toContain("if (!halls) return { ids, halls: [], missing: 0, failed: true };");
    expect(server).toContain("return null;");
    expect(page.indexOf("We couldn't load this comparison")).toBeLessThan(page.indexOf("Not enough of these halls"));
  });

  it("reads approved halls through the public client, in the sender's order", () => {
    expect(server).toContain('.eq("status", "approved")');
    expect(server).toContain("getSupabasePublicClient()");
    expect(server).toContain("ids.map((id) => byId.get(id))");
  });

  it("says plainly what it does not compare", () => {
    expect(page).toContain("Not compared here: dining hall size, rooms and parking space.");
  });
});
