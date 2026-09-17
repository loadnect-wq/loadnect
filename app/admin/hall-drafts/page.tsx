import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Inbox, Phone, Mail, CheckCircle2, XCircle, Clock } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchAdminHallDrafts } from "@/lib/admin-hall-drafts";
import { fetchAllAmenities } from "@/lib/owner";
import { formatHallPrice } from "@/lib/booking-mode";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { AddHallDraftForm } from "./_components/AddHallDraftForm";
import { CancelDraftButton } from "./_components/CancelDraftButton";
import { DraftPhotosManager } from "./_components/DraftPhotosManager";

export const metadata: Metadata = { title: "Add a Hall — Admin" };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_STYLE: Record<string, string> = {
  unclaimed: "border-amber-200 bg-amber-50 text-amber-800",
  claimed:   "border-emerald-200 bg-emerald-50 text-emerald-800",
  cancelled: "border-charcoal-200 bg-charcoal-50 text-charcoal-600",
};

export default async function HallDraftsPage() {
  // ASSERTS ITS OWN ROLE — a layout and its page render CONCURRENTLY, so the
  // layout's redirect does not stop this page's queries being issued first.
  // Same reasoning as app/admin/hall-approvals/page.tsx.
  await requireRole(["admin"]);

  // One round trip each, in parallel — the amenity catalogue is 12 rows and
  // the form needs it to offer anything at all.
  const [{ drafts, failed }, amenities] = await Promise.all([
    fetchAdminHallDrafts(),
    fetchAllAmenities(),
  ]);
  const unclaimed = drafts.filter((d) => d.claimStatus === "unclaimed");
  const settled   = drafts.filter((d) => d.claimStatus !== "unclaimed");

  return (
    <div>
      <AdminPageHeader
        title="Add a Hall"
        description="Record a venue before its owner has a Hallnect account. They claim it when they register with the same mobile number."
      />

      <div className="space-y-6 px-4 py-5 sm:px-6 lg:px-8">
        <AddHallDraftForm amenities={amenities} />

        {/* A FAILED READ IS NOT AN EMPTY LIST. Telling an admin there are no
            drafts when the query never ran is the defect this project keeps
            finding; the two states get different words. */}
        {failed && (
          <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <p className="font-semibold">We could not load the saved listings.</p>
            <p className="mt-1 text-xs">
              This is not a sign that none exist. Reload the page, or try again shortly.
            </p>
          </div>
        )}

        <section>
          <h2 className="mb-3 font-serif text-sm font-semibold text-charcoal-900">
            Waiting to be claimed{unclaimed.length > 0 ? ` (${unclaimed.length})` : ""}
          </h2>

          {!failed && unclaimed.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-8 w-8" />}
              title="No listings waiting"
              description="Venues you add here appear until their owner registers and claims them."
              size="sm"
            />
          ) : (
            <ul className="space-y-3">
              {unclaimed.map((d) => (
                <li key={d.id} className="rounded-2xl border border-border bg-white p-4 shadow-card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-serif text-base font-semibold text-charcoal-900">{d.name}</p>
                      <p className="mt-0.5 text-xs text-charcoal-500">
                        {d.city}
                        {d.address ? ` · ${d.address}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-charcoal-600">
                        Up to {d.capacityMax.toLocaleString("en-IN")} guests ·{" "}
                        {formatHallPrice(d.pricePerDay)} ·{" "}
                        {d.bookingMode === "LEAD_GENERATION" ? "Enquiries" : "Direct booking"}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE.unclaimed}`}>
                      <Clock className="mr-1 inline h-3 w-3" aria-hidden />
                      Unclaimed
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-charcoal-700">
                    <span className="font-medium">{d.ownerName}</span>
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3 text-maroon-500" aria-hidden />
                      {d.ownerPhone}
                    </span>
                    {d.ownerEmail && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3 text-maroon-500" aria-hidden />
                        {d.ownerEmail}
                      </span>
                    )}
                    <span className="text-charcoal-400">added {fmtDate(d.createdAt)}</span>
                  </div>

                  {/* The matching rule, stated where the consequence lands. An
                      admin who mistypes the number creates a listing nobody can
                      ever claim, and nothing else on this screen would say so. */}
                  <p className="mt-2 text-[11px] leading-relaxed text-charcoal-500">
                    Claimable only by someone who signs in and verifies this exact mobile number.
                  </p>

                  {/* Not keyed by the photo list: a partly failed save refreshes
                      the page, and a remount would throw away the failed photos
                      and their reasons. The panel's own state already matches
                      what was saved. */}
                  <DraftPhotosManager
                    draftId={d.id}
                    hallName={d.name}
                    photoUrls={d.photoUrls}
                  />

                  <div className="mt-3">
                    <CancelDraftButton draftId={d.id} hallName={d.name} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {settled.length > 0 && (
          <section>
            <h2 className="mb-3 font-serif text-sm font-semibold text-charcoal-900">
              Claimed and withdrawn
            </h2>
            <ul className="space-y-2">
              {settled.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-white px-4 py-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-charcoal-900">{d.name}</span>
                    <span className="text-charcoal-500"> · {d.city}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[d.claimStatus]}`}>
                      {d.claimStatus === "claimed" ? (
                        <><CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden />Claimed {d.claimedAt ? fmtDate(d.claimedAt) : ""}</>
                      ) : (
                        <><XCircle className="mr-1 inline h-3 w-3" aria-hidden />Withdrawn</>
                      )}
                    </span>
                    {d.claimedHallId && (
                      <Link
                        href={`/admin/halls?q=${encodeURIComponent(d.name)}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-maroon-600 hover:underline"
                      >
                        <Building2 className="h-3 w-3" aria-hidden />
                        View listing
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
