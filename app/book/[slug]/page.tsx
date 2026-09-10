import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { noindexMetadata } from "@/lib/seo/metadata";
import { getSession } from "@/lib/auth";
import { fetchHallBySlug } from "@/lib/halls";
import { isLeadGeneration, hasPrice } from "@/lib/booking-mode";
import { fetchHallAvailabilityWindow } from "@/lib/availability";
import { isOnlinePaymentEnabled, getAdvancePercent } from "@/lib/platform-settings";
import { todayInBusinessTz, addDaysToIsoDate } from "@/lib/dates";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { BookingFlow } from "./_components/BookingFlow";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const hall = await fetchHallBySlug(slug);
  // SEO: the checkout wizard is transactional and auth-gated — never indexed.
  // The public, indexable page for this venue is /halls/[slug].
  return noindexMetadata(hall ? `Book ${hall.name}` : "Book Hall");
}

const BOOKING_WINDOW_DAYS = 60;

export default async function BookPage({ params }: Props) {
  const { slug } = await params;

  // Auth required to book
  const user = await getSession();
  if (!user) redirect(`/login?next=/book/${slug}`);

  // Real DB fetch — RLS ensures only approved halls are bookable by customers
  const hall = await fetchHallBySlug(slug);
  if (!hall || hall.status !== "approved") notFound();

  // A LEAD VENUE HAS NO CHECKOUT. Hallnect collects nothing for it, holds no
  // date and may not even know its price — so this route is not merely
  // inappropriate for one, it cannot be completed. The redirect is a
  // convenience for a stale link or a bookmarked URL; the real gate is on the
  // server actions (createBookingRequest resolves the hall itself), because a
  // page redirect protects nobody who posts to the action directly.
  if (isLeadGeneration(hall.booking_mode)) redirect(`/enquiry/${slug}`);

  // A direct-booking hall ALWAYS has a price — halls_direct_booking_needs_price
  // (migration 0073) makes a null one impossible at the database level. If one
  // arrives anyway the constraint has been dropped or bypassed, and the honest
  // response is to refuse rather than to let advanceFromTotal throw a
  // RangeError onto a customer's checkout screen.
  if (!hasPrice(hall.price_per_day)) {
    console.error(`[book] direct-booking hall ${hall.id} has no price_per_day`);
    notFound();
  }

  // Pull authoritative availability for the next 60 days
  // Business-timezone window: UTC-derived bounds were one day behind IST.
  const today = todayInBusinessTz();
  const end   = addDaysToIsoDate(today, BOOKING_WINDOW_DAYS - 1);
  const availability = await fetchHallAvailabilityWindow(hall.id, today, end);
  // The commission rate is deliberately NOT sent to the browser: it is an
  // internal figure between Hallnect and the venue, never a customer line item.

  // Cashfree is optional, AND an admin can switch online payment off. When
  // either is false the booking flow runs in manual "submit booking request"
  // mode instead of taking money.
  const onlinePaymentEnabled = await isOnlinePaymentEnabled();
  // The live advance %, so the figure previewed here is the figure charged.
  const advancePercent = await getAdvancePercent();

  // Prefill the customer's saved phone so they don't retype it (§ don't ask
  // repeatedly). Still editable; the server re-validates whatever is submitted.
  let initialPhone: string | null = null;
  try {
    const supabase = await getSupabaseServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: prof } = await (supabase as any)
      .from("profiles").select("phone").eq("id", user.id).maybeSingle();
    initialPhone = prof?.phone ?? null;
  } catch { /* prefill is convenience only */ }

  return (
    <BookingFlow
      hall={{
        id:            hall.id,
        slug:          hall.slug,
        name:          hall.name,
        city:          hall.city,
        capacity_max:  hall.capacity_max,
        price_per_day: hall.price_per_day,
        price_morning: hall.price_morning,
        price_evening: hall.price_evening,
      }}
      availability={availability}
      windowDays={BOOKING_WINDOW_DAYS}
      onlinePaymentEnabled={onlinePaymentEnabled}
      advancePercent={advancePercent}
      initialPhone={initialPhone}
    />
  );
}
