import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  organizationJsonLd, venueJsonLd, venueWebPageJsonLd, venuePriceRange,
  cityCollectionJsonLd, allVenuesCollectionJsonLd,
} from "../seo/jsonld";
import { BUSINESS } from "../seo/config";
import { CONTACT } from "../constants";

// ─────────────────────────────────────────────────────────────────────────────
// SEO phase 4 (2026-10-10): structured data.
//   • The venue is EventVenue + LocalBusiness, which is what makes priceRange a
//     valid property; Hallnect itself stays a plain Organization.
//   • isPartOf left the venue (a Place) for a WebPage node, which also carries
//     the listing's dateModified.
//   • Organization states its GSTIN and LLPIN — both printed on /about.
//   • /halls lists every live venue (ItemList); city pages carry dateModified.
// scripts/validate-structured-data.mjs checks the rendered pages against
// schema.org, Google's required fields and the page's visible text; on the
// live site it found the isPartOf defect this phase removes.
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const venue = {
  name: "NS KHALYAANA MAHAL",
  slug: "ns-khalyaana-mahal-madurai",
  description: "A wedding venue.",
  city: "Madurai",
  state: "Tamil Nadu",
  address: "139-H, Big Car Street",
  pincode: "625005",
  latitude: null,
  longitude: null,
  capacityMax: 450,
  pricePerDay: 160000,
  ratingAverage: 0,
  ratingCount: 0,
  images: [{ url: "https://x/1.jpg", alt: null }],
  amenities: ["Air Conditioning"],
  venueTypes: ["Wedding", "Reception"],
};

describe("the venue node", () => {
  const node = venueJsonLd(venue) as Record<string, unknown>;

  it("is EventVenue and LocalBusiness, with the published price", () => {
    expect(node["@type"]).toEqual(["EventVenue", "LocalBusiness"]);
    expect(node.priceRange).toBe("₹1,60,000");
  });

  it("has no isPartOf (CreativeWork only), no telephone, and no invented geo or rating", () => {
    for (const k of ["isPartOf", "telephone", "geo", "aggregateRating"]) expect(node, k).not.toHaveProperty(k);
  });

  it("geo appears only from real coordinates", () => {
    const pinned = venueJsonLd({ ...venue, latitude: 9.88, longitude: 78.08 }) as Record<string, unknown>;
    expect(pinned.geo).toEqual({ "@type": "GeoCoordinates", latitude: 9.88, longitude: 78.08 });
  });
});

describe("priceRange", () => {
  it("is the day rate, a range with half-day rates, and absent with no price", () => {
    expect(venuePriceRange({ pricePerDay: 160000 })).toBe("₹1,60,000");
    expect(venuePriceRange({ pricePerDay: 160000, priceMorning: 60000, priceEvening: 90000 })).toBe("₹60,000–₹1,60,000");
    expect(venuePriceRange({ pricePerDay: null })).toBeUndefined();
    expect(venuePriceRange({ pricePerDay: 0 })).toBeUndefined();
    expect(venueJsonLd({ ...venue, pricePerDay: null })).not.toHaveProperty("priceRange");
  });
});

describe("the venue page node", () => {
  it("is the WebPage that is part of the site, about the venue, dated from the listing", () => {
    const page = venueWebPageJsonLd({
      slug: venue.slug,
      name: "NS KHALYAANA MAHAL | Wedding Hall in Madurai",
      description: "d",
      dateModified: "2026-09-17T13:41:40.899814+00:00",
    }) as Record<string, unknown>;
    expect(page["@type"]).toBe("WebPage");
    expect(String(page["@id"])).toMatch(/\/halls\/ns-khalyaana-mahal-madurai#webpage$/);
    expect(page.isPartOf).toEqual({ "@id": expect.stringMatching(/#website$/) });
    expect(page.mainEntity).toEqual({ "@id": expect.stringMatching(/\/halls\/ns-khalyaana-mahal-madurai#venue$/) });
    expect(page.dateModified).toBe("2026-09-17T13:41:40.899814+00:00");
    expect(venueWebPageJsonLd({ slug: "x", name: "n", description: "d", dateModified: null })).not.toHaveProperty("dateModified");
  });

  it("is emitted with the venue, from the page's own title and description", () => {
    const src = read("app/halls/[slug]/_components/VenuePage.tsx");
    expect(src).toContain("name: venueTitle(hall),");
    expect(src).toContain("description: venueDescription(hall),");
    expect(src).toContain("dateModified: hall.updated_at,");
    expect(src).toContain("priceMorning: hall.price_morning,");
  });
});

describe("who runs Hallnect", () => {
  const org = organizationJsonLd() as Record<string, unknown>;

  it("states the GSTIN and LLPIN the About page prints", () => {
    expect(org.vatID).toBe(CONTACT.gstin);
    expect(org.identifier).toEqual({ "@type": "PropertyValue", propertyID: "LLPIN", value: CONTACT.llpin });
    const about = read("app/about/page.tsx");
    expect(about).toContain('label="LLPIN" value={CONTACT.llpin}');
    expect(about).toContain('label="GSTIN" value={CONTACT.gstin}');
  });

  it("has ONE name, address and contact everywhere (structured data = the site)", () => {
    expect(BUSINESS.legalName).toBe(CONTACT.legalName);
    expect(BUSINESS.email).toBe(CONTACT.email);
    expect(BUSINESS.phone).toBe(CONTACT.phone);
    // The site prints one address line; the markup splits it into parts.
    for (const part of [BUSINESS.street, BUSINESS.locality, BUSINESS.postalCode, BUSINESS.region]) {
      expect(CONTACT.address, part).toContain(part);
    }
  });
});

describe("listing pages", () => {
  it("/halls lists every live venue, on the unfiltered page only", () => {
    const list = allVenuesCollectionJsonLd({
      path: "/halls",
      description: "d",
      venues: [{ name: "A", slug: "a" }, { name: "B", slug: "b" }],
    }) as Record<string, unknown>;
    expect(list["@type"]).toBe("CollectionPage");
    const items = (list.mainEntity as { itemListElement: { position: number; url: string }[]; numberOfItems: number });
    expect(items.numberOfItems).toBe(2);
    expect(items.itemListElement.map((i) => i.position)).toEqual([1, 2]);
    const page = read("app/halls/(browse)/page.tsx");
    expect(page).toContain("...(isFiltered(sp) || hallsFailed");
    expect(page).toContain("description: HALLS_DESCRIPTION,");
  });

  it("city pages carry the date they print", () => {
    const c = cityCollectionJsonLd({ city: "Madurai", path: "/wedding-halls/madurai", description: "d", venues: [], dateModified: "2026-09-17T13:41:40Z" });
    expect((c as Record<string, unknown>).dateModified).toBe("2026-09-17T13:41:40Z");
    for (const f of ["app/wedding-halls/[city]/page.tsx", "app/ta/wedding-halls/[city]/page.tsx"]) {
      expect(read(f), f).toContain("dateModified: inventory?.lastUpdated,");
    }
  });
});

describe("the validator", () => {
  it("checks schema.org, Google's required fields and the visible page", () => {
    const v = read("scripts/validate-structured-data.mjs");
    expect(v).toContain('is not a property of ${types.join("+")}');
    expect(v).toContain("not visible on the page:");
    expect(v).toContain("is not shown on the page");
  });
});
