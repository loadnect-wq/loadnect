import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerHall, fetchHallAvailability } from "@/lib/owner";
import { AppHeader } from "@/components/app/AppHeader";
import { AvailabilityCalendar } from "./_components/AvailabilityCalendar";

export const metadata: Metadata = { title: "Manage Availability" };

type Props = { params: Promise<{ id: string }> };

// Build 45-day window
function buildDays(count = 45) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.now() + i * 86_400_000);
    return {
      iso:   d.toISOString().split("T")[0],
      label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      wkd:   d.toLocaleDateString("en-IN", { weekday: "short" }),
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

  const availability = await fetchHallAvailability(id, from, to);

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Availability" />

      <div className="px-4 py-5 sm:px-6 lg:px-8 max-w-3xl space-y-4">
        <div>
          <h1 className="font-serif text-xl font-bold text-charcoal-900">{hall.name}</h1>
          <p className="text-sm text-charcoal-500">
            Set availability for the next 45 days. Customers cannot book blocked or maintenance dates.
          </p>
        </div>

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
