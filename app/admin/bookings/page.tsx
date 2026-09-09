import { formatBookingDates } from "@/lib/dates";
import { requireRole } from "@/lib/auth";
import type { Metadata } from "next";
import Link from "next/link";
import { fetchAllBookings } from "@/lib/admin";
import { formatPrice } from "@/lib/mock-data";
import { Badge } from "@/components/ui/Badge";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { RunBookingExpiry } from "./_components/RunBookingExpiry";
import { CancelBookingButton } from "./_components/CancelBookingButton";

export const metadata: Metadata = { title: "Bookings — Admin" };

type BadgeVar = "success" | "warning" | "secondary" | "destructive" | "default";

const FILTERS = [
  { key: "all",      label: "All",      value: undefined          },
  { key: "active",   label: "Active",   value: "booking_requested" },
  { key: "confirmed", label: "Confirmed", value: "owner_confirmed"  },
  { key: "completed", label: "Completed", value: "completed"        },
  { key: "cancelled", label: "Cancelled", value: "cancelled"        },
];

const STATUS_CFG: Record<string, { label: string; variant: BadgeVar }> = {
  pending_payment:   { label: "Pay Pending",     variant: "warning"     },
  payment_success:   { label: "Paid",            variant: "success"     },
  booking_requested: { label: "Requested",       variant: "default"     },
  owner_confirmed:   { label: "Confirmed",       variant: "success"     },
  owner_rejected:    { label: "Rejected",        variant: "destructive" },
  cancelled:         { label: "Cancelled",       variant: "secondary"   },
  completed:         { label: "Completed",       variant: "secondary"   },
  refunded:          { label: "Refunded",        variant: "secondary"   },
};

const SLOT_LABELS: Record<string, string> = {
  full_day: "Full Day", morning: "Morning", evening: "Evening",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

type Props = { searchParams: Promise<{ status?: string }> };

export default async function AdminBookingsPage({ searchParams }: Props) {
  // ASSERTS ITS OWN ROLE. The layout also calls requireRole, but a layout and
  // its page render CONCURRENTLY in the App Router — the layout's redirect does
  // not stop this component's queries from being issued first. An anonymous
  // request therefore ran every read below as `anon`, was denied by the grants,
  // and only then got its 307. Nothing leaked, but the work was wasted and each
  // denial now logs at error level, which would bury real failures. Guarding
  // here also means this page is not relying on a file it does not control.
  await requireRole(["admin"]);
  const { status } = await searchParams;
  const activeFilter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const bookings = await fetchAllBookings(activeFilter.value);

  return (
    <div>
      <AdminPageHeader title="Bookings" description={`${bookings.length} booking${bookings.length !== 1 ? "s" : ""}`} />

      <div className="px-4 pt-4 sm:px-6 lg:px-8">
        <RunBookingExpiry />
      </div>

      <div className="px-4 py-4 sm:px-6 lg:px-8 space-y-4">

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

        {bookings.length === 0 ? (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-charcoal-500 shadow-card">
            No bookings match this filter.
          </p>
        ) : (
          <div className="overflow-x-auto lg:overflow-hidden rounded-2xl bg-white shadow-card">
            <table className="min-w-full text-sm">
              <thead className="bg-ivory-50 border-b border-border">
                <tr>
                  <Th>Booking</Th>
                  <Th>Hall</Th>
                  <Th>Customer</Th>
                  <Th>Event</Th>
                  <Th>Amount</Th>
                  <Th>Status</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => {
                  const cfg = STATUS_CFG[b.status] ?? { label: b.status, variant: "secondary" as BadgeVar };
                  return (
                    <tr key={b.id} className="border-b border-border last:border-b-0 hover:bg-ivory-50/50">
                      <Td>
                        <p className="font-mono text-[11px] text-charcoal-500">#{b.id.slice(0, 8).toUpperCase()}</p>
                        <p className="text-[10px] text-charcoal-400">{fmtDate(b.created_at)}</p>
                        {/* WHICH POLICY BINDS THIS BOOKING. /refund-policy says
                            the version applicable is the one in force when the
                            booking was made, so in a dispute "they accepted the
                            terms" is worth nothing without saying which terms.
                            Stored since 0052; blank on older rows, and shown as
                            such rather than guessed. */}
                        <p className="text-[10px] text-charcoal-400">
                          {b.terms_version
                            ? <>Terms <span className="font-mono">{b.terms_version}</span></>
                            : <span className="italic">Terms version not recorded</span>}
                        </p>
                      </Td>
                      <Td className="font-medium">{b.hall_name}</Td>
                      <Td>
                        <p className="truncate">{b.customer_name ?? "—"}</p>
                        <p className="truncate text-[11px] text-charcoal-500">{b.customer_email ?? "—"}</p>
                      </Td>
                      <Td>
                        <p>{formatBookingDates(b.event_date, b.end_date)}</p>
                        <p className="text-[11px] text-charcoal-500">{SLOT_LABELS[b.slot] ?? b.slot}</p>
                      </Td>
                      <Td className="font-semibold">
                        {formatPrice(b.total_amount)}
                        {/* THE BOOKING'S OWN SNAPSHOT, not the hall's rate
                            today. If the owner has since changed their
                            commission, these figures do not move — they are
                            what this customer was actually charged against and
                            what the owner is actually owed. */}
                        {b.commission_rate != null && b.commission_amount != null ? (
                          <span className="mt-1 block text-[11px] font-normal text-charcoal-500">
                            <span className="block">
                              Commission {b.commission_rate}% ·{" "}
                              {formatPrice(b.commission_amount)}
                            </span>
                            {b.owner_net_advance != null && (
                              <span className="block">
                                Owner settlement {formatPrice(b.owner_net_advance)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="mt-1 block text-[11px] font-normal italic text-charcoal-400">
                            Commission not recorded
                          </span>
                        )}
                      </Td>
                      <Td><Badge variant={cfg.variant} size="sm">{cfg.label}</Badge></Td>
                      <Td>
                        {["payment_success", "booking_requested", "owner_confirmed"].includes(b.status) && (
                          <CancelBookingButton bookingId={b.id} />
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

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-charcoal-500">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}
