import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Inbox, Users } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getSession } from "@/lib/auth";
import { fetchLeadsForCustomer, type LeadStatus } from "@/lib/leads";
import { formatBookingDates } from "@/lib/dates";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { AppHeader } from "@/components/app/AppHeader";
import { WithdrawEnquiry } from "./_components/WithdrawEnquiry";

export const metadata: Metadata = { title: "My enquiries" };

type BadgeVar = "success" | "warning" | "secondary" | "destructive" | "default";

// WHAT THE CUSTOMER IS TOLD, in their words rather than the schema's. The two
// halves that matter: an unverified enquiry has NOT reached the venue, and a
// confirmed one is still not a paid booking.
const STATUS_CFG: Record<LeadStatus, { label: string; variant: BadgeVar; note: string }> = {
  awaiting_verification: {
    label: "Not sent yet", variant: "warning",
    note: "We could not verify your number, so this has not reached the venue. Send it again to finish.",
  },
  pending: {
    label: "Sent to venue", variant: "default",
    note: "The venue has your enquiry and will contact you on the number you verified.",
  },
  confirmed: {
    label: "Venue confirmed", variant: "success",
    note: "The venue has confirmed your enquiry. Any payment is arranged directly with them — Hallnect does not collect it.",
  },
  rejected: {
    label: "Declined", variant: "destructive",
    note: "The venue could not take this date.",
  },
  cancelled: {
    label: "Withdrawn", variant: "secondary",
    note: "You withdrew this enquiry.",
  },
  expired: {
    label: "Expired", variant: "secondary",
    note: "The event date has passed.",
  },
};

const EVENT_LABELS: Record<string, string> = {
  wedding: "Wedding", reception: "Reception", party: "Party", banquet: "Banquet",
};

export default async function CustomerEnquiriesPage() {
  await requireRole(["customer", "owner_pending", "owner_approved", "admin"]);
  const user = await getSession();
  if (!user) return null;

  const leads = await fetchLeadsForCustomer(user.id);

  return (
    <div className="min-h-screen bg-ivory-100 pb-20">
      <AppHeader title="My enquiries" notificationsHref="/customer/notifications" />

      <div className="space-y-3 px-4 py-4 sm:px-6 lg:px-8">
        {leads.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-8 w-8" />}
            title="No enquiries yet"
            description="Some venues take enquiries instead of online bookings. Send one and it appears here."
            action={
              <Link href="/halls" className={buttonVariants({ variant: "gold", size: "sm" })}>
                Browse venues
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {leads.map((lead) => {
              const cfg = STATUS_CFG[lead.status];
              return (
                <li key={lead.id} className="rounded-2xl bg-white p-4 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/halls/${lead.hall_slug}`}
                        className="truncate font-serif text-sm font-bold text-charcoal-900 hover:text-maroon-700"
                      >
                        {lead.hall_name}
                      </Link>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-charcoal-600">
                        <span className="flex items-center gap-1">
                          <CalendarDays className="h-3.5 w-3.5 text-charcoal-400" aria-hidden />
                          {formatBookingDates(lead.event_date, null)}
                        </span>
                        {lead.guest_count != null && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3.5 w-3.5 text-charcoal-400" aria-hidden />
                            {lead.guest_count.toLocaleString("en-IN")}
                          </span>
                        )}
                        {lead.event_type && (
                          <span>{EVENT_LABELS[lead.event_type] ?? lead.event_type}</span>
                        )}
                      </p>
                    </div>
                    <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>
                  </div>

                  <p className="mt-2 text-[11px] leading-relaxed text-charcoal-600">{cfg.note}</p>

                  {lead.status === "rejected" && lead.cancel_reason && (
                    <p className="mt-1 text-[11px] text-charcoal-500">
                      Reason: {lead.cancel_reason}
                    </p>
                  )}

                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {lead.status === "awaiting_verification" && (
                      <Link
                        href={`/enquiry/${lead.hall_slug}`}
                        className={buttonVariants({ variant: "gold", size: "sm" })}
                      >
                        Finish sending
                      </Link>
                    )}
                    {/* Withdrawing is offered only while the venue can still be
                        spared the call. Once they have confirmed, a commission
                        exists and the record is no longer the customer's alone
                        to delete. */}
                    {(lead.status === "awaiting_verification" || lead.status === "pending") && (
                      <WithdrawEnquiry leadId={lead.id} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
