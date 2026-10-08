import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { fetchHallBySlug } from "@/lib/halls";
import { noindexMetadata } from "@/lib/seo/metadata";
import { VenuePage } from "../_components/VenuePage";

// ─────────────────────────────────────────────────────────────────────────────
// An owner's or admin's preview of a hall that is not live yet.
//
// Split off the public venue page (/halls/[slug]) on 2026-10-08 so that page
// could be cached: this route reads the visitor's session, which is what lets
// RLS show a draft, pending, rejected or suspended hall to its owner and to the
// admins — and is exactly what a cached page cannot do.
//
// It is never indexed (noindex here, Disallow in robots.txt) and shows nobody
// anything RLS would not: a visitor who is neither the owner nor an admin gets
// a 404, as before. A hall that IS live is sent to its public page, so there is
// only ever one public URL for it.
// ─────────────────────────────────────────────────────────────────────────────

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return noindexMetadata("Venue preview");
}

export default async function HallPreviewPage({ params }: Props) {
  const { slug } = await params;

  // Session-aware: RLS returns a non-approved hall only to its owner or an admin.
  const hall = await fetchHallBySlug(slug);
  if (!hall) notFound();
  if (hall.status === "approved") redirect(`/halls/${hall.slug}`);

  return <VenuePage hall={hall} isPreview />;
}
