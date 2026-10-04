// /plan/new — start a plan. Signed-in customers only; a signed-out visitor is
// sent to sign in and brought straight back here.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/AppHeader";
import { PlanDetailsForm } from "@/components/plan/PlanDetailsForm";
import { getSession, requireRole } from "@/lib/auth";
import { noindexMetadata } from "@/lib/seo/metadata";
import { fetchVenueCategories } from "@/lib/venue-categories.server";

export const metadata: Metadata = noindexMetadata("Start a plan");

export default async function NewPlanPage() {
  if (!(await getSession())) redirect("/login?next=/plan/new");
  await requireRole(["customer"]);
  const catalogue = await fetchVenueCategories();

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Start a plan" showBack />
      <section className="container-app max-w-xl py-5">
        <h1 className="font-serif text-2xl font-bold text-charcoal-900">Start a plan</h1>
        <p className="mt-1 text-sm text-charcoal-700">
          The board and checklist are set up for the occasion you pick. You can change anything afterwards.
        </p>
        <div className="mt-4">
          <PlanDetailsForm
            occasions={catalogue.map((c) => ({ slug: c.slug, name: c.name }))}
            initial={{ title: "", occasion: catalogue.some((c) => c.slug === "wedding") ? "wedding" : "", eventDate: "", city: "", guests: "", budget: "" }}
          />
        </div>
      </section>
    </div>
  );
}
