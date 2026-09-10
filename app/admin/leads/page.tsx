import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { fetchAdminLeadLedger, type LeadStatus } from "@/lib/leads";
import { formatPrice } from "@/lib/mock-data";
import { formatBookingDates } from "@/lib/dates";
import { maskPhone } from "@/lib/notifications/phone";
import { AdminPageHeader } from "@/app/admin/_components/AdminPageHeader";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Inbox } from "lucide-react";

export const metadata: Metadata = { title: "Enquiries" };

// Money that has not been collected yet must never be served from a cache.
export const dynamic = "force-dynamic";

type BadgeVar = "success" | "warning" | "secondary" | "destructive" | "default";

const LEAD_STATUS: Record<LeadStatus, { label: string; variant: BadgeVar }> = {
  awaiting_verification: { label: "Unverified", variant: "secondary" },
  pending:               { label: "Pending",    variant: "warning" },
  confirmed:             { label: "Confirmed",  variant: "success" },
  rejected:              { label: "Declined",   variant: "destructive" },
  cancelled:             { label: "Withdrawn",  variant: "secondary" },
  expired:               { label: "Expired",    variant: "secondary" },
};

/** Commission statuses that mean the money is in. */
const SETTLED = ["paid", "collected", "paid_out"];
/** …and the ones that mean it never will be, so they are not "due". */
const WRITTEN_OFF = ["waived", "refunded", "adjusted_from_owner_settlement"];

const FILTERS = [
  { key: "all",       label: "All" },
  { key: "due",       label: "Commission due" },
  { key: "paid",      label: "Commission paid" },
  { key: "pending",   label: "Awaiting venue" },
  { key: "unverified",label: "Unverified" },
] as const;

type Props = { searchParams: Promise<{ filter?: string }> };

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export default async function AdminLeadsPage({ searchParams }: Props) {
  // ASSERTS ITS OWN ROLE. A layout and its page render CONCURRENTLY in the App
  // Router, so the layout's redirect does not stop this component's queries
  // being issued first — and these read with the service role, which is not
  // row-filtered. This line is the authorisation for everything below it.
  await requireRole(["admin"]);
  const { filter } = await searchParams;
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];

  const ledger = await fetchAdminLeadLedger();

  // SUMMARY IS COMPUTED FROM THE COMMISSION ROWS, never from the leads. A
  // confirmed lead whose commission row failed to write contributes nothing to
  // "due" — and is instead surfaced explicitly below, because a silent zero is
  // how an unbilled venue stays unbilled.
  const withCommission = ledger.filter((r) => r.commission != null);
  const due   = withCommission.filter((r) =>
    !SETTLED.includes(r.commission!.status) && !WRITTEN_OFF.includes(r.commission!.status));
  const paid  = withCommission.filter((r) => SETTLED.includes(r.commission!.status));
  const failed = withCommission.filter((r) => r.payment?.status === "failed"
    && !SETTLED.includes(r.commission!.status));

  const totalDue    = due.reduce((s, r) => s + r.commission!.commission_amount, 0);
  const totalPaid   = paid.reduce((s, r) => s + r.commission!.commission_amount, 0);
  const totalAgreed = withCommission.reduce((s, r) => s + r.commission!.booking_amount, 0);

  // A confirmed lead with NO commission row: the debt could not be written.
  // This is the one inconsistency this page exists to make impossible to miss.
  const unbilled = ledger.filter((r) => r.lead.status === "confirmed" && r.commission == null);

  const rows =
    active.key === "due"        ? due
    : active.key === "paid"     ? paid
    : active.key === "pending"  ? ledger.filter((r) => r.lead.status === "pending")
    : active.key === "unverified" ? ledger.filter((r) => r.lead.status === "awaiting_verification")
    : ledger;

  return (
    <div>
      <AdminPageHeader
        title="Enquiries"
        description={`${ledger.length} lead-generation enquir${ledger.length === 1 ? "y" : "ies"}`}
      />

      <div className="space-y-4 px-4 py-4 sm:px-6 lg:px-8">
        {/* Summary. These four are the reconciliation: what venues owe, what
            they have paid, what is at risk, and the gross value the commission
            was charged on. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card label="Commission due"   value={formatPrice(totalDue)}    sub={`${due.length} unpaid`}   tone="amber" />
          <Card label="Commission paid"  value={formatPrice(totalPaid)}   sub={`${paid.length} settled`} tone="green" />
          <Card label="Failed payments"  value={String(failed.length)}    sub="still owing"              tone={failed.length ? "red" : "plain"} />
          <Card label="Value introduced" value={formatPrice(totalAgreed)} sub="agreed by venues"         tone="plain" />
        </div>

        {unbilled.length > 0 && (
          <div className="rounded-2xl border border-red-300 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-900">
              {unbilled.length} confirmed {unbilled.length === 1 ? "enquiry has" : "enquiries have"} no commission record
            </p>
            <p className="mt-1 text-xs leading-relaxed text-red-900/80">
              The venue confirmed, but the commission row could not be written — so nothing is
              being billed for it. These need to be raised by hand.
            </p>
            <ul className="mt-2 space-y-1 text-[11px] font-mono text-red-900">
              {unbilled.map((r) => (
                <li key={r.lead.id}>
                  {r.lead.id.slice(0, 8).toUpperCase()} · {r.lead.hall_name} ·{" "}
                  {formatPrice(r.lead.agreed_amount ?? 0)} agreed
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "all" ? "?" : `?filter=${f.key}`}
              className={[
                "rounded-full border px-3 py-1 text-xs font-semibold",
                active.key === f.key
                  ? "border-maroon-700 bg-maroon-700 text-white"
                  : "border-border bg-white text-charcoal-600 hover:border-maroon-300",
              ].join(" ")}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-8 w-8" />}
            title="Nothing here"
            description="No enquiries match this filter."
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white shadow-card">
            <table className="w-full min-w-[68rem] text-left text-xs">
              <thead className="border-b border-border bg-ivory-50 text-[10px] uppercase tracking-wide text-charcoal-500">
                <tr>
                  <Th>Enquiry</Th>
                  <Th>Venue / Owner</Th>
                  <Th>Customer</Th>
                  <Th>Event</Th>
                  <Th>Status</Th>
                  <Th align="right">Agreed</Th>
                  <Th align="right">Rate</Th>
                  <Th align="right">Commission</Th>
                  <Th>Payment</Th>
                  <Th>Gateway refs</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(({ lead, ownerBusiness, ownerName, commission, payment }) => {
                  const cfg = LEAD_STATUS[lead.status];
                  const settled = commission ? SETTLED.includes(commission.status) : false;
                  return (
                    <tr key={lead.id} className="align-top">
                      <Td>
                        <span className="font-mono text-[11px] text-charcoal-700">
                          {lead.id.slice(0, 8).toUpperCase()}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-charcoal-400">
                          {fmtDate(lead.created_at)}
                        </span>
                        <span className="mt-0.5 block rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">
                          Lead Generation
                        </span>
                      </Td>
                      <Td>
                        <Link href={`/halls/${lead.hall_slug}`} className="font-semibold text-charcoal-900 hover:text-maroon-700">
                          {lead.hall_name}
                        </Link>
                        <span className="mt-0.5 block text-[10px] text-charcoal-500">
                          {ownerBusiness ?? ownerName ?? "—"}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-charcoal-800">{lead.contact_name}</span>
                        {/* MASKED. An admin reconciling money does not need a
                            customer's full number, and this table is the kind of
                            page that ends up in a screenshot. */}
                        <span className="mt-0.5 block font-mono text-[10px] text-charcoal-500">
                          {maskPhone(lead.contact_phone)}
                        </span>
                        {!lead.phone_verified && (
                          <span className="mt-0.5 block text-[10px] font-semibold text-amber-700">
                            never verified
                          </span>
                        )}
                      </Td>
                      <Td>
                        <span className="text-charcoal-700">
                          {formatBookingDates(lead.event_date, null)}
                        </span>
                        {lead.guest_count != null && (
                          <span className="mt-0.5 block text-[10px] text-charcoal-500">
                            {lead.guest_count.toLocaleString("en-IN")} guests
                          </span>
                        )}
                      </Td>
                      <Td>
                        <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>
                        {lead.confirmed_at && (
                          <span className="mt-0.5 block text-[10px] text-charcoal-400">
                            {fmtDate(lead.confirmed_at)}
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        {lead.agreed_amount != null ? formatPrice(lead.agreed_amount) : "—"}
                      </Td>
                      <Td align="right">
                        {commission ? `${commission.commission_rate}%` : "—"}
                      </Td>
                      <Td align="right">
                        {commission ? (
                          <span className={settled ? "font-semibold text-green-700" : "font-semibold text-maroon-700"}>
                            {formatPrice(commission.commission_amount)}
                          </span>
                        ) : lead.status === "confirmed" ? (
                          <span className="font-semibold text-red-600">not raised</span>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>
                        {!commission ? (
                          <span className="text-charcoal-400">—</span>
                        ) : settled ? (
                          <>
                            <span className="font-semibold text-green-700">Paid</span>
                            <span className="mt-0.5 block text-[10px] text-charcoal-500">
                              {fmtDate(commission.paid_at)}
                            </span>
                          </>
                        ) : WRITTEN_OFF.includes(commission.status) ? (
                          <span className="text-charcoal-500">{commission.status}</span>
                        ) : (
                          <>
                            <span className="font-semibold text-amber-700">Due</span>
                            <span className="mt-0.5 block text-[10px] text-charcoal-500">
                              by {fmtDate(commission.due_date)}
                            </span>
                            {payment?.status === "failed" && (
                              <span className="mt-0.5 block text-[10px] font-semibold text-red-600">
                                last attempt failed
                              </span>
                            )}
                            {payment?.status === "created" && (
                              <span className="mt-0.5 block text-[10px] text-charcoal-500">
                                checkout open
                              </span>
                            )}
                          </>
                        )}
                      </Td>
                      <Td>
                        {/* Order and payment ids only — never a token, a session
                            id or anything from raw_response. */}
                        {payment?.cashfreeOrderId ? (
                          <span className="block font-mono text-[10px] text-charcoal-600">
                            {payment.cashfreeOrderId}
                          </span>
                        ) : (
                          <span className="text-charcoal-400">—</span>
                        )}
                        {payment?.cashfreePaymentId && (
                          <span className="mt-0.5 block font-mono text-[10px] text-charcoal-400">
                            {payment.cashfreePaymentId}
                          </span>
                        )}
                      </Td>
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

function Card({ label, value, sub, tone }: {
  label: string; value: string; sub: string; tone: "amber" | "green" | "red" | "plain";
}) {
  const ring = {
    amber: "ring-2 ring-amber-200",
    green: "ring-2 ring-green-200",
    red:   "ring-2 ring-red-300",
    plain: "",
  }[tone];
  return (
    <div className={`rounded-2xl bg-white p-4 shadow-card ${ring}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-charcoal-900">{value}</p>
      <p className="text-[10px] text-charcoal-400">{sub}</p>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th scope="col" className={`px-3 py-2 font-semibold ${align === "right" ? "text-right" : ""}`}>{children}</th>;
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <td className={`px-3 py-2.5 ${align === "right" ? "text-right tabular-nums" : ""}`}>{children}</td>;
}
