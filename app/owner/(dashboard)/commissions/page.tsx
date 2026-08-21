import type { Metadata } from "next";
import Link from "next/link";
import { Wallet, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { requireRole } from "@/lib/auth";
import {
  fetchOwnerRow, fetchOwnerHalls, fetchOwnerCommissions,
  fetchOwnerSettlementAdjustments,
  type OwnerCommissionRow,
} from "@/lib/owner";
import { getPublicPaymentSettings } from "@/lib/platform-settings";
import { formatPrice } from "@/lib/mock-data";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { AppHeader } from "@/components/app/AppHeader";
import { PayCommission } from "./_components/PayCommission";
import { PayCommissionOnline } from "./_components/PayCommissionOnline";
import { isCashfreeConfigured } from "@/lib/cashfree";

export const metadata: Metadata = { title: "Commissions" };

const OWNER_TERMS =
  "Commission is payable to Hallnect for confirmed/advance-paid bookings. If unpaid " +
  "after the due date, Hallnect may adjust the outstanding commission from the owner's " +
  "pending settlement as per platform terms.";

// Buckets for owner-facing display.
const PAID_STATUSES     = ["paid", "paid_out"];
const ADJUSTED_STATUSES = ["adjusted_from_owner_settlement"];
const OUTSTANDING_STATUSES = ["pending", "collected", "overdue", "rejected", "payment_submitted", "payment_under_review"];

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function daysRemaining(due: string | null): number | null {
  if (!due) return null;
  const ms = new Date(due).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

type BadgeVar = "success" | "warning" | "secondary" | "destructive" | "default";

function statusBadge(c: OwnerCommissionRow): { label: string; variant: BadgeVar } {
  if (ADJUSTED_STATUSES.includes(c.status) || c.settlement_adjustment_status === "adjusted")
    return { label: "Adjusted from settlement", variant: "secondary" };
  if (PAID_STATUSES.includes(c.status)) return { label: "Paid", variant: "success" };
  if (c.status === "waived")   return { label: "Waived", variant: "secondary" };
  if (c.status === "disputed") return { label: "Disputed", variant: "destructive" };
  if (c.submission_status === "payment_submitted" || c.submission_status === "payment_under_review" || c.status === "payment_submitted")
    return { label: "Under review", variant: "warning" };
  if (c.status === "overdue")  return { label: "Overdue", variant: "destructive" };
  if (c.submission_status === "rejected") return { label: "Payment rejected — retry", variant: "destructive" };
  return { label: "Outstanding", variant: "warning" };
}

function isOutstanding(c: OwnerCommissionRow): boolean {
  if (PAID_STATUSES.includes(c.status)) return false;
  if (ADJUSTED_STATUSES.includes(c.status)) return false;
  if (c.status === "waived") return false;
  return OUTSTANDING_STATUSES.includes(c.status);
}

function hasOpenSubmission(c: OwnerCommissionRow): boolean {
  return c.submission_status === "payment_submitted" || c.submission_status === "payment_under_review";
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
  const [commissions, adjustments, settings] = await Promise.all([
    fetchOwnerCommissions(hallIds),
    fetchOwnerSettlementAdjustments(ownerRow.id),
    getPublicPaymentSettings(),
  ]);

  const outstanding = commissions.filter(isOutstanding);
  const overdue     = commissions.filter((c) => c.status === "overdue" || (statusBadge(c).label === "Overdue"));
  const paid        = commissions.filter((c) => PAID_STATUSES.includes(c.status));

  const gatewayEnabled = isCashfreeConfigured();
  const totalOutstanding = outstanding.reduce((s, c) => s + c.commission_amount, 0);
  const totalOverdue     = overdue.reduce((s, c) => s + c.commission_amount, 0);
  const totalPaid        = paid.reduce((s, c) => s + c.commission_amount, 0);

  const nextDue = [...outstanding]
    .filter((c) => c.due_date)
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())[0];

  return (
    <div className="min-h-screen bg-ivory-100 pb-10">
      <AppHeader title="Commissions" />

      <div className="px-4 py-4 sm:px-6 lg:px-8 space-y-4">
        {/* Terms */}
        <p className="rounded-xl border border-border bg-white p-3 text-xs text-charcoal-600 shadow-card">
          {OWNER_TERMS}
        </p>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard icon={<Wallet className="h-4 w-4 text-maroon-600" />}  label="Outstanding" value={formatPrice(totalOutstanding)} highlight />
          <SummaryCard icon={<AlertTriangle className="h-4 w-4 text-red-600" />} label="Overdue" value={formatPrice(totalOverdue)} />
          <SummaryCard icon={<CheckCircle2 className="h-4 w-4 text-green-600" />} label="Paid" value={formatPrice(totalPaid)} />
          <SummaryCard icon={<Clock className="h-4 w-4 text-charcoal-600" />} label="Next due" value={nextDue ? fmtDate(nextDue.due_date) : "—"} />
        </div>

        {/* Settlement adjustments notice */}
        {adjustments.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm shadow-card">
            <p className="font-semibold text-amber-900">Settlement adjustments</p>
            <p className="mt-1 text-xs text-amber-800">
              Commission was adjusted from owner settlement because payment was not completed within
              the allowed 7-day period.
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

        {/* Commission list */}
        {commissions.length === 0 ? (
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="No commissions yet"
            description="Commission records appear here once your bookings receive advance payments."
          />
        ) : (
          <div className="space-y-3">
            {commissions.map((c) => {
              const badge = statusBadge(c);
              const dr = daysRemaining(c.due_date);
              const payable = isOutstanding(c) && !hasOpenSubmission(c) && settings.enableOwnerUpiPayment;
              return (
                <div key={c.id} className="rounded-2xl bg-white p-4 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-charcoal-900">{c.hall_name}</p>
                      <p className="text-[11px] font-mono text-charcoal-500">Booking #{c.booking_id.slice(0, 8).toUpperCase()}</p>
                    </div>
                    <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <Field label="Commission" value={formatPrice(c.commission_amount)} strong />
                    <Field label="Rate" value={`${c.commission_rate}%`} />
                    <Field label="Due date" value={fmtDate(c.due_date)} />
                    <Field
                      label="Days left"
                      value={
                        PAID_STATUSES.includes(c.status) || ADJUSTED_STATUSES.includes(c.status)
                          ? "—"
                          : dr === null ? "—" : dr < 0 ? `${Math.abs(dr)}d overdue` : `${dr}d`
                      }
                    />
                  </div>

                  {/* Preferred: pay through Cashfree — settles instantly, no
                      admin verification step. The manual UPI + screenshot flow
                      stays available as a fallback when the gateway is off. */}
                  {isOutstanding(c) && !hasOpenSubmission(c) && gatewayEnabled && (
                    <div className="mt-3">
                      <PayCommissionOnline
                        commissionId={c.id}
                        amountLabel={formatPrice(c.commission_amount)}
                      />
                    </div>
                  )}

                  {payable && (
                    <div className="mt-3">
                      {gatewayEnabled && (
                        <p className="mb-2 text-center text-[10px] uppercase tracking-wide text-charcoal-400">
                          or pay manually
                        </p>
                      )}
                      <PayCommission
                        commissionId={c.id}
                        amount={formatPrice(c.commission_amount)}
                        upiId={settings.hallnectUpiId}
                        upiQrUrl={settings.hallnectUpiQrUrl}
                        underReview={hasOpenSubmission(c)}
                      />
                    </div>
                  )}

                  {(ADJUSTED_STATUSES.includes(c.status) || c.settlement_adjustment_status === "adjusted") && (
                    <p className="mt-3 rounded-lg bg-ivory-100 p-2 text-[11px] text-charcoal-600">
                      Commission was adjusted from owner settlement because payment was not completed
                      within the allowed 7-day period.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
