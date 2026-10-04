// What the family has already done with the hall chosen in their plan: the
// enquiries, site visits and bookings they made on Hallnect. SERVER-ONLY.
//
// Reuses the readers the customer pages use, filtered to one hall. Shown only
// as a list of what exists: an empty or failed read shows nothing rather than
// "you have not enquired", which a failed read would make untrue.

import "server-only";

import { fetchLeadsForCustomer, type LeadStatus } from "@/lib/leads";
import { fetchVisitsForCustomer } from "@/lib/site-visits.server";
import { fetchMyBookings } from "@/lib/customer";
import { todayInBusinessTz } from "@/lib/dates";
import { formatDiaryDay } from "@/lib/diary";
import { VISIT_STATE_LABEL, visitState, visitWhen } from "@/lib/site-visits";

export type HallActivityRow = { key: string; kind: "enquiry" | "visit" | "booking"; text: string; status: string; href: string };

const LEAD_LABEL: Record<LeadStatus, string> = {
  awaiting_verification: "Not sent yet",
  pending: "Sent to the hall",
  confirmed: "Hall confirmed",
  rejected: "Declined",
  cancelled: "Withdrawn",
  expired: "Expired",
};

const BOOKING_LABEL: Record<string, string> = {
  pending_payment: "Payment pending",
  payment_success: "Paid",
  booking_requested: "Requested",
  owner_confirmed: "Confirmed",
  owner_rejected: "Rejected",
  cancelled: "Cancelled",
  completed: "Completed",
  refunded: "Refunded",
};

export async function fetchHallActivity(customerId: string, hallId: string): Promise<HallActivityRow[]> {
  const today = todayInBusinessTz();
  const [leads, visits, bookings] = await Promise.all([
    fetchLeadsForCustomer(customerId),
    fetchVisitsForCustomer(customerId),
    fetchMyBookings("all"),
  ]);
  const rows: HallActivityRow[] = [];
  for (const b of bookings.filter((x) => x.hall_id === hallId)) {
    rows.push({
      key: `b-${b.id}`,
      kind: "booking",
      text: `Booking for ${formatDiaryDay("en", b.event_date, { year: true })}`,
      status: BOOKING_LABEL[b.status] ?? b.status,
      href: `/customer/bookings/${b.id}`,
    });
  }
  for (const l of leads.filter((x) => x.hall_id === hallId)) {
    rows.push({
      key: `l-${l.id}`,
      kind: "enquiry",
      text: `Enquiry for ${formatDiaryDay("en", l.event_date, { year: true })}`,
      status: LEAD_LABEL[l.status] ?? l.status,
      href: "/customer/enquiries",
    });
  }
  for (const v of (visits ?? []).filter((x) => x.hallId === hallId)) {
    rows.push({
      key: `v-${v.id}`,
      kind: "visit",
      text: `Visit on ${visitWhen(v.visitDate, v.visitWindow)}`,
      status: VISIT_STATE_LABEL[visitState(v.status, v.visitDate, today)],
      href: "/customer/visits",
    });
  }
  return rows;
}
