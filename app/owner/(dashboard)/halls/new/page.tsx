import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerRow, fetchAllAmenities } from "@/lib/owner";
import { AppHeader } from "@/components/app/AppHeader";
import { HallForm } from "../_components/HallForm";

export const metadata: Metadata = { title: "Add Hall" };

export default async function NewHallPage() {
  await requireRole(["owner_approved"]);
  const ownerRow = await fetchOwnerRow();

  if (!ownerRow) {
    redirect("/owner/profile");
  }

  const amenities = await fetchAllAmenities();

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Add Hall" />

      <div className="px-4 py-5 sm:px-6 lg:px-8 max-w-2xl space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
          <p className="text-xs text-amber-800">
            New halls are submitted for admin approval. Once approved, they will appear in search results.
          </p>
        </div>

        <HallForm ownerId={ownerRow.id} amenities={amenities} />

        <p className="text-center text-xs text-charcoal-500">
          Already have halls?{" "}
          <Link href="/owner/halls" className="font-semibold text-maroon-600 hover:underline">
            View my halls
          </Link>
        </p>
      </div>
    </div>
  );
}
