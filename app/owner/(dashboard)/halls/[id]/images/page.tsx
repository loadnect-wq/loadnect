import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerHall, fetchHallImages } from "@/lib/owner";
import { AppHeader } from "@/components/app/AppHeader";
import { ImagesManager } from "./_components/ImagesManager";

export const metadata: Metadata = { title: "Hall Images" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ failed?: string; of?: string; submitted?: string }>;
};

export default async function HallImagesPage({ params, searchParams }: Props) {
  await requireRole(["owner_approved"]);
  const { id } = await params;
  const sp = await searchParams;
  const failedCount = Number.parseInt(sp.failed ?? "", 10);
  const ofCount     = Number.parseInt(sp.of ?? "", 10);
  const justSubmitted = sp.submitted === "1";

  const [hall, images] = await Promise.all([
    fetchOwnerHall(id),
    fetchHallImages(id),
  ]);

  // Null if not found OR doesn't belong to this owner (fetchOwnerHall filters
  // on owner_id — RLS alone would also match any APPROVED hall).
  if (!hall) notFound();

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Hall Images" />

      <div className="px-4 py-5 sm:px-6 lg:px-8 max-w-2xl space-y-4">

        {/* Carried from the Add Hall form, which unmounts on navigation. */}
        {Number.isFinite(failedCount) && failedCount > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-semibold">
              {failedCount} of {Number.isFinite(ofCount) ? ofCount : failedCount} photo(s) didn&apos;t upload
            </p>
            <p className="mt-0.5 text-xs">
              Your hall was submitted, but these photos were not saved. Add them below.
            </p>
          </div>
        )}

        {justSubmitted && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <p className="font-semibold">Hall submitted for verification</p>
            <p className="mt-0.5 text-xs">
              Our team will review your hall and photos. It stays private until approved.
            </p>
          </div>
        )}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-serif text-xl font-bold text-charcoal-900">{hall.name}</h1>
            <p className="text-sm text-charcoal-500">{hall.city}</p>
          </div>
          <Link
            href={`/owner/halls/${id}/edit`}
            className="text-xs font-semibold text-maroon-600 hover:underline"
          >
            Edit details
          </Link>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-start gap-2">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-blue-600" />
          <p className="text-xs text-blue-800">
            Upload up to 10 images. The <strong>cover image</strong> is shown on search cards.
            Click ⭐ on any image to make it the cover.
          </p>
        </div>

        <ImagesManager hallId={id} initial={images} />

        <Link
          href="/owner/halls"
          className="flex items-center gap-1 text-sm text-charcoal-500 hover:text-charcoal-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back to halls
        </Link>
      </div>
    </div>
  );
}
