import type { Metadata } from "next";
import Link from "next/link";
import { Wallet, CheckCircle2, Receipt, Info } from "lucide-react";
import { requireRole } from "@/lib/auth";
import {
  fetchOwnerRow, fetchOwnerHalls, fetchOwnerCommissions,
  fetchOwnerSettlementAdjustments,
  type OwnerCommissionRow,
} from "@/lib/owner";
import { formatPrice } from "@/lib/mock-data";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { AppHeader } from "@/components/app/AppHeader";
import { DEFAULT_COMMISSION_PERCENT } from "@/lib/booking-payment";

export const metadata: Metadata = { title: "Commissions" };

// ─────────────────────────────────────────────────────────────────────────────
// This page is a STATEMENT, not a bill.
//
// Hallnect's commission is retained out of the customer's advance at the moment
// a booking is paid for. The owner is never invoiced, has no due date, and has
// nothing to pay here. Everything below is read-only by design — the owner-billed
// flow (manual UPI submission, gateway self-payment, 7-day due dates, the
// overdue sweep and its settlement deductions) was removed along with it.
// ─────────────────────────────────────────────────────────────────────────────

/** Commission is Hallnect's money already — retained at source, or settled at payout. */
const SETTLED_STATUSES = ["collected", "paid", "paid_out"];

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

type BadgeVar = "success" | "warning" | "secondary" | "destructive" | "default";

function statusBadge(c: OwnerCommissionRow): { label: string; variant: BadgeVar } {
  if (c.status === "collected") return { label: "Retained from advance", variant: "success" };
  if (c.status === "paid" || c.status === "paid_out") return { label: "Settled", variant: "success" };
  if (c.status === "waived")   return { label: "Waived by Hallnect", variant: "secondary" };
  if (c.status === "refunded") return { label: "Refunded — no commission", variant: "secondary" };
  if (c.status === "disputed") return { label: "Under review", variant: "warning" };
  if (c.settlement_adjustment_status === "adjusted" || c.status === "adjusted_from_owner_settlement")
    return { label: "Adjusted from settlement", variant: "secondary" };
  // Historical rows from the retired owner-billed model. Nothing is owed on
  // them — Hallnect does not bill owners for commission any more.
  return { label: "Recorded", variant: "secondary" };
}

export default async function OwnerCommissionsPage() {
  await requireRole(["owner_approved"]);

  const ownerRow = await fetchOwnerRow();
  if (!ownerRow) {
    return (
      <div className="min-h-screen bg-ivory-100">
        <AppHeader title="Commissions" />
        <div className="px-4 py-8">
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="No business profile"
            description="Complete your owner profile first."
            action={<Link href="/owner/profile" className={buttonVariants({ variant: "gold", size: "sm" })}>Complete Profile</Link>}
          />
        </div>
      </div>
    );
  }

  const halls   = await fetchOwnerHalls(ownerRow.id);
  const hallIds = halls.map((h) => h.id);
  const [commissions, adjustments] = await Promise.all([
    fetchOwnerCommissions(hallIds),
    fetchOwnerSettlementAdjustments(ownerRow.id),
  ]);

  const settled = commissions.filter((c) => SETTLED_STATUSES.includes(c.status));
  const totalCommission = settled.reduce((s, c) => s + c.commission_amount, 0);
  const totalPayout     = settled.reduce((s, c) => s + c.owner_payout_amount, 0);

  return (
    <div className="min-h-screen bg-ivory-100 pb-10">
      <AppHeader title="Commissions" />

      <div className="px-4 py-4 sm:px-6 lg:px-8 space-y-4">
        {/* How the commission works — the whole model, in the owner's words. */}
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 shadow-card">
          <p className="flex items-center gap-2 text-sm font-semibold text-green-900">
            <CheckCircle2 className="h-4 w-4" />
            You have nothing to pay here
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-green-900/80">
            Hallnect&apos;s commission is <strong>{DEFAULT_COMMISSION_PERCENT}% of the hall price</strong>, and it is kept
            out of the customer&apos;s advance automatically when you accept a booking. You are never
            invoiced for it, there is no due date, and nothing is ever deducted from a later
            settlement. The page below is a record of what was deducted, for your books.
          </p>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3">
          <SummaryCard
            icon={<Receipt className="h-4 w-4 text-maroon-600" />}
            label="Commission deducted"
            value={formatPrice(totalCommission)}
          />
          <SummaryCard
            icon={<Wallet className="h-4 w-4 text-green-600" />}
            label="Your share of these bookings"
            value={formatPrice(totalPayout)}
            highlight
          />
        </div>

        {/* Settlement adjustments — read-only. Nothing creates these
            automatically any more; an admin can still record one by hand, and
            the owner must be able to see it if they do. */}
        {adjustments.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm shadow-card">
            <p className="font-semibold text-amber-900">Settlement adjustments</p>
            <p className="mt-1 text-xs text-amber-800">
              These amounts were adjusted from your settlement by Hallnect. Contact support if you
              have a question about any of them.
            </p>
            <ul className="mt-2 space-y-1">
              {adjustments.map((a) => (
                <li key={a.id} className="flex items-center justify-between text-xs text-amber-900">
                  <span>Booking #{(a.booking_id ?? "").slice(0, 8).toUpperCase() || "—"} · {fmtDate(a.applied_at)}</span>
                  <span className="font-semibold">− {formatPrice(a.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Statement */}
        {commissions.length === 0 ? (
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="No commissions yet"
            description="A record appears here each time one of your bookings is paid for."
          />
        ) : (
          <div className="space-y-3">
            {commissions.map((c) => {
              const badge = statusBadge(c);
              return (
                <div key={c.id} className="rounded-2xl bg-white p-4 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-charcoal-900">{c.hall_name}</p>
                      <p className="text-[11px] font-mono text-charcoal-500">
                        Booking #{c.booking_id.slice(0, 8).toUpperCase()} · {fmtDate(c.created_at)}
                      </p>
                    </div>
                    <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <Field label="Hall price" value={formatPrice(c.booking_amount)} />
                    <Field label="Rate" value={`${c.commission_rate}%`} />
                    <Field label="Commission" value={`− ${formatPrice(c.commission_amount)}`} strong />
                    <Field label="Your share" value={formatPrice(c.owner_payout_amount)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="flex items-start gap-2 rounded-xl border border-border bg-white p-3 text-[11px] leading-relaxed text-charcoal-600 shadow-card">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-charcoal-400" />
          <span>
            &ldquo;Your share&rdquo; is the hall price less commission, across the advance Hallnect
            transfers to you and the balance you collect at the venue. The ₹200 booking fee shown to
            the customer is charged on top of the advance and is not taken from your share.
          </span>
        </p>
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value, highlight = false }: {
  icon: React.ReactNode; label: string; value: string; highlight?: boolean;
}) {
  return (
    <div className={["rounded-2xl bg-white p-4 shadow-card", highlight ? "ring-2 ring-maroon-200" : ""].join(" ")}>
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ivory-200">{icon}</span>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-charcoal-900">{value}</p>
    </div>
  );
}

function Field({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-charcoal-400">{label}</p>
      <p className={strong ? "font-semibold text-maroon-700" : "text-charcoal-700"}>{value}</p>
    </div>
  );
}
