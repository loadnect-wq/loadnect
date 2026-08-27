import type { Metadata } from "next";
import Link from "next/link";
import { Lock, AlertTriangle, Undo2 } from "lucide-react";
import { fetchAllPayments, fetchStuckPayouts, fetchRefundQueue } from "@/lib/admin";
import { IssueRefundButton, SyncRefundButton, RetryPayoutButton } from "./_components/MoneyActions";
import { formatPrice } from "@/lib/mock-data";
import { Badge } from "@/components/ui/Badge";
import { AdminPageHeader } from "../_components/AdminPageHeader";

export const metadata: Metadata = { title: "Payments — Admin" };

type BadgeVar = "success" | "warning" | "secondary" | "destructive" | "default";

const FILTERS = [
  { key: "all",       label: "All",        value: undefined          },
  { key: "succeeded", label: "Succeeded",  value: "payment_success"  },
  { key: "pending",   label: "Pending",    value: "pending"          },
  { key: "failed",    label: "Failed",     value: "payment_failed"   },
  { key: "refunded",  label: "Refunded",   value: "refunded"         },
];

const STATUS_CFG: Record<string, { label: string; variant: BadgeVar }> = {
  pending:         { label: "Pending",   variant: "warning"     },
  created:         { label: "Created",   variant: "default"     },
  payment_success: { label: "Succeeded", variant: "success"     },
  payment_failed:  { label: "Failed",    variant: "destructive" },
  user_dropped:    { label: "Dropped",   variant: "secondary"   },
  cancelled:       { label: "Cancelled", variant: "secondary"   },
  refunded:        { label: "Refunded",  variant: "secondary"   },
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type Props = { searchParams: Promise<{ status?: string }> };

export default async function AdminPaymentsPage({ searchParams }: Props) {
  const { status } = await searchParams;
  const activeFilter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const [payments, stuck, refunds] = await Promise.all([
    fetchAllPayments(activeFilter.value),
    fetchStuckPayouts(),
    fetchRefundQueue(),
  ]);
  const stuckTotal = stuck.reduce((sum, r) => sum + r.owner_amount, 0);
  const owedTotal = refunds
    .filter((r) => r.state !== "processing")
    .reduce((sum, r) => sum + r.amount, 0);

  return (
    <div>
      <AdminPageHeader title="Payments" description="Cashfree transactions, refunds owed to customers, and payouts owed to venue owners." />

      <div className="px-4 py-4 sm:px-6 lg:px-8 space-y-4">

        <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The transaction ledger below is write-locked — Cashfree webhooks are the only
            thing that edits it. Refunds and payouts are the exception: those are actions,
            and every one is recorded in the{" "}
            <Link href="/admin/audit-logs" className="font-semibold underline">audit log</Link>.
            No amount can be typed by hand; every figure comes from the booking.
          </span>
        </div>

        {/* REFUNDS. First, because this is money owed to a customer who has
            already cancelled and is waiting for it. */}
        {refunds.length > 0 && (
          <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
            <div className="flex items-start gap-2">
              <Undo2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-amber-900">
                  {refunds.length} refund{refunds.length === 1 ? "" : "s"} to action
                  {owedTotal > 0 && <> — {formatPrice(owedTotal)} owed</>}
                </p>
                <p className="mt-0.5 text-xs text-amber-800">
                  The amount is fixed by the cancellation policy at the time of
                  cancellation and cannot be edited here. Sending it moves real money.
                </p>
                <ul className="mt-3 space-y-2">
                  {refunds.map((r) => (
                    <li key={r.payment_id} className="rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-charcoal-900">{r.hall_name}</span>
                        <span className="font-bold text-charcoal-900">{formatPrice(r.amount)}</span>
                      </div>
                      <p className="mt-0.5 text-charcoal-500">
                        Booking {r.booking_id.slice(0, 8).toUpperCase()}
                        {r.event_date && <> · event {r.event_date}</>}
                        {" · "}
                        <span className={
                          r.state === "failed" ? "font-semibold text-red-700"
                            : r.state === "processing" ? "font-semibold text-blue-700"
                            : "font-semibold text-amber-700"
                        }>
                          {r.state === "owed" ? "not sent yet"
                            : r.state === "processing" ? "in progress at the bank"
                            : "failed"}
                        </span>
                      </p>
                      {r.error && <p className="mt-0.5 text-red-700">{r.error}</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {r.state === "processing" ? (
                          <SyncRefundButton bookingId={r.booking_id} />
                        ) : (
                          <IssueRefundButton
                            bookingId={r.booking_id}
                            amountLabel={formatPrice(r.amount)}
                            state={r.state}
                          />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* MONEY OWED BUT NOT SENT. Shown above the ledger because it is the
            only thing on this page that needs someone to act. */}
        {stuck.length > 0 && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-red-900">
                  {stuck.length} owner payout{stuck.length === 1 ? "" : "s"} did not go through
                  {" — "}{formatPrice(stuckTotal)} owed
                </p>
                <p className="mt-0.5 text-xs text-red-800">
                  These bookings are confirmed and the customer was charged, but the owner&apos;s
                  share is still in Hallnect&apos;s account. The usual causes are an owner who has
                  not finished payout onboarding, or Easy Split not yet being enabled on the
                  Cashfree account. Where a payout was never attempted the figure shown is the
                  amount captured, not the owner&apos;s computed share.
                </p>
                <ul className="mt-3 space-y-2">
                  {stuck.map((r) => (
                    <li key={r.payment_id} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-charcoal-900">{r.hall_name}</span>
                        <span className="font-bold text-red-700">{formatPrice(r.owner_amount)}</span>
                      </div>
                      <p className="mt-0.5 text-charcoal-500">
                        Booking {r.booking_id.slice(0, 8).toUpperCase()} · {r.split_status} · {fmtDateTime(r.created_at)}
                      </p>
                      {r.split_error && (
                        <p className="mt-0.5 text-red-700">{r.split_error}</p>
                      )}
                      <div className="mt-2">
                        <RetryPayoutButton
                          bookingId={r.booking_id}
                          amountLabel={formatPrice(r.owner_amount)}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "all" ? "?" : `?status=${f.key}`}
              className={[
                "rounded-full border px-3 py-1 text-xs font-semibold",
                activeFilter.key === f.key
                  ? "border-maroon-700 bg-maroon-700 text-white"
                  : "border-border bg-white text-charcoal-600 hover:border-maroon-300",
              ].join(" ")}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {payments.length === 0 ? (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-charcoal-500 shadow-card">
            No payments match this filter.
          </p>
        ) : (
          <div className="overflow-x-auto lg:overflow-hidden rounded-2xl bg-white shadow-card">
            <table className="min-w-full text-sm">
              <thead className="bg-ivory-50 border-b border-border">
                <tr>
                  <Th>Order ID</Th>
                  <Th>Hall / Customer</Th>
                  <Th>Amount</Th>
                  <Th>Method</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const cfg = STATUS_CFG[p.status] ?? { label: p.status, variant: "secondary" as BadgeVar };
                  return (
                    <tr key={p.id} className="border-b border-border last:border-b-0 hover:bg-ivory-50/50">
                      <Td>
                        <p className="font-mono text-[11px] text-charcoal-700 truncate max-w-[160px]">{p.cashfree_order_id ?? `#${p.id.slice(0,8)}`}</p>
                        <p className="font-mono text-[10px] text-charcoal-400">Booking #{p.booking_id.slice(0,8).toUpperCase()}</p>
                      </Td>
                      <Td>
                        <p className="font-medium truncate max-w-[200px]">{p.hall_name}</p>
                        <p className="text-[11px] text-charcoal-500 truncate max-w-[200px]">{p.customer_email ?? "—"}</p>
                      </Td>
                      <Td className="font-semibold">{formatPrice(p.amount)}</Td>
                      <Td className="text-xs">{p.payment_method ?? "—"}</Td>
                      <Td><Badge variant={cfg.variant} size="sm">{cfg.label}</Badge></Td>
                      <Td className="text-xs text-charcoal-500">{fmtDateTime(p.created_at)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-charcoal-500">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}
