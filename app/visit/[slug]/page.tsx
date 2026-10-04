// ─────────────────────────────────────────────────────────────────────────────
// /visit/<slug> — ask to see a hall before deciding. Any approved hall, either
// booking mode. Signed in, with a verified phone: that number is what the hall
// gets, and an unverified one never reaches a venue (see 0109).
//
// One upcoming request per family and hall. If one exists, this page shows it
// instead of the form; changing the day means cancelling it first.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MapPin, ShieldCheck } from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { getSession } from "@/lib/auth";
import { fetchHallBySlug } from "@/lib/halls";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { addDaysToIsoDate, todayInBusinessTz } from "@/lib/dates";
import { noindexMetadata } from "@/lib/seo/metadata";
import { maskPhone } from "@/lib/notifications/phone";
import { fetchVisitsForCustomer } from "@/lib/site-visits.server";
import { VISIT_HORIZON_DAYS, VISIT_STATE_LABEL, visitState, visitWhen } from "@/lib/site-visits";
import { VisitForm } from "./_components/VisitForm";

export const metadata: Metadata = noindexMetadata("Visit the hall");

type Props = { params: Promise<{ slug: string }> };

export default async function VisitPage({ params }: Props) {
  const { slug } = await params;
  const hall = await fetchHallBySlug(slug);
  if (!hall || hall.status !== "approved") notFound();

  const user = await getSession();
  if (!user) redirect(`/login?next=/visit/${slug}`);

  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase as any)
    .from("profiles").select("role, full_name, phone, phone_verified").eq("id", user.id).maybeSingle();
  const isCustomer = profile?.role === "customer";
  const verified = Boolean(profile?.phone_verified && profile?.phone);

  const today = todayInBusinessTz();
  const visits = isCustomer && verified ? await fetchVisitsForCustomer(user.id) : [];
  const existing = (visits ?? []).find(
    (v) => v.hallId === hall.id && (v.status === "requested" || v.status === "confirmed") && v.visitDate >= today,
  );

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Visit the hall" showBack />
      <section className="container-app max-w-xl py-5">
        <h1 className="font-serif text-2xl font-bold text-charcoal-900">See {hall.name} before you decide</h1>
        <p className="mt-1 flex items-start gap-1.5 text-sm text-charcoal-700">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-maroon-700" aria-hidden />
          {hall.address ? `${hall.address}, ${hall.city}` : hall.city}
        </p>
        <p className="mt-2 text-sm text-charcoal-700">
          Pick a day and a time of day. The hall confirms, and you go and see it. It costs nothing and holds no date.
        </p>

        <div className="mt-5">
          {!isCustomer ? (
            <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-border">
              <h2 className="text-base font-bold text-charcoal-900">Site visits are for customer accounts</h2>
              <p className="mt-1 text-sm text-charcoal-700">
                You are signed in as a venue owner or an admin. Sign in with a customer account to ask to visit a hall.
              </p>
            </div>
          ) : !verified ? (
            <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-border">
              <ShieldCheck className="h-7 w-7 text-green-700" aria-hidden />
              <h2 className="mt-2 text-base font-bold text-charcoal-900">Verify your phone number first</h2>
              <p className="mt-1 text-sm text-charcoal-700">
                The hall will call you to confirm the visit. We send a one-time code to make sure the number is yours.
              </p>
              <Link
                href={`/verify-phone?next=/visit/${slug}`}
                className="mt-4 inline-flex min-h-[44px] items-center rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800"
              >
                Verify my number
              </Link>
            </div>
          ) : existing ? (
            <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-border">
              <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">
                {VISIT_STATE_LABEL[visitState(existing.status, existing.visitDate, today)]}
              </p>
              <h2 className="mt-1 text-base font-bold text-charcoal-900">You&apos;ve asked to visit this hall</h2>
              <p className="mt-1 text-sm text-charcoal-700">{visitWhen(existing.visitDate, existing.visitWindow)}</p>
              {existing.ownerMessage && (
                <p className="mt-2 rounded-xl bg-ivory-100 px-3 py-2 text-sm text-charcoal-800">“{existing.ownerMessage}”</p>
              )}
              <Link
                href="/customer/visits"
                className="mt-4 inline-flex min-h-[44px] items-center rounded-xl border border-border px-4 text-sm font-semibold text-charcoal-800 hover:bg-ivory-100"
              >
                See or change it in My visits
              </Link>
            </div>
          ) : (
            <VisitForm
              hall={{ id: hall.id, name: hall.name, slug: hall.slug }}
              minDate={today}
              maxDate={addDaysToIsoDate(today, VISIT_HORIZON_DAYS)}
              initialName={profile?.full_name ?? ""}
              phoneDisplay={maskPhone(profile?.phone)}
            />
          )}
        </div>
      </section>
    </div>
  );
}
