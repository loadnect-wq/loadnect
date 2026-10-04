// /plan/<id>/edit — change the plan's details, or delete it. Editors change
// the details; only the owner deletes. A viewer is sent back to the plan.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { PlanDetailsForm } from "@/components/plan/PlanDetailsForm";
import { DeletePlan } from "@/components/plan/DeletePlan";
import { getSession, requireRole } from "@/lib/auth";
import { noindexMetadata } from "@/lib/seo/metadata";
import { fetchVenueCategories } from "@/lib/venue-categories.server";
import { uuidSchema } from "@/lib/validation/schemas";
import { fetchPlan } from "@/lib/plan.server";
import { fetchPeople } from "@/lib/plan-family.server";

export const metadata: Metadata = noindexMetadata("Edit plan");

type Props = { params: Promise<{ id: string }> };

export default async function EditPlanPage({ params }: Props) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  if (!(await getSession())) redirect(`/login?next=/plan/${id}/edit`);
  const profile = await requireRole(["customer"]);

  const [loaded, catalogue] = await Promise.all([fetchPlan(id), fetchVenueCategories()]);
  if (!loaded.ok && loaded.reason === "not_found") notFound();
  const isOwner = loaded.ok && loaded.plan.ownerId === profile.id;
  if (loaded.ok && !isOwner) {
    const people = await fetchPeople(id);
    const role = people.ok ? people.people.find((p) => p.userId === profile.id)?.role : undefined;
    if (role !== "editor") redirect(`/plan/${id}`);
  }

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Edit plan" showBack />
      <section className="container-app max-w-xl space-y-4 py-5">
        {!loaded.ok ? (
          <EmptyState title="We couldn't load this plan" description="Please try again in a minute." />
        ) : (
          <>
            <h1 className="font-serif text-2xl font-bold text-charcoal-900">Edit the plan</h1>
            <PlanDetailsForm
              planId={loaded.plan.id}
              occasions={catalogue.map((c) => ({ slug: c.slug, name: c.name }))}
              initial={{
                title: loaded.plan.title,
                occasion: loaded.plan.occasion,
                eventDate: loaded.plan.eventDate ?? "",
                city: loaded.plan.city ?? "",
                guests: loaded.plan.guests == null ? "" : String(loaded.plan.guests),
                budget: loaded.plan.budget == null ? "" : String(loaded.plan.budget),
              }}
            />
            {isOwner && <DeletePlan planId={loaded.plan.id} />}
          </>
        )}
      </section>
    </div>
  );
}
