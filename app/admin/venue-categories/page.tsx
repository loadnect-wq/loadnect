import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { fetchVenueCategoriesForAdmin } from "@/lib/venue-categories.server";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { CategoryManager } from "./_components/CategoryManager";

export const metadata: Metadata = { title: "Venue Categories — Admin" };

export default async function VenueCategoriesPage() {
  // ASSERTS ITS OWN ROLE. A layout and its page render CONCURRENTLY, so the
  // layout's redirect does not stop this page's queries being issued first —
  // the same reasoning as app/admin/hall-approvals/page.tsx.
  await requireRole(["admin"]);

  // Throws rather than returning []. On a management screen, "there are no
  // categories" and "the read failed" look identical, and the admin's next
  // move after the first one — create them all again — would be exactly wrong
  // against a catalogue that is actually fine.
  const rows = await fetchVenueCategoriesForAdmin();

  const active = rows.filter((r) => r.isActive).length;

  return (
    <div className="min-h-screen bg-ivory-100 pb-16">
      <AdminPageHeader
        title="Venue Categories"
        description={`${active} offered · ${rows.length - active} retired`}
      />

      <div className="px-4 py-5 sm:px-6 lg:px-8">
        <div className="mb-4 rounded-xl border border-border bg-white px-4 py-3">
          <p className="text-xs leading-relaxed text-charcoal-600">
            These are the occasions a venue can say it hosts. They drive the owner&apos;s listing form,
            the &ldquo;What are you planning?&rdquo; grid on the home page, the search chips and the
            <code className="mx-1">/venues/…</code> landing pages. Adding one here needs no release.
          </p>
        </div>

        <CategoryManager rows={rows} />
      </div>
    </div>
  );
}
