// ─────────────────────────────────────────────────────────────────────────────
// lib/seo/jsonld.ts — Schema.org JSON-LD, generated ONLY from real data.
//
// HARD RULES enforced here, not left to call sites:
//   • aggregateRating is emitted ONLY when rating_count > 0. A rating built on
//     zero reviews is both Google-spam and a lie about a real business.
//   • Review nodes are NEVER emitted: review authors are unavailable (see the
//     note on VenueJsonLdInput), and Google requires an author on each one.
//   • address/geo/telephone fields are omitted when null rather than guessed.
//   • no property is invented: every key below is real Schema.org vocabulary.
// Anything the database does not know, the markup does not claim.
// ─────────────────────────────────────────────────────────────────────────────

import { SITE_URL, SITE_NAME, BUSINESS, absoluteUrl } from "./config";
import { SUPPORT_HOURS } from "@/lib/constants";

/** Drops null/undefined/empty values so no hollow properties are published. */
function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

/**
 * The state name as an entity, not as the owner typed it.
 *
 * `halls.state` is free text on the owner's form, so it arrives as "Tamilnadu",
 * "TAMIL NADU", "tamil  nadu". Whatever they typed was written straight into
 * addressRegion, where it disagreed with the "Tamil Nadu" every other node on
 * the site publishes — and two spellings of one region is exactly the kind of
 * inconsistency that stops a knowledge graph merging two references into one
 * place. Unrecognised values pass through untouched: normalising is for
 * spellings we know, not for guessing at ones we do not.
 */
export function canonicalState(state: string | null | undefined): string {
  const raw = (state ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "Tamil Nadu";
  const key = raw.toLowerCase().replace(/[^a-z]/g, "");
  const KNOWN: Record<string, string> = {
    tamilnadu: "Tamil Nadu",
    tn: "Tamil Nadu",
    tamilnad: "Tamil Nadu",
    puducherry: "Puducherry",
    pondicherry: "Puducherry",
    kerala: "Kerala",
    karnataka: "Karnataka",
    andhrapradesh: "Andhra Pradesh",
  };
  return KNOWN[key] ?? raw;
}

export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

/** Organization — the publisher behind every page. */
export function organizationJsonLd() {
  return compact({
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: SITE_NAME,
    legalName: BUSINESS.legalName,
    url: SITE_URL,
    logo: compact({
      "@type": "ImageObject",
      url: absoluteUrl("/logo.png"),
      width: 477,
      height: 523,
    }),
    email: BUSINESS.email,
    telephone: BUSINESS.phone,
    address: compact({
      "@type": "PostalAddress",
      streetAddress: BUSINESS.street,
      addressLocality: BUSINESS.locality,
      addressRegion: BUSINESS.region,
      postalCode: BUSINESS.postalCode,
      addressCountry: BUSINESS.country,
    }),
    areaServed: compact({
      "@type": "State",
      name: "Tamil Nadu",
      containedInPlace: { "@type": "Country", name: "India" },
    }),
    contactPoint: [
      compact({
        "@type": "ContactPoint",
        contactType: "customer support",
        email: BUSINESS.email,
        telephone: BUSINESS.phone,
        areaServed: "IN",
        availableLanguage: ["en", "ta"],
        // hoursAvailable belongs to ContactPoint. openingHoursSpecification
        // does NOT — it is a property of Place/LocalBusiness, and this node is
        // a plain Organization (Hallnect is a service-area business with no
        // storefront, so LocalBusiness would be the wrong type to claim).
        // Same numbers the contact page prints, from the same constant.
        hoursAvailable: compact({
          "@type": "OpeningHoursSpecification",
          dayOfWeek: [...SUPPORT_HOURS.days],
          opens: SUPPORT_HOURS.opens,
          closes: SUPPORT_HOURS.closes,
        }),
      }),
    ],
    // sameAs is deliberately ABSENT: Hallnect has no verified social profiles
    // configured. Inventing them would be fabricated structured data.
  });
}

/**
 * WebSite. SearchAction targets /halls?q= — a real, server-rendered search that
 * genuinely honours the q parameter (HallsFilters.q in lib/halls.ts), so the
 * action is not a fiction pointing at a route that cannot serve it.
 */
export function websiteJsonLd() {
  return compact({
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: SITE_URL,
    name: SITE_NAME,
    inLanguage: "en-IN",
    publisher: { "@id": ORGANIZATION_ID },
    potentialAction: compact({
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/halls?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    }),
  });
}

export type Crumb = { name: string; path: string };

/** BreadcrumbList — must mirror the breadcrumbs actually rendered on the page. */
export function breadcrumbJsonLd(crumbs: Crumb[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.path),
    })),
  };
}

export type VenueJsonLdInput = {
  name: string;
  slug: string;
  description: string | null;
  city: string;
  state: string | null;
  address: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  capacityMax: number;
  /** Null for a lead-generation venue that publishes no price. */
  pricePerDay: number | null;
  ratingAverage: number;
  ratingCount: number;
  images: { url: string; alt: string | null }[];
  amenities: string[];
  // NOTE: no `reviews` input. fetchHallBySlug deliberately does not join
  // profiles (RLS blocks anonymous reads of other users' rows), so review
  // AUTHORS are unavailable — and Google requires an author on every Review
  // node. Emitting author-less reviews would be invalid structured data, so
  // this file publishes the aggregate rating only, which is valid on its own.
};

/**
 * EventVenue for a hall. EventVenue is the accurate type for a bookable event
 * space; LocalBusiness would assert a walk-in trading business, which a venue
 * listed by a third party on a marketplace is not.
 */
export function venueJsonLd(v: VenueJsonLdInput) {
  const hasRatings = v.ratingCount > 0 && v.ratingAverage > 0;

  return compact({
    "@type": "EventVenue",
    "@id": `${absoluteUrl(`/halls/${v.slug}`)}#venue`,
    // Ties the venue to the site entity. Without it this node floated free of
    // the graph, so nothing connected the venue to the publisher that vouches
    // for it.
    isPartOf: { "@id": WEBSITE_ID },
    name: v.name,
    description: v.description,
    url: absoluteUrl(`/halls/${v.slug}`),
    image: v.images.slice(0, 6).map((i) => i.url),
    address: compact({
      "@type": "PostalAddress",
      streetAddress: v.address,
      addressLocality: v.city,
      // NORMALISED. This is a free-text column an owner fills in, so it
      // arrives as "Tamilnadu", "TAMIL NADU", "tamil nadu" — and whatever they
      // typed was published straight into structured data, disagreeing with
      // every other node on the site, which says "Tamil Nadu". An unrecognised
      // value is passed through untouched rather than forced.
      addressRegion: canonicalState(v.state),
      postalCode: v.pincode,
      addressCountry: "IN",
    }),
    geo:
      v.latitude != null && v.longitude != null
        ? { "@type": "GeoCoordinates", latitude: v.latitude, longitude: v.longitude }
        : undefined,
    maximumAttendeeCapacity: v.capacityMax,
    amenityFeature: v.amenities.slice(0, 20).map((a) => ({
      "@type": "LocationFeatureSpecification",
      name: a,
      value: true,
    })),
    // NO priceRange HERE. Schema.org defines priceRange on LocalBusiness, not
    // on EventVenue (which descends from Place), so it was an invalid property
    // on this node. The day rate is not lost — it reaches search through the
    // meta description (lib/seo/venue.ts), the visible Pricing section, and the
    // city page's first FAQ answer. Do not re-add it by multi-typing this node
    // as ["EventVenue","LocalBusiness"] either: a LocalBusiness claim implies a
    // storefront Hallnect does not operate, and it would contradict the Google
    // Business Profile, which is registered as a service-area business.
    aggregateRating: hasRatings
      ? compact({
          "@type": "AggregateRating",
          ratingValue: Number(v.ratingAverage.toFixed(1)),
          reviewCount: v.ratingCount,
          bestRating: 5,
          worstRating: 1,
        })
      : undefined,
    containedInPlace: compact({
      "@type": "City",
      name: v.city,
      containedInPlace: { "@type": "State", name: v.state ?? "Tamil Nadu" },
    }),
  });
}

/** FAQPage — only ever called with Q&As that are ALSO visible on the page. */
export function faqJsonLd(faqs: { q: string; a: string }[]) {
  return {
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/** CollectionPage for a city listing, with its venues as an ItemList. */
export function cityCollectionJsonLd(input: {
  city: string;
  path: string;
  description: string;
  venues: { name: string; slug: string }[];
}) {
  return compact({
    "@type": "CollectionPage",
    "@id": `${absoluteUrl(input.path)}#collection`,
    url: absoluteUrl(input.path),
    name: `Wedding halls in ${input.city}`,
    description: input.description,
    isPartOf: { "@id": WEBSITE_ID },
    about: compact({
      "@type": "City",
      name: input.city,
      containedInPlace: { "@type": "State", name: "Tamil Nadu" },
    }),
    mainEntity: input.venues.length
      ? {
          "@type": "ItemList",
          numberOfItems: input.venues.length,
          itemListElement: input.venues.map((v, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: v.name,
            url: absoluteUrl(`/halls/${v.slug}`),
            // By @id, so the list references the SAME node the venue page
            // publishes rather than a second, thinner description of it.
            item: { "@id": `${absoluteUrl(`/halls/${v.slug}`)}#venue` },
          })),
        }
      : undefined,
  });
}

/** Wraps nodes into one @graph document — one script tag per page. */
export function jsonLdGraph(...nodes: Record<string, unknown>[]) {
  return { "@context": "https://schema.org", "@graph": nodes };
}
