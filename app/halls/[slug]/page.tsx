import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchHallBySlug, fetchSimilarHalls } from "@/lib/halls";
import { HallDetailView } from "./_components/HallDetailView";
import { AdSlot } from "@/components/ads/AdSlot";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const hall = await fetchHallBySlug(slug);
  if (!hall || hall.status !== "approved") return {};
  const coverImg = hall.images.find((i) => i.is_cover) ?? hall.images[0];
  return {
    title: `${hall.name} — ${hall.city}`,
    description:
      `Book ${hall.name} in ${hall.city}${hall.state ? `, ${hall.state}` : ""}. ` +
      `Up to ${hall.capacity_max.toLocaleString("en-IN")} guests. From ₹${hall.price_per_day.toLocaleString("en-IN")}/day.`,
    openGraph: coverImg ? { images: [{ url: coverImg.url }] } : {},
  };
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

  // isPreview is true only when an owner/admin fetched a non-approved hall.
  // Public users can never reach this point with a non-approved hall (RLS → 404).
  const isPreview = hall.status !== "approved";

  return (
    <HallDetailView
      hall={hall}
      similar={similar}
      isPreview={isPreview}
      sidebarAd={<AdSlot placement="hall_detail_sidebar" limit={1} variant="card" />}
    />
  );
}
