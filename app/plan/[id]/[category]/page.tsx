// ─────────────────────────────────────────────────────────────────────────────
// /plan/<id>/<category> — one category of a plan. For the hall it also shows
// what the family has done with the chosen hall on Hallnect (enquiries, site
// visits, bookings) and the hall's own buttons, so the plan is the hub rather
// than a copy of things that live elsewhere.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { ItemForm } from "@/components/plan/ItemForm";
import { getSession, requireRole } from "@/lib/auth";
import { noindexMetadata } from "@/lib/seo/metadata";
import { fetchHallsResult } from "@/lib/halls";
import { primaryCtaHref, primaryCtaLabel } from "@/lib/booking-mode";
import { uuidSchema } from "@/lib/validation/schemas";
import { fetchPlan } from "@/lib/plan.server";
import { fetchHallActivity } from "@/lib/plan-hall.server";
import { PLAN_CATEGORIES, PLAN_CATEGORY_KEYS, type PlanCategory } from "@/lib/plan";

export const metadata: Metadata = noindexMetadata("My plan");

type Props = { params: Promise<{ id: string; category: string }> };

const asText = (n: number | null) => (n == null ? "" : String(n));

export default async function PlanItemPage({ params }: Props) {
  const { id, category } = await params;
  if (!uuidSchema.safeParse(id).success || !PLAN_CATEGORY_KEYS.includes(category as PlanCategory)) notFound();
  if (!(await getSession())) redirect(`/login?next=/plan/${id}/${category}`);
  const profile = await requireRole(["customer"]);

  const loaded = await fetchPlan(id);
  if (!loaded.ok && loaded.reason === "not_found") notFound();
  const meta = PLAN_CATEGORIES.find((c) => c.key === category)!;
  if (!loaded.ok) {
    return (
      <div className="min-h-screen bg-ivory-100">
        <AppHeader title={meta.label} showBack />
        <div className="container-app max-w-xl py-6">
          <EmptyState icon={<ClipboardList className="h-8 w-8" />} title="We couldn't load this plan" description="Please try again in a minute." />
        </div>
      </div>
    );
  }
  const { plan, items } = loaded;
  const item = items.find((i) => i.category === category);
  if (!item) notFound();

  const isHall = category === "hall";
  const hallRead = isHall && item.hallId ? await fetchHallsResult({ ids: [item.hallId] }) : null;
  const hall = hallRead && !hallRead.failed ? (hallRead.halls[0] ?? null) : null;
  const activity = isHall && item.hallId ? await fetchHallActivity(profile.id, item.hallId) : [];

  const findHalls = new URLSearchParams();
  if (plan.eventDate) findHalls.set("date", plan.eventDate);
  if (plan.city) findHalls.set("city", plan.city);

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title={meta.label} showBack />
      <section className="container-app max-w-xl space-y-4 py-5">
        <div>
          <Link href={`/plan/${plan.id}`} className="text-xs font-semibold text-maroon-700 hover:underline">{plan.title}</Link>
          <h1 className="mt-0.5 font-serif text-2xl font-bold text-charcoal-900">{meta.label}</h1>
          <p className="text-sm text-charcoal-700">{meta.hint}</p>
        </div>

        {hall && (
          <div className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
            <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">Your chosen hall</p>
            <Link href={`/halls/${hall.slug}`} className="mt-0.5 block font-semibold text-charcoal-900 hover:text-maroon-700">{hall.name}</Link>
            <p className="text-sm text-charcoal-700">{hall.city}</p>
            {activity.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                {activity.map((a) => (
                  <li key={a.key} className="flex items-center justify-between gap-3 text-sm">
                    <Link href={a.href} className="min-w-0 truncate text-charcoal-800 hover:text-maroon-700">{a.text}</Link>
                    <span className="shrink-0 rounded-full bg-ivory-200 px-2 py-0.5 text-[11px] font-semibold text-charcoal-700">{a.status}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link href={`/visit/${hall.slug}`} className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-maroon-200 text-sm font-semibold text-maroon-700 hover:bg-maroon-50">
                Visit the hall
              </Link>
              <Link href={primaryCtaHref(hall.booking_mode, hall.slug)} className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-maroon-700 text-sm font-semibold text-white hover:bg-maroon-800">
                {primaryCtaLabel(hall.booking_mode)}
              </Link>
            </div>
          </div>
        )}

        <ItemForm
          planId={plan.id}
          category={category}
          chosenHall={hall ? { id: hall.id, name: hall.name, city: hall.city, price: hall.price_per_day } : null}
          guests={plan.guests}
          findHallsHref={`/halls${findHalls.size ? `?${findHalls}` : ""}`}
          initial={{
            status: item.status,
            hallId: item.hallId ?? "",
            vendorName: item.vendorName ?? "",
            vendorPhone: item.vendorPhone ?? "",
            notes: item.notes ?? "",
            plannedAmount: asText(item.plannedAmount),
            quotedAmount: asText(item.quotedAmount),
            paidAmount: asText(item.paidAmount),
            nextDueDate: item.nextDueDate ?? "",
            nextDueAmount: asText(item.nextDueAmount),
          }}
        />
      </section>
    </div>
  );
}
