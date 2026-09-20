import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { noindexMetadata } from "@/lib/seo/metadata";
import { getSession } from "@/lib/auth";
import { fetchHallBySlug } from "@/lib/halls";
import { isLeadGeneration } from "@/lib/booking-mode";
import { isOtpConfigured } from "@/lib/msg91";
import { todayInBusinessTz } from "@/lib/dates";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { EnquiryFlow } from "./_components/EnquiryFlow";
import { fetchVenueCategories } from "@/lib/venue-categories.server";
import { selectCategories } from "@/lib/venue-categories";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const hall = await fetchHallBySlug(slug);
  // Transactional and auth-gated, exactly like /book/[slug]. The indexable page
  // for this venue is /halls/[slug].
  return noindexMetadata(hall ? `Enquire about ${hall.name}` : "Send an enquiry");
}

export default async function EnquiryPage({ params }: Props) {
  const { slug } = await params;

  // SIGN-IN REQUIRED, matching /book. It is what ties the enquiry to a real
  // account, what lets the OTP ceilings in lib/otp-guard.ts count per-account
  // as well as per-number, and what makes `customer_id = auth.uid()` a
  // meaningful RLS clause on the leads table. An anonymous enquiry form would
  // be a free SMS-sending endpoint with a venue's phone number on the other
  // end of it.
  const user = await getSession();
  if (!user) redirect(`/login?next=/enquiry/${slug}`);

  const hall = await fetchHallBySlug(slug);
  if (!hall || hall.status !== "approved") notFound();

  // A DIRECT-BOOKING VENUE HAS NO ENQUIRY FLOW. Send them to checkout, which is
  // where that venue actually takes business. This redirect is a courtesy for a
  // stale link; createLeadEnquiry re-checks the mode server-side, so a client
  // posting straight to the action is refused there rather than here.
  if (!isLeadGeneration(hall.booking_mode)) redirect(`/book/${slug}`);

  // Prefill from the profile so the customer does not retype what we already
  // know. Both remain editable and the server re-validates whatever arrives —
  // and whatever they submit is stored ON THE LEAD rather than written back to
  // their profile.
  let initialName = "";
  let initialPhone = "";
  try {
    const supabase = await getSupabaseServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: prof } = await (supabase as any)
      .from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle();
    initialName = prof?.full_name ?? "";
    initialPhone = prof?.phone ?? "";
  } catch { /* prefill is convenience only */ }

  // The occasions offered — this venue's own declarations first, then the rest
  // of the catalogue, capped. Same reasoning as the booking flow: the venue's
  // list is the RELEVANT one, not a restriction, and an unreadable catalogue
  // removes an optional question rather than blocking a free enquiry.
  const catalogue = await fetchVenueCategories();
  const declared = selectCategories(hall.venue_types, catalogue);
  const declaredSlugs = new Set(declared.map((c) => c.slug));
  const eventOptions = [...declared, ...catalogue.filter((c) => !declaredSlugs.has(c.slug))]
    .slice(0, 8)
    .map((c) => ({ slug: c.slug, name: c.name }));

  return (
    <EnquiryFlow
      hall={{
        id: hall.id,
        slug: hall.slug,
        name: hall.name,
        city: hall.city,
        capacity_max: hall.capacity_max,
        price_per_day: hall.price_per_day,
      }}
      // IST, not UTC. A UTC-derived "today" is a day behind for most of the
      // Indian evening, which would let the date input offer yesterday and the
      // server reject it.
      minDate={todayInBusinessTz()}
      initialName={initialName}
      initialPhone={initialPhone}
      otpConfigured={isOtpConfigured()}
      eventOptions={eventOptions}
    />
  );
}
