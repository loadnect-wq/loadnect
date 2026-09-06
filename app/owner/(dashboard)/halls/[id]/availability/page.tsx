import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerHall, fetchHallAvailability } from "@/lib/owner";
import { fetchOfflineBookings } from "@/lib/offline-bookings";
import { todayInBusinessTz, addDaysToIsoDate } from "@/lib/dates";
import { AppHeader } from "@/components/app/AppHeader";
import { AvailabilityCalendar } from "./_components/AvailabilityCalendar";
import { OfflineBookings } from "./_components/OfflineBookings";

export const metadata: Metadata = { title: "Manage Availability" };

type Props = { params: Promise<{ id: string }> };

// Build a 45-day window, IN THE BUSINESS TIMEZONE.
//
// This used to take `iso` from d.toISOString() while taking the visible label
// from toLocaleDateString("en-IN"). Those two disagree for five and a half hours
// every day: India is UTC+05:30, so between 00:00 and 05:30 IST the UTC date is
// still yesterday. An owner blocking "15 Oct" in that window wrote 14 Oct — they
// blocked the wrong day and left the real one on sale. This is the exact bug
// lib/dates.ts was written to eliminate, and its header says so.
//
// Both the value and the label now come from the same IST-resolved date.
function buildDays(count = 45) {
  const today = todayInBusinessTz();
  return Array.from({ length: count }, (_, i) => {
    const iso = addDaysToIsoDate(today, i);
    // Parsed as UTC midnight purely for FORMATTING, with timeZone:"UTC" so the
    // weekday and day-of-month printed are the ones in the string — never
    // shifted back into another calendar day by the server's own timezone.
    const d = new Date(`${iso}T00:00:00Z`);
    return {
      iso,
      label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }),
      wkd:   d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }),
    };
  });
}

const SLOTS = ["morning", "evening", "full_day"];

export default async function AvailabilityPage({ params }: Props) {
  await requireRole(["owner_approved"]);
  const { id } = await params;

  const hall = await fetchOwnerHall(id);
  if (!hall) notFound();

  const days = buildDays();
  const from = days[0].iso;
  const to   = days[days.length - 1].iso;

  const [availability, offline] = await Promise.all([
    fetchHallAvailability(id, from, to),
    fetchOfflineBookings(id),
  ]);

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Availability" notificationsHref="/owner/notifications" />

      <div className="px-4 py-5 sm:px-6 lg:px-8 max-w-3xl space-y-4">
        <div>
          <h1 className="font-serif text-xl font-bold text-charcoal-900">{hall.name}</h1>
          <p className="text-sm text-charcoal-500">
            Set availability for the next 45 days. Customers cannot book blocked or maintenance dates.
          </p>
        </div>

        <OfflineBookings hallId={id} rows={offline} />

        <AvailabilityCalendar
          hallId={id}
          days={days}
          slots={SLOTS}
          initial={availability}
        />

        <Link
          href={`/owner/halls/${id}/edit`}
          className="flex items-center gap-1 text-sm text-charcoal-500 hover:text-charcoal-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back to edit
        </Link>
      </div>
    </div>
  );
}
