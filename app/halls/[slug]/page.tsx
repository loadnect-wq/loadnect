import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchHallBySlug } from "@/lib/halls";
import { buildMetadata, noindexMetadata } from "@/lib/seo/metadata";
import { venueTitle, venueDescription, venueImageAlt } from "@/lib/seo/venue";
import { fetchIndexableVenues } from "@/lib/seo/sitemap-data";
import { VenuePage } from "./_components/VenuePage";

// ─────────────────────────────────────────────────────────────────────────────
// THE PUBLIC VENUE PAGE IS CACHED (2026-10-08).
//
// It used to read the visitor's session — only so that an owner or admin could
// preview a hall that was not live yet — which made every request a fresh
// render, and that cost the page four things the SEO audit found:
//   • Next streamed its title, description and canonical into the <body>, not
//     the <head>, for Googlebot and every AI crawler. Google ignores a body
//     canonical in the raw HTML; crawlers that run no JavaScript may miss the
//     title outright.
//   • A missing or removed venue answered HTTP 200 (a "soft 404"): the status
//     was committed before the page knew the hall did not exist.
//   • Most of the page's words arrived in hidden streamed blocks that only
//     JavaScript reveals.
//   • Cache-Control: no-store — every visit paid a round trip to the database.
//
// Now the page reads through the cookie-free client, approved halls only, and
// is rendered once and regenerated (ISR): metadata in the <head>, the whole
// page in the HTML, a real 404 for a hall that is missing or not live, and a
// cached response. The preview moved to /halls/[slug]/preview, which keeps the
// session. Hall edits, approvals and photo changes refresh it at once
// (revalidateVenuePages); otherwise it is at most five minutes old.
// ─────────────────────────────────────────────────────────────────────────────

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 300;

/**
 * Every live venue is rendered at build. A hall approved later renders on its
 * first visit (dynamicParams stays on). A failed read here just means nothing
 * is pre-rendered — never a failed build.
 */
export async function generateStaticParams() {
  try {
    return (await fetchIndexableVenues()).map((v) => ({ slug: v.slug }));
  } catch {
    return [];
  }
}

/** One read per render, shared by generateMetadata and the page. */
const getLiveHall = cache((slug: string) => fetchHallBySlug(slug, { publicOnly: true }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const hall = await getLiveHall(slug);

  // Missing, or not live: the page below answers 404. The noindex is a second
  // line, not the mechanism.
  if (!hall) return noindexMetadata("Venue not found");

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

  // Approved halls only (fetchHallBySlug publicOnly). A hall that does not
  // exist, or exists but is not live — draft, pending, rejected, suspended —
  // is a 404 here. Its owner and the admins see it at /halls/[slug]/preview.
  const hall = await getLiveHall(slug);
  if (!hall) notFound();

  return <VenuePage hall={hall} isPreview={false} />;
}
