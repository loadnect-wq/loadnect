import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_SHORTLIST,
  citiesSummary,
  decodeShortlist,
  encodeShortlist,
  hallNamesSummary,
  shareMessage,
  shortlistPath,
  shortlistTitle,
  whatsappShareUrl,
} from "../shortlist";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const A = "fda1a579-57b5-4def-acc4-ee27b060a67f";
const B = "0b6c2f4e-1d3a-4c5b-9e8f-7a6b5c4d3e2f";
const C = "ffffffff-ffff-4fff-bfff-ffffffffffff";

describe("the code is the list", () => {
  it("round-trips ids, in order, at 22 characters a hall", () => {
    const code = encodeShortlist([B, A, C])!;
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code).toHaveLength(64); // 48 bytes -> 64 base64url characters
    expect(decodeShortlist(code)).toEqual([B, A, C]);
    expect(encodeShortlist([A])).toHaveLength(22);
  });

  it("drops junk and repeats, and stops at the cap", () => {
    expect(encodeShortlist(["nope", A, A.toUpperCase(), B])).toBe(encodeShortlist([A, B]));
    expect(encodeShortlist([])).toBeNull();
    expect(encodeShortlist(["not-a-uuid"])).toBeNull();
    const many = Array.from({ length: MAX_SHORTLIST + 5 }, () => randomUUID());
    expect(decodeShortlist(encodeShortlist(many)!)).toEqual(many.slice(0, MAX_SHORTLIST));
  });

  it("refuses anything that is not exactly one canonical code", () => {
    const code = encodeShortlist([A, B])!;
    expect(decodeShortlist(code + "=")).toBeNull();          // padding
    expect(decodeShortlist(code + "A")).toBeNull();          // not a whole id
    expect(decodeShortlist(code.slice(0, -1))).toBeNull();
    expect(decodeShortlist("")).toBeNull();
    expect(decodeShortlist("../../etc")).toBeNull();
    expect(decodeShortlist("a b")).toBeNull();
    expect(decodeShortlist("x".repeat(400))).toBeNull();
    // The same id twice decodes, but re-encodes shorter: not canonical.
    const aBytes = Buffer.from(A.replace(/-/g, ""), "hex");
    const twice = Buffer.concat([aBytes, aBytes]).toString("base64url");
    expect(twice).toHaveLength(43);
    expect(decodeShortlist(twice)).toBeNull();
    // Whereas the same bytes for two different ids are a real list.
    const two = Buffer.concat([aBytes, Buffer.from(B.replace(/-/g, ""), "hex")]).toString("base64url");
    expect(decodeShortlist(two)).toEqual([A, B]);
    // Thirteen ids is over the cap even when every one is valid.
    const bytes = Buffer.alloc(16 * (MAX_SHORTLIST + 1), 0x11);
    expect(decodeShortlist(bytes.toString("base64url"))).toBeNull();
  });

  it("makes the path", () => {
    expect(shortlistPath("abc")).toBe("/shortlist/abc");
  });
});

describe("what the family group sees", () => {
  const halls = [
    { name: "NS Khalyaana Mahal", city: "Madurai" },
    { name: "Sri Mahal", city: "Madurai" },
    { name: "Kovai Hall", city: "Coimbatore" },
    { name: "Lakshmi Hall", city: "Madurai" },
  ];

  it("names the halls briefly", () => {
    expect(hallNamesSummary(halls.slice(0, 1))).toBe("NS Khalyaana Mahal");
    expect(hallNamesSummary(halls.slice(0, 2))).toBe("NS Khalyaana Mahal and Sri Mahal");
    expect(hallNamesSummary(halls.slice(0, 3))).toBe("NS Khalyaana Mahal, Sri Mahal and Kovai Hall");
    expect(hallNamesSummary(halls)).toBe("NS Khalyaana Mahal, Sri Mahal and 2 more");
    expect(citiesSummary(halls)).toBe("Madurai and Coimbatore");
    expect(citiesSummary([...halls, { name: "X", city: "Trichy" }])).toBe("3 cities");
    expect(shortlistTitle(1)).toBe("1 hall shortlisted");
    expect(shortlistTitle(3)).toBe("3 halls shortlisted");
  });

  it("writes the message in the sender's voice, link last", () => {
    const msg = shareMessage("https://hallnect.com/shortlist/abc", 3);
    expect(msg).toBe("Here are the 3 halls I've shortlisted on Hallnect. Which one do you like?\nhttps://hallnect.com/shortlist/abc");
    expect(shareMessage("u", 1)).toBe("Here's the hall I've shortlisted on Hallnect. What do you think?\nu");
    expect(whatsappShareUrl(msg)).toBe(`https://wa.me/?text=${encodeURIComponent(msg)}`);
  });
});

describe("guard rails", () => {
  const page = read("app/shortlist/[code]/page.tsx");
  const load = read("app/shortlist/[code]/load.ts");

  it("never lets Google index a shortlist, but lets WhatsApp read its preview", () => {
    expect(page.match(/indexable: false/g)?.length).toBe(2);
    expect(page).toContain('noindexMetadata("Shortlist not found")');
    expect(read("app/robots.ts")).not.toContain("/shortlist");
  });

  it("a failed read says so, instead of calling the halls delisted", () => {
    expect(load).toContain("if (failed) return { ids, halls: [], missing: 0, failed: true };");
    expect(page.indexOf("We couldn't load this shortlist")).toBeLessThan(page.indexOf("These halls are no longer on Hallnect"));
  });

  it("keeps the sender's order and reads through the public client", () => {
    expect(load).toContain("ids.map((id) => byId.get(id))");
    expect(load).toContain("fetchHallsResult({ ids })");
  });

  it("shares only the halls still listed, in saved order", () => {
    const saved = read("app/saved/_components/SavedView.tsx");
    expect(saved).toContain("ids.filter((id) => halls.some((h) => h.id === id))");
    expect(saved).toContain("encodeShortlist(shareIds)");
  });

  it("links to the canonical host, so a share never points at a preview deploy", () => {
    // The shared buttons build every share link; the shortlist passes its path.
    expect(read("components/share/ShareButtons.tsx")).toContain("const url = absoluteUrl(path);");
    expect(read("components/shortlist/ShareShortlist.tsx")).toContain("path={shortlistPath(code)}");
  });
});
