import type { Metadata } from "next";
import Link from "next/link";
import { IndianRupee, TrendingUp } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerRow, fetchOwnerHalls, fetchOwnerRevenue, fetchOwnerCommissions } from "@/lib/owner";
import { getCommissionPercent } from "@/lib/platform-settings";
import { formatPrice } from "@/lib/mock-data";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { AppHeader } from "@/components/app/AppHeader";

export const metadata: Metadata = { title: "Revenue" };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const SLOT_LABELS: Record<string, string> = {
  full_day: "Full Day",
  morning:  "Morning",
  evening:  "Evening",
};

export default async function OwnerRevenuePage() {
  await requireRole(["owner_approved"]);

  const ownerRow = await fetchOwnerRow();
  if (!ownerRow) {
    return (
      <div className="min-h-screen bg-ivory-100">
        <AppHeader title="Revenue" />
        <div className="px-4 py-8">
          <EmptyState
            icon={<IndianRupee className="h-8 w-8" />}
            title="No business profile"
            description="Complete your owner profile first."
            action={<Link href="/owner/profile" className={buttonVariants({ variant: "gold", size: "sm" })}>Complete Profile</Link>}
          />
        </div>
      </div>
    );
  }

  const halls         = await fetchOwnerHalls(ownerRow.id);
  const hallIds       = halls.map((h) => h.id);
  const [bookings, commissions, commissionPercent] = await Promise.all([
    fetchOwnerRevenue(hallIds),
    fetchOwnerCommissions(hallIds),
    getCommissionPercent(),
  ]);

  const totalBookingAmount = bookings.reduce((s, b) => s + b.total_amount, 0);
  const totalPayout        = bookings.reduce((s, b) => s + (b.payout_amount ?? 0), 0);
  const completedCount     = bookings.filter((b) => b.status === "completed").length;
  const confirmedCount     = bookings.filter((b) => b.status === "owner_confirmed").length;

  // Commission summary for the owner's own halls only.
  const totalCommissionPaid = commissions.reduce((s, c) => s + c.commission_amount, 0);

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Revenue" />

      <div className="px-4 py-5 sm:px-6 lg:px-8 space-y-5">

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="Total Bookings"  value={bookings.length.toString()} />
          <SummaryCard label="Completed"       value={completedCount.toString()} />
          <SummaryCard label="Booking Value"   value={formatPrice(totalBookingAmount)} wide />
          <SummaryCard label="Est. Payout"     value={totalPayout > 0 ? formatPrice(totalPayout) : "—"} wide highlight />
        </div>

        {/* Platform commission summary — only the owner sees their own halls' commissions */}
        <div className="rounded-2xl bg-white p-4 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
                Platform commission paid
              </p>
              <p className="mt-0.5 text-xl font-bold text-maroon-700">
                {totalCommissionPaid > 0 ? formatPrice(totalCommissionPaid) : "—"}
              </p>
            </div>
            <span className="rounded-full bg-maroon-50 px-2.5 py-1 text-[11px] font-semibold text-maroon-700">
              Current rate {commissionPercent}%
            </span>
          </div>
          <p className="mt-2 text-[11px] text-charcoal-500">
            Commission is recorded on successful payment, per booking. You only see your own halls.
          </p>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
          Hallnect&apos;s commission ({commissionPercent}% of the customer&apos;s advance) is retained
          from the advance — you are never billed separately, and the customer&apos;s ₹200 platform
          fee is never deducted from you. The venue balance is collected by you directly.
          {!ownerRow.payout_upi && (
            <> <Link href="/owner/profile" className="font-semibold underline">Add your UPI ID</Link> to receive payments.</>
          )}
        </div>

        {/* Bookings table */}
        {bookings.length === 0 ? (
          <EmptyState
            icon={<TrendingUp className="h-8 w-8" />}
            title="No revenue yet"
            description="Confirmed and completed bookings will appear here."
            size="sm"
          />
        ) : (
          <div className="space-y-2.5">
            <h2 className="font-serif text-sm font-semibold text-charcoal-900">Booking History</h2>
            {bookings.map((b) => (
              <div key={b.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-charcoal-900 truncate">{b.hall_name}</p>
                  <p className="text-xs text-charcoal-500">{fmtDate(b.event_date)} · {SLOT_LABELS[b.slot] ?? b.slot}</p>
                </div>
                <div className="shrink-0 text-right space-y-0.5">
                  <p className="text-sm font-bold text-charcoal-900">{formatPrice(b.total_amount)}</p>
                  {b.payout_amount != null && (
                    <p className="text-[11px] font-semibold text-emerald-700">Payout {formatPrice(b.payout_amount)}</p>
                  )}
                  <Badge
                    variant={b.status === "completed" ? "success" : "warning"}
                    size="sm"
                  >
                    {b.status === "completed" ? "Completed" : "Confirmed"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}

        {confirmedCount > 0 && (
          <p className="text-center text-xs text-charcoal-500">
            {confirmedCount} booking{confirmedCount !== 1 ? "s" : ""} confirmed — mark them complete after the event.
          </p>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label, value, highlight = false, wide = false,
}: {
  label: string; value: string; highlight?: boolean; wide?: boolean;
}) {
  return (
    <div className={[
      "rounded-2xl bg-white p-4 shadow-card",
      highlight ? "ring-2 ring-emerald-300" : "",
      wide ? "col-span-2 sm:col-span-1" : "",
    ].join(" ")}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-charcoal-900">{value}</p>
    </div>
  );
}
