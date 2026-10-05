import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Inbox, Phone, Users } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchVenueCategories } from "@/lib/venue-categories.server";
import { categoryLabelMap } from "@/lib/venue-categories";
import { getSession } from "@/lib/auth";
import { fetchLeadsForCustomer, fetchVenueContactsForCustomer, type LeadStatus } from "@/lib/leads";
import { formatBookingDates, todayInBusinessTz } from "@/lib/dates";
import { formatPrice } from "@/lib/mock-data";
import { QuoteDecision } from "./_components/QuoteDecision";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { AppHeader } from "@/components/app/AppHeader";
import { WithdrawEnquiry } from "./_components/WithdrawEnquiry";

export const metadata: Metadata = { title: "My enquiries" };

type BadgeVar = "success" | "warning" | "secondary" | "destructive" | "default";

// WHAT THE CUSTOMER IS TOLD, in their words rather than the schema's. The
// halves that matter: an unverified enquiry has NOT reached the venue; the
// venue gets their number only when they accept its quote (0112); and a
// booked one is paid to the venue, not to Hallnect.
const STATUS_CFG: Record<LeadStatus, { label: string; variant: BadgeVar; note: string }> = {
  awaiting_verification: {
    label: "Not sent yet", variant: "warning",
    note: "We could not verify your number, so this has not reached the venue. Send it again to finish.",
  },
  pending: {
    label: "Waiting for a quote", variant: "default",
    note: "The hall has your request and will reply here with a quote. Your number has not been shared with it.",
  },
  quoted: {
    label: "Quote received", variant: "warning",
    note: "Accept it and the hall gets your number to call you and book. Your number has not been shared yet.",
  },
  accepted: {
    label: "Quote accepted", variant: "success",
    note: "The hall now has your number and will call you to book.",
  },
  confirmed: {
    label: "Booked", variant: "success",
    note: "The hall has marked this booked. Pay the hall directly — Hallnect does not collect it.",
  },
  rejected: {
    label: "Declined", variant: "destructive",
    note: "The venue could not take this date.",
  },
  cancelled: {
    label: "Closed", variant: "secondary",
    note: "You withdrew this enquiry or turned the quote down. The hall never got your number.",
  },
  expired: {
    label: "Expired", variant: "secondary",
    note: "The event date has passed.",
  },
};

export default async function CustomerEnquiriesPage() {
  await requireRole(["customer", "owner_pending", "owner_approved", "admin"]);
  const user = await getSession();
  if (!user) return null;

  const [leads, venueContacts, catalogue] = await Promise.all([
    fetchLeadsForCustomer(user.id),
    // THE VENUE'S NUMBER, released only for enquiries that actually reached
    // them. Deliberately not on the public venue page: a lead venue earns
    // Hallnect nothing but the commission on a confirmed enquiry, and a phone
    // number in the listing lets a customer ring the venue directly — no lead,
    // no confirmation, no commission, and no record that Hallnect made the
    // introduction. Here the introduction has already been made and recorded.
    fetchVenueContactsForCustomer(user.id),
    fetchVenueCategories(),
  ]);

  // slug -> name for the occasion on each enquiry. This WAS four hard-coded
  // values; with the catalogue open (0102) a customer can pick
  // "birthday-party", and the raw-slug fallback at the render site would have
  // printed the hyphen. Lenient read — an unnamed occasion falls back to its
  // slug, which is ugly but true, and never blocks the page.
  const EVENT_LABELS = categoryLabelMap(catalogue);
  const today = todayInBusinessTz();

  return (
    <div className="min-h-screen bg-ivory-100 pb-20">
      <AppHeader title="My enquiries" notificationsHref="/customer/notifications" />

      <div className="space-y-3 px-4 py-4 sm:px-6 lg:px-8">
        {leads.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-8 w-8" />}
            title="No enquiries yet"
            description="Ask a hall for a quote and it appears here. The hall gets your number only if you accept its quote."
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

                  {/* The quote, as the hall sent it. */}
                  {lead.quote_amount != null && (lead.status === "quoted" || lead.status === "accepted" || lead.status === "confirmed") && (
                    <div className="mt-2.5 rounded-xl border border-maroon-100 bg-maroon-50/40 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-maroon-800">Quote from {lead.hall_name}</p>
                      <p className="mt-0.5 font-serif text-xl font-bold text-charcoal-900">{formatPrice(lead.quote_amount)}</p>
                      <p className="text-[11px] text-charcoal-700">
                        {lead.quote_advance ? `Advance to book: ${formatPrice(lead.quote_advance)}` : "No advance mentioned"}
                        {lead.quote_valid_until && lead.status === "quoted"
                          ? ` · ${lead.quote_valid_until < today ? "ran out on" : "open until"} ${formatBookingDates(lead.quote_valid_until, null)}`
                          : ""}
                      </p>
                      {lead.quote_includes && (
                        <p className="mt-1.5 whitespace-pre-line text-xs text-charcoal-800">{lead.quote_includes}</p>
                      )}
                      {lead.quote_note && <p className="mt-1 text-[11px] text-charcoal-600">Note: {lead.quote_note}</p>}
                      {lead.status === "quoted" && (
                        <QuoteDecision
                          leadId={lead.id}
                          hallName={lead.hall_name}
                          expired={(lead.quote_valid_until ?? "") < today}
                        />
                      )}
                    </div>
                  )}

                  {/* Call the venue. A tap-to-call link, not text to copy out —
                      this is the number they have been waiting for, and they
                      are on a phone. Only rendered for a lead that reached the
                      venue; fetchVenueContactsForCustomer returns nothing for
                      one still awaiting OTP, so an unverified enquiry cannot
                      be used to harvest venue numbers. */}
                  {(() => {
                    const contact = venueContacts.get(lead.id);
                    if (!contact) return null;
                    return contact.phone ? (
                      <a
                        href={`tel:${contact.phone}`}
                        className="mt-2.5 flex items-center gap-2 rounded-xl border border-maroon-200 bg-maroon-50 px-3 py-2.5 active:bg-maroon-100"
                      >
                        <Phone className="h-4 w-4 shrink-0 text-maroon-700" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold text-maroon-900">
                            Call {contact.businessName}
                          </span>
                          <span className="block font-mono text-[11px] text-maroon-800">
                            {contact.phone}
                          </span>
                        </span>
                      </a>
                    ) : (
                      // Says why rather than showing nothing: a missing number
                      // looks like a broken page, and the customer has a real
                      // question they still need answered.
                      <p className="mt-2.5 rounded-xl border border-border bg-ivory-50 px-3 py-2 text-[11px] text-charcoal-600">
                        This venue has not published a contact number. They have your details and
                        will call you — contact Hallnect support if you do not hear back.
                      </p>
                    );
                  })()}

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
                    {/* Withdrawing is offered until the hall marks it booked.
                        After that a commission exists and the record is no
                        longer the customer's alone to delete. (A quote is
                        turned down from the quote card instead.) */}
                    {(lead.status === "awaiting_verification" || lead.status === "pending" || lead.status === "accepted") && (
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
