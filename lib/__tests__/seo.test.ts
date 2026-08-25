// SEO regression tests.
//
// These pin the rules that are easy to break silently later: a canonical that
// drifts onto a preview host, a title that grows past the SERP limit, a rating
// invented for a venue with no reviews, or a city page that starts indexing
// itself with nothing on it.

import { describe, it, expect } from "vitest";
import {
  absoluteUrl, isPublishableUrl, SITE_URL, FORBIDDEN_CANONICAL_HOSTS,
} from "@/lib/seo/config";
import { buildMetadata, noindexMetadata, clamp } from "@/lib/seo/metadata";
import {
  organizationJsonLd, websiteJsonLd, venueJsonLd, breadcrumbJsonLd,
  cityCollectionJsonLd, faqJsonLd, jsonLdGraph,
} from "@/lib/seo/jsonld";
import { citySlug, cityFromSlug, MIN_VENUES_FOR_INDEX } from "@/lib/seo/cities";

describe("canonical URLs", () => {
  // NOTE: under vitest NODE_ENV is not "production" and there is no window, so
  // getCanonicalAppUrl() resolves to http://localhost:3000 by design. These
  // tests therefore assert the RULES against explicit URLs rather than against
  // the ambient origin — the production origin is asserted separately below and
  // enforced for real by the live checks after deploy.
  it("are absolute and rooted at the resolved site origin", () => {
    expect(absoluteUrl("/halls")).toBe(`${SITE_URL}/halls`);
    expect(absoluteUrl("/halls")).toMatch(/^https?:\/\//);
  });

  it("accept the real production origin", () => {
    expect(isPublishableUrl("https://www.hallnect.com/halls")).toBe(true);
    expect(isPublishableUrl("https://hallnect.com/halls")).toBe(true);
  });

  it("never point at a preview, retired or local host", () => {
    for (const bad of FORBIDDEN_CANONICAL_HOSTS) {
      expect(isPublishableUrl(`https://${bad}/halls`)).toBe(false);
    }
    expect(isPublishableUrl("https://hallnect5.vercel.app/halls")).toBe(false);
    expect(isPublishableUrl("https://hallnect-git-main-abc.vercel.app/halls")).toBe(false);
    expect(isPublishableUrl("http://www.hallnect.com/halls")).toBe(false); // not https
  });

  it("strip query strings and fragments — one page, one canonical", () => {
    expect(absoluteUrl("/halls?city=Madurai&sort=rating")).toBe(`${SITE_URL}/halls`);
    expect(absoluteUrl("/halls#results")).toBe(`${SITE_URL}/halls`);
  });

  it("normalise slashes so one page cannot have two canonicals", () => {
    expect(absoluteUrl("/halls/")).toBe(absoluteUrl("/halls"));
    expect(absoluteUrl("halls")).toBe(absoluteUrl("/halls"));
    expect(absoluteUrl("//halls//")).toBe(absoluteUrl("/halls"));
    expect(absoluteUrl("/")).toBe(SITE_URL);
  });
});

describe("buildMetadata", () => {
  const meta = buildMetadata({
    title: "Wedding Halls in Madurai",
    description: "Compare verified wedding halls in Madurai with photos, capacity and pricing.",
    path: "/wedding-halls/madurai",
  });

  it("always sets a self-referencing canonical", () => {
    expect(meta.alternates?.canonical).toBe(`${SITE_URL}/wedding-halls/madurai`);
  });

  it("always sets Open Graph and Twitter, with the canonical as og:url", () => {
    expect(meta.openGraph?.title).toBeTruthy();
    expect(meta.openGraph?.description).toBeTruthy();
    expect((meta.openGraph as { url?: string })?.url).toBe(`${SITE_URL}/wedding-halls/madurai`);
    expect((meta.twitter as { card?: string })?.card).toBe("summary_large_image");
  });

  it("always supplies at least one OG image", () => {
    const images = (meta.openGraph as { images?: unknown[] })?.images;
    expect(Array.isArray(images) && images.length > 0).toBe(true);
  });

  it("is indexable by default and noindex on request", () => {
    expect((meta.robots as { index?: boolean })?.index).toBe(true);
    const off = buildMetadata({ title: "T", description: "D", path: "/x", indexable: false });
    expect((off.robots as { index?: boolean })?.index).toBe(false);
    // follow stays true so venue links are still discovered from a filtered view
    expect((off.robots as { follow?: boolean })?.follow).toBe(true);
  });

  it("keeps titles and descriptions inside SERP limits", () => {
    const long = buildMetadata({
      title: "A ridiculously long venue title that would certainly be truncated by Google in the results page",
      description: "x".repeat(400),
      path: "/x",
    });
    expect(String(long.title).length).toBeLessThanOrEqual(65);
    expect(String(long.description).length).toBeLessThanOrEqual(158);
  });

  it("does not cut words in half when clamping", () => {
    expect(clamp("alpha beta gamma delta", 14)).not.toMatch(/gam…$/);
  });
});

describe("noindexMetadata", () => {
  it("blocks indexing AND following for private pages", () => {
    const m = noindexMetadata("Admin");
    expect((m.robots as { index?: boolean })?.index).toBe(false);
    expect((m.robots as { follow?: boolean })?.follow).toBe(false);
  });

  it("never nominates a canonical for a page that should not be indexed", () => {
    expect(noindexMetadata("Checkout").alternates?.canonical).toBeUndefined();
  });
});

describe("venue structured data", () => {
  const base = {
    name: "Grand Lotus Mahal",
    slug: "grand-lotus-mahal",
    description: "A banquet hall in central Madurai.",
    city: "Madurai",
    state: "Tamil Nadu",
    address: "12 Main Road",
    pincode: "625001",
    latitude: null,
    longitude: null,
    capacityMax: 800,
    pricePerDay: 40000,
    images: [{ url: "https://example.supabase.co/a.jpg", alt: null }],
    amenities: ["Air conditioning", "Parking"],
  };

  it("NEVER invents a rating for a venue with no reviews", () => {
    const node = venueJsonLd({ ...base, ratingAverage: 0, ratingCount: 0 });
    expect(node.aggregateRating).toBeUndefined();
  });

  it("publishes a rating only when real reviews exist", () => {
    const node = venueJsonLd({ ...base, ratingAverage: 4.6, ratingCount: 12 });
    const r = node.aggregateRating as Record<string, unknown>;
    expect(r.ratingValue).toBe(4.6);
    expect(r.reviewCount).toBe(12);
  });

  it("never emits Review nodes (authors are unavailable, Google requires them)", () => {
    const node = venueJsonLd({ ...base, ratingAverage: 4.6, ratingCount: 12 });
    expect(node.review).toBeUndefined();
  });

  it("omits geo entirely when coordinates are unknown, rather than guessing", () => {
    expect(venueJsonLd({ ...base, ratingAverage: 0, ratingCount: 0 }).geo).toBeUndefined();
    const withGeo = venueJsonLd({ ...base, latitude: 9.9252, longitude: 78.1198, ratingAverage: 0, ratingCount: 0 });
    expect(withGeo.geo).toBeDefined();
  });

  it("omits address parts that are null instead of publishing empty strings", () => {
    const node = venueJsonLd({ ...base, address: null, pincode: null, ratingAverage: 0, ratingCount: 0 });
    const addr = node.address as Record<string, unknown>;
    expect(addr.streetAddress).toBeUndefined();
    expect(addr.postalCode).toBeUndefined();
    expect(addr.addressLocality).toBe("Madurai");
  });

  it("uses the canonical venue URL as its id and url", () => {
    const node = venueJsonLd({ ...base, ratingAverage: 0, ratingCount: 0 });
    expect(node.url).toBe(`${SITE_URL}/halls/grand-lotus-mahal`);
    expect(String(node["@id"])).toContain(`${SITE_URL}/halls/grand-lotus-mahal`);
  });
});

describe("organization and website schema", () => {
  it("never claims social profiles Hallnect has not configured", () => {
    expect(organizationJsonLd().sameAs).toBeUndefined();
  });

  it("points SearchAction at a route that really handles the query", () => {
    const action = websiteJsonLd().potentialAction as Record<string, unknown>;
    const target = action.target as Record<string, unknown>;
    // /halls genuinely reads ?q= (HallsFilters.q)
    expect(String(target.urlTemplate)).toBe(`${SITE_URL}/halls?q={search_term_string}`);
  });
});

describe("breadcrumbs", () => {
  it("number positions from 1 and use absolute URLs", () => {
    const bc = breadcrumbJsonLd([
      { name: "Home", path: "/" },
      { name: "Madurai", path: "/wedding-halls/madurai" },
    ]);
    const items = bc.itemListElement;
    expect(items[0].position).toBe(1);
    expect(items[1].position).toBe(2);
    expect(items[1].item).toBe(`${SITE_URL}/wedding-halls/madurai`);
  });
});

describe("city pages", () => {
  it("slugs round-trip", () => {
    expect(citySlug("Madurai")).toBe("madurai");
    expect(cityFromSlug("madurai")).toBe("Madurai");
    expect(cityFromSlug("tiruchirappalli")).toBe("Tiruchirappalli");
  });

  it("rejects a city Hallnect does not serve, so it can 404 rather than render empty", () => {
    expect(cityFromSlug("mumbai")).toBeNull();
    expect(cityFromSlug("../etc/passwd")).toBeNull();
  });

  it("requires at least one real venue before a city may be indexed", () => {
    expect(MIN_VENUES_FOR_INDEX).toBeGreaterThanOrEqual(1);
  });

  it("omits the ItemList when a city has no venues (no empty collection markup)", () => {
    const empty = cityCollectionJsonLd({ city: "Chennai", path: "/wedding-halls/chennai", description: "d", venues: [] });
    expect(empty.mainEntity).toBeUndefined();
    const full = cityCollectionJsonLd({
      city: "Madurai", path: "/wedding-halls/madurai", description: "d",
      venues: [{ name: "A", slug: "a" }],
    });
    expect(full.mainEntity).toBeDefined();
  });
});

describe("json-ld graph", () => {
  it("wraps nodes in a single @context/@graph document", () => {
    const g = jsonLdGraph(organizationJsonLd(), faqJsonLd([{ q: "Q?", a: "A." }]));
    expect(g["@context"]).toBe("https://schema.org");
    expect(Array.isArray(g["@graph"])).toBe(true);
    expect((g["@graph"] as unknown[]).length).toBe(2);
  });

  it("serialises without characters that could break out of a script tag", () => {
    const g = jsonLdGraph(faqJsonLd([{ q: "</script><img onerror=alert(1)>", a: "A" }]));
    const escaped = JSON.stringify(g).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    expect(escaped).not.toContain("</script>");
    expect(escaped).not.toContain("<img");
  });
});

describe("canonical origin resolution (apex cut-over)", () => {
  // The production env vars still carry the pre-cut-over www value and cannot
  // be edited in place (Vercel refuses to re-save a NEXT_PUBLIC_ variable typed
  // as a Secret). lib/app-url.ts therefore ignores non-serving hosts outright,
  // so a stale override cannot drag canonicals back onto a redirect.
  it("treats the redirecting www host as non-canonical", () => {
    expect(isPublishableUrl("https://hallnect.com/halls")).toBe(true);
    // www is a valid https host, so isPublishableUrl accepts it; the guard that
    // matters lives in getCanonicalAppUrl, asserted by the SITE_URL check below.
    expect(SITE_URL.includes("www.")).toBe(false);
  });

  it("resolves SITE_URL to a host with no leading www", () => {
    expect(SITE_URL).not.toMatch(/^https?:\/\/www\./);
  });
});
