import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Inbox, MessageSquare, Phone, Users } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerRow, fetchOwnerHalls } from "@/lib/owner";
import { fetchLeadsForHalls, fetchLeadCommissions, type LeadStatus } from "@/lib/leads";
import { readHallCommissionRates } from "@/lib/hall-commission";
import { formatPrice } from "@/lib/mock-data";
import { formatBookingDates } from "@/lib/dates";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { AppHeader } from "@/components/app/AppHeader";
import { LeadActions } from "./_components/LeadActions";

export const metadata: Metadata = { title: "Enquiries" };

type BadgeVar = "success" | "warning" | "secondary" | "destructive" | "default";

const STATUS_CFG: Record<LeadStatus, { label: string; variant: BadgeVar }> = {
  awaiting_verification: { label: "Unverified",  variant: "secondary"   },
  pending:               { label: "Pending",     variant: "warning"     },
  confirmed:             { label: "Confirmed",   variant: "success"     },
  rejected:              { label: "Declined",    variant: "destructive" },
  cancelled:             { label: "Withdrawn",   variant: "secondary"   },
  expired:               { label: "Expired",     variant: "secondary"   },
};

const EVENT_LABELS: Record<string, string> = {
  wedding: "Wedding", reception: "Reception", party: "Party", banquet: "Banquet",
};

const TABS = [
  { key: "open",   label: "To answer", statuses: ["pending"] },
  { key: "closed", label: "Answered",  statuses: ["confirmed", "rejected", "cancelled", "expired"] },
  { key: "all",    label: "All",       statuses: [] as string[] },
];

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

type Props = { searchParams: Promise<{ tab?: string }> };

export default async function OwnerLeadsPage({ searchParams }: Props) {
  await requireRole(["owner_approved"]);
  const { tab: rawTab } = await searchParams;
  const currentTab = TABS.find((t) => t.key === rawTab) ?? TABS[0];

  const ownerRow = await fetchOwnerRow();
  if (!ownerRow) {
    return (
      <div className="min-h-screen bg-ivory-100">
        <AppHeader title="Enquiries" notificationsHref="/owner/notifications" />
        <div className="px-4 py-8">
          <EmptyState
            icon={<Inbox className="h-8 w-8" />}
            title="No business profile"
            description="Complete your owner profile first."
            action={
              <Link href="/owner/profile" className={buttonVariants({ variant: "gold", size: "sm" })}>
                Complete Profile
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const halls = await fetchOwnerHalls(ownerRow.id);
  const hallIds = halls.map((h) => h.id);
  const leadHalls = halls.filter((h) => h.booking_mode === "LEAD_GENERATION");

  // UNVERIFIED LEADS ARE NOT FETCHED. fetchLeadsForHalls filters on
  // phone_verified by default, and this page does not override it — so an
  // enquiry whose number has not been proved is invisible here, exactly as
  // leads_select makes it invisible to a direct database read.
  const leads = await fetchLeadsForHalls(hallIds);
  const [commissions, rates] = await Promise.all([
    fetchLeadCommissions(leads.map((l) => l.id)),
    readHallCommissionRates(hallIds),
  ]);

  const shown = currentTab.statuses.length
    ? leads.filter((l) => currentTab.statuses.includes(l.status))
    : leads;

  const pendingCount = leads.filter((l) => l.status === "pending").length;
  const hallById = new Map(halls.map((h) => [h.id, h]));

  return (
    <div className="min-h-screen bg-ivory-100 pb-10">
      <AppHeader title="Enquiries" notificationsHref="/owner/notifications" />

      <div className="space-y-4 px-4 py-4 sm:px-6 lg:px-8">
        {/* What an enquiry is and is not. Stated once, at the top, because the
            whole flow depends on the owner understanding that confirming does
            not block a date and does create a commission. */}
        <div className="rounded-2xl border border-maroon-100 bg-white p-4 shadow-card">
          <p className="text-sm font-semibold text-charcoal-900">
            {pendingCount > 0
              ? `${pendingCount} ${pendingCount === 1 ? "enquiry needs" : "enquiries need"} your answer`
              : "Enquiries from your Lead Generation venues"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-charcoal-600">
            Every enquiry below came from a customer whose mobile number we verified by SMS.
            Contact them, agree the price, and then <strong>Confirm</strong> here with the
            amount you settled on — that is what raises Hallnect&apos;s commission. Confirming
            does <strong>not</strong> block the date; do that under Availability.
          </p>
        </div>

        {leadHalls.length === 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">No venue is set to Lead Generation</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-900/80">
              Enquiries only arrive for venues whose booking mode is Lead Generation. Change a
              venue&apos;s mode from its edit page.
            </p>
            <Link
              href="/owner/halls"
              className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-2.5`}
            >
              My venues
            </Link>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto">
          {TABS.map((t) => {
            const on = t.key === currentTab.key;
            const count = t.statuses.length
              ? leads.filter((l) => t.statuses.includes(l.status)).length
              : leads.length;
            return (
              <Link
                key={t.key}
                href={`/owner/leads?tab=${t.key}`}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  on
                    ? "bg-maroon-700 text-white"
                    : "border border-border bg-white text-charcoal-600 hover:border-maroon-300"
                }`}
              >
                {t.label} ({count})
              </Link>
            );
          })}
        </div>

        {shown.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-8 w-8" />}
            title="Nothing here yet"
            description={
              currentTab.key === "open"
                ? "New enquiries will appear here, and we will text you when one arrives."
                : "No enquiries in this view."
            }
          />
        ) : (
          <ul className="space-y-3">
            {shown.map((lead) => {
              const cfg = STATUS_CFG[lead.status];
              const commission = commissions.get(lead.id);
              const hall = hallById.get(lead.hall_id);
              return (
                <li key={lead.id} className="rounded-2xl bg-white p-4 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-serif text-sm font-bold text-charcoal-900">
                        {lead.contact_name}
                      </p>
                      <p className="truncate text-xs text-charcoal-500">{lead.hall_name}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>
                      <span className="rounded-full bg-ivory-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-charcoal-500">
                        Lead
                      </span>
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-charcoal-600">
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5 text-charcoal-400" aria-hidden />
                      {formatBookingDates(lead.event_date, null)}
                    </span>
                    {/* THE PHONE IS THE PRODUCT. This is what the venue paid a
                        commission to receive, so it is a tap-to-call link
                        rather than text to copy out. */}
                    <a
                      href={`tel:${lead.contact_phone}`}
                      className="flex items-center gap-1 font-semibold text-maroon-700"
                    >
                      <Phone className="h-3.5 w-3.5" aria-hidden />
                      {lead.contact_phone}
                    </a>
                    {lead.guest_count != null && (
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5 text-charcoal-400" aria-hidden />
                        {lead.guest_count.toLocaleString("en-IN")} guests
                      </span>
                    )}
                    {lead.event_type && (
                      <span className="text-charcoal-500">
                        {EVENT_LABELS[lead.event_type] ?? lead.event_type}
                      </span>
                    )}
                    <span className="text-charcoal-400">Received {fmtDateTime(lead.created_at)}</span>
                  </div>

                  {lead.requirements && (
                    <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-ivory-50 p-2.5 text-[11px] leading-relaxed text-charcoal-700">
                      <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-charcoal-400" aria-hidden />
                      {lead.requirements}
                    </p>
                  )}

                  {/* Confirmed: show the money, and where to pay it. */}
                  {lead.status === "confirmed" && (
                    <div className="mt-2.5 rounded-xl border border-green-200 bg-green-50 p-3">
                      <p className="text-[11px] font-semibold text-green-900">
                        ✓ Confirmed{lead.confirmed_at ? ` on ${fmtDateTime(lead.confirmed_at)}` : ""}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-charcoal-700">
                        <span>
                          Agreed <strong>{formatPrice(lead.agreed_amount ?? 0)}</strong>
                        </span>
                        {commission && (
                          <>
                            <span>
                              Commission <strong>{commission.commission_rate}%</strong> ={" "}
                              <strong>{formatPrice(commission.commission_amount)}</strong>
                            </span>
                            <span>
                              {commission.status === "paid" ? (
                                <span className="font-semibold text-green-700">Paid</span>
                              ) : (
                                <Link href="/owner/commissions" className="font-semibold text-maroon-700 underline">
                                  Pay commission
                                </Link>
                              )}
                            </span>
                          </>
                        )}
                      </div>
                      {/* A confirmed lead with no commission row means the debt
                          could not be written. Say so — silence here would read
                          as "nothing to pay", and an admin needs to hear about
                          it from the owner. */}
                      {!commission && (
                        <p className="mt-1.5 text-[11px] text-amber-800">
                          We could not record the commission for this enquiry. Please contact
                          Hallnect support with this enquiry so we can correct it.
                        </p>
                      )}
                      {lead.owner_notes && (
                        <p className="mt-1.5 text-[11px] text-charcoal-600">
                          Your note: {lead.owner_notes}
                        </p>
                      )}
                    </div>
                  )}

                  {lead.status === "rejected" && lead.cancel_reason && (
                    <p className="mt-2.5 text-[11px] text-charcoal-500">
                      Declined — {lead.cancel_reason}
                    </p>
                  )}

                  {/* The tick, only where a transition is legal. Once confirmed
                      the control is GONE, not merely disabled: there is nothing
                      left to do and a greyed-out button invites a second try. */}
                  {lead.status === "pending" && (
                    <LeadActions
                      leadId={lead.id}
                      commissionRate={rates.get(lead.hall_id) ?? null}
                      suggestedAmount={hall?.price_per_day ?? null}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
