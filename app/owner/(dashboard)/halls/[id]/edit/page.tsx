import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerRow, fetchOwnerHall, fetchAllAmenities } from "@/lib/owner";
import { AppHeader } from "@/components/app/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { HallForm } from "../../_components/HallForm";
import { SubmitForApprovalButton } from "./_components/SubmitForApprovalButton";

export const metadata: Metadata = { title: "Edit Hall" };

type Props = { params: Promise<{ id: string }> };

const STATUS_CFG: Record<string, { label: string; variant: "success" | "warning" | "secondary" | "destructive" | "default" }> = {
  approved:         { label: "Live",      variant: "success"     },
  pending_approval: { label: "Pending",   variant: "warning"     },
  draft:            { label: "Draft",     variant: "secondary"   },
  rejected:         { label: "Rejected",  variant: "destructive" },
  suspended:        { label: "Suspended", variant: "destructive" },
};

export default async function EditHallPage({ params }: Props) {
  await requireRole(["owner_approved"]);
  const { id } = await params;

  const [ownerRow, hall, amenities] = await Promise.all([
    fetchOwnerRow(),
    fetchOwnerHall(id),
    fetchAllAmenities(),
  ]);

  // Hall not found OR belongs to a different owner (RLS returns null)
  if (!ownerRow || !hall) notFound();

  const cfg = STATUS_CFG[hall.status] ?? { label: hall.status, variant: "secondary" as const };

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Edit Hall" notificationsHref="/owner/notifications" />

      <div className="px-4 py-5 sm:px-6 lg:px-8 max-w-2xl space-y-4">
        {/* Hall meta header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-serif text-xl font-bold text-charcoal-900 leading-tight">{hall.name}</h1>
            <p className="text-sm text-charcoal-500 mt-0.5">{hall.city}{hall.state ? `, ${hall.state}` : ""}</p>
          </div>
          <Badge variant={cfg.variant}>{cfg.label}</Badge>
        </div>

        {/* Quick links row */}
        <div className="flex flex-wrap gap-2">
          <Link href={`/owner/halls/${id}/images`} className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-charcoal-600 hover:bg-ivory-100">
            📷 Images
          </Link>
          <Link href={`/owner/halls/${id}/availability`} className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-charcoal-600 hover:bg-ivory-100">
            📅 Availability
          </Link>
          {hall.status === "approved" && (
            <Link href={`/halls/${hall.slug}`} target="_blank" className="flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-charcoal-600 hover:bg-ivory-100">
              <ExternalLink className="h-3 w-3" /> Public Page
            </Link>
          )}
          {/* submitHallForApproval accepts draft | rejected | pending_approval.
              This used to render only for 'draft' — a status createHall never
              produces — so an owner whose hall was REJECTED could fix it and
              then had no way to send it back for review. */}
          {(hall.status === "draft" || hall.status === "rejected") && (
            <SubmitForApprovalButton hallId={id} />
          )}
        </div>

        {hall.status === "rejected" && (
          <div className="mb-4 rounded-2xl border-2 border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-900">This hall needs changes</p>
            {hall.rejection_reason ? (
              <p className="mt-1 text-xs leading-relaxed text-red-800">
                <span className="font-semibold">Reason from Hallnect:</span> {hall.rejection_reason}
              </p>
            ) : (
              <p className="mt-1 text-xs text-red-800">
                Contact Hallnect support if you are unsure what to change.
              </p>
            )}
            <p className="mt-2 text-xs text-red-700">
              Make your changes below, then use <strong>Submit for approval</strong> above to send it back for review.
            </p>
          </div>
        )}

        <HallForm ownerId={ownerRow.id} amenities={amenities} hall={hall} />

        <Link
          href="/owner/halls"
          className="flex items-center gap-1 text-sm text-charcoal-500 hover:text-charcoal-800 mt-2"
        >
          <ArrowLeft className="h-4 w-4" /> Back to halls
        </Link>
      </div>
    </div>
  );
}
