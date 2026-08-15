import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, ChevronRight, Clock, MapPin } from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";

export const metadata: Metadata = { title: "My Bookings" };

// Mock — would come from DB once integrated
const MOCK_BOOKINGS: {
  id: string;
  hallName: string;
  city: string;
  date: string;
  slot: string;
  status: "pending" | "confirmed" | "completed";
  total: string;
}[] = [];

const STATUS_STYLES: Record<string, string> = {
  pending:   "bg-amber-50 text-amber-700",
  confirmed: "bg-green-50 text-green-700",
  completed: "bg-charcoal-100 text-charcoal-700",
};

export default function BookingsPage() {
  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="My Bookings" />

      {/* Tabs */}
      <div className="container-app pt-3">
        <div className="flex rounded-2xl bg-ivory-200 p-1 text-xs font-semibold">
          {["Upcoming", "Pending", "Past"].map((t, i) => (
            <button
              key={t}
              className={
                "flex-1 rounded-xl py-2 " +
                (i === 0 ? "bg-white text-maroon-700 shadow-card" : "text-charcoal-600")
              }
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <section className="container-app py-5">
        {MOCK_BOOKINGS.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck className="h-8 w-8" />}
            title="No bookings yet"
            description="Find a venue and your bookings will appear here."
            action={
              <Link href="/halls" className={buttonVariants({ variant: "gold", size: "sm" })}>
                Browse Halls
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {MOCK_BOOKINGS.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/bookings/${b.id}`}
                  className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card active:scale-[0.99]"
                >
                  <div className="h-14 w-14 rounded-xl bg-maroon-50" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 font-serif text-sm font-semibold text-charcoal-900">{b.hallName}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-charcoal-500">
                      <MapPin className="h-3 w-3" /> {b.city}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-charcoal-500">
                      <Clock className="h-3 w-3" /> {b.date} · {b.slot}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold uppercase " + STATUS_STYLES[b.status]}>
                      {b.status}
                    </span>
                    <ChevronRight className="h-4 w-4 text-charcoal-400" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
