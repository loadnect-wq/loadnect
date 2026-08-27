import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchHallBySlug, fetchSimilarHalls } from "@/lib/halls";
import { getAdvancePercent } from "@/lib/platform-settings";
import { HallDetailView } from "./_components/HallDetailView";
import { AdSlot } from "@/components/ads/AdSlot";
import { buildMetadata, noindexMetadata } from "@/lib/seo/metadata";
import { venueTitle, venueDescription, venueImageAlt } from "@/lib/seo/venue";
import { JsonLd } from "@/components/seo/JsonLd";
import { jsonLdGraph, venueJsonLd, breadcrumbJsonLd } from "@/lib/seo/jsonld";
import { citySlug } from "@/lib/seo/cities";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const hall = await fetchHallBySlug(slug);

  // A missing hall 404s in the page body; returning bare metadata here kept the
  // route title-less. An owner/admin previewing an UNAPPROVED hall reaches this
  // page legitimately, so it must be explicitly noindex — a draft venue must
  // never enter the index.
  if (!hall) return noindexMetadata("Venue not found");
  if (hall.status !== "approved") return noindexMetadata(`${hall.name} (preview)`);

  const coverImg = hall.images.find((i) => i.is_cover) ?? hall.images[0];

  return buildMetadata({
    title: venueTitle(hall),
    description: venueDescription(hall),
    path: `/halls/${hall.slug}`,
    images: coverImg
      ? [{ url: coverImg.url, alt: venueImageAlt(hall, 0, coverImg.alt_text) }]
      : undefined,
  });
}

export default async function HallDetailPage({ params }: Props) {
  const { slug } = await params;

  // fetchHallBySlug uses the session-aware Supabase client.
  // RLS automatically enforces:
  //   - public/unauthenticated: only status='approved' halls returned
  //   - hall owner: their own hall any status
  //   - admin: any hall
  // If the hall doesn't exist OR the caller lacks permission → null → 404.
  const hall = await fetchHallBySlug(slug);
  if (!hall) notFound();

  const similar = await fetchSimilarHalls(hall.id, hall.city);
  const advancePercent = await getAdvancePercent();

  // isPreview is true only when an owner/admin fetched a non-approved hall.
  // Public users can never reach this point with a non-approved hall (RLS → 404).
  const isPreview = hall.status !== "approved";

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
      advancePercent={advancePercent}
      similar={similar}
      isPreview={isPreview}
        sidebarAd={<AdSlot placement="hall_detail_sidebar" limit={1} variant="card" />}
      />
    </>
  );
}
