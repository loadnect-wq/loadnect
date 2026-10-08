// ─────────────────────────────────────────────────────────────────────────────
// The venue page body, shared by the two routes that show a hall:
//
//   /halls/[slug]          the public page — cached (ISR), approved halls only,
//                          read through the cookie-free client;
//   /halls/[slug]/preview  an owner's or admin's look at a hall that is not live
//                          yet — rendered per request with their session, noindex.
//
// One body, so a preview is exactly what the public page will be.
// ─────────────────────────────────────────────────────────────────────────────

import type { HallDetail } from "@/lib/halls";
import { fetchSimilarHalls } from "@/lib/halls";
import { getAdvancePercent } from "@/lib/platform-settings";
import { HallDetailView } from "./HallDetailView";
import { AdSlot } from "@/components/ads/AdSlot";
import { JsonLd } from "@/components/seo/JsonLd";
import { jsonLdGraph, venueJsonLd, breadcrumbJsonLd } from "@/lib/seo/jsonld";
import { citySlug } from "@/lib/seo/cities";
import { fetchVenueCategories } from "@/lib/venue-categories.server";
import { selectCategories } from "@/lib/venue-categories";

export async function VenuePage({ hall, isPreview }: { hall: HallDetail; isPreview: boolean }) {
  // Together, not one after the other. Only fetchSimilarHalls needs the hall;
  // getAdvancePercent needs nothing, and awaiting it second added a whole
  // Mumbai-to-Sydney round trip to the page a customer books from. All three
  // read cookie-free, so they never make the public page dynamic.
  const [similar, advancePercent, catalogue] = await Promise.all([
    fetchSimilarHalls(hall.id, hall.city),
    getAdvancePercent(),
    // LENIENT. If the catalogue cannot be read, this venue's "Suitable for"
    // chips and its one-line summary of what it hosts are simply absent. Every
    // other fact on the page — price, capacity, photos, availability, the
    // booking button — is unaffected, so failing the whole venue page over a
    // decorative strip would be the worse trade.
    fetchVenueCategories(),
  ]);

  // Resolved HERE, on the server, and only this hall's few rows cross to the
  // client. See venueCategoriesSentence for why the whole catalogue does not.
  const hallCategories = selectCategories(hall.venue_types, catalogue);

  return (
    <>
      {/* EventVenue + breadcrumbs, from real columns only. Emitted ONLY for a
          publicly approved hall: a preview of a draft venue must not publish
          structured data about a listing the public cannot see. */}
      {!isPreview && (
        <JsonLd
          data={jsonLdGraph(
            venueJsonLd({
              name: hall.name,
              slug: hall.slug,
              description: hall.description,
              city: hall.city,
              state: hall.state,
              address: hall.address,
              pincode: hall.pincode,
              latitude: hall.latitude,
              longitude: hall.longitude,
              capacityMax: hall.capacity_max,
              pricePerDay: hall.price_per_day,
              ratingAverage: hall.rating_average,
              ratingCount: hall.rating_count,
              images: hall.images.map((i) => ({ url: i.url, alt: i.alt_text })),
              amenities: [
                ...hall.amenities.map((a) => a.name),
                ...hall.custom_amenities,
              ],
              venueTypes: hallCategories.map((c) => c.name),
            }),
            breadcrumbJsonLd([
              { name: "Home", path: "/" },
              { name: "Tamil Nadu", path: "/halls" },
              { name: hall.city, path: `/wedding-halls/${citySlug(hall.city)}` },
              { name: hall.name, path: `/halls/${hall.slug}` },
            ]),
          )}
        />
      )}
      <HallDetailView
        hall={hall}
        citySlug={citySlug(hall.city)}
        advancePercent={advancePercent}
        categories={hallCategories}
        similar={similar}
        isPreview={isPreview}
        sidebarAd={<AdSlot placement="hall_detail_sidebar" limit={1} variant="card" />}
      />
    </>
  );
}
