import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { fetchHallBySlug } from "@/lib/halls";
import { fetchHallAvailabilityWindow } from "@/lib/availability";
import { getCommissionPercent } from "@/lib/platform-settings";
import { isCashfreeConfigured } from "@/lib/cashfree";
import { BookingFlow } from "./_components/BookingFlow";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const hall = await fetchHallBySlug(slug);
  return { title: hall ? `Book ${hall.name}` : "Book Hall" };
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

  // Pull authoritative availability for the next 60 days
  const today = new Date().toISOString().split("T")[0];
  const end   = new Date(Date.now() + (BOOKING_WINDOW_DAYS - 1) * 86_400_000)
                  .toISOString().split("T")[0];
  const availability = await fetchHallAvailabilityWindow(hall.id, today, end);
  const platformFeePercent = await getCommissionPercent();

  // Cashfree is optional. When it's not configured the booking flow runs in
  // manual "submit booking request" mode instead of online payment.
  const onlinePaymentEnabled = isCashfreeConfigured();

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
      platformFeePercent={platformFeePercent}
      onlinePaymentEnabled={onlinePaymentEnabled}
    />
  );
}
