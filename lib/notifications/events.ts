// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications/events.ts — business events → notifications (SERVER-ONLY).
//
// The single translation layer between "something happened" and "who gets
// which SMS". Call sites pass ENTITY IDS ONLY — every recipient phone number
// is resolved here from the database (booking → hall → owner → profile),
// never accepted from the client (§6: do NOT trust a phone supplied by the
// customer for owner alerts).
//
// Every function is fire-safe: errors are logged and swallowed so the business
// action that triggered the event can never be failed by its notification.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizePhoneE164, sanitizeSmsFreeText } from "@/lib/notifications/phone";

import { formatBookingDates, todayInBusinessTz } from "@/lib/dates";
import {
  bookingRef,
  formatAmountForSms,
  customerTemplates,
  ownerTemplates,
  adminTemplates,
  type BookingSmsData,
} from "@/lib/notifications/templates";
import {
  dispatchAll,
  getAdminNotificationPhone,
  type NotificationRequest,
} from "@/lib/notifications/service";

/**
 * First candidate that is actually a VALID phone number.
 *
 * The fallback chain used to be presence-based (`business_phone ?? phone`), so
 * an owner whose business_phone was malformed — e.g. a 9-digit number — had
 * every SMS routed to that dead value and never fell through to their valid
 * personal number. The owner then silently missed booking requests, which
 * auto-expire after 48 hours.
 */
function pickPhone(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    if (c && normalizePhoneE164(c)) return c;
  }
  return null;
}

export type BookingEventKind =
  | "booking.requested"
  | "booking.confirmed"
  | "booking.rejected"
  | "booking.cancelled"
  | "payment.success"
  | "payment.failed"
  | "refund.initiated";

type BookingContext = {
  bookingId: string;
  hallId: string;
  hallName: string;
  dateLabel: string;
  totalAmount: number;
  customer: { userId: string; phone: string | null; optedIn: boolean };
  owner: { userId: string | null; phone: string | null; optedIn: boolean };
};

/**
 * Loads everything needed to notify about one booking in a single query.
 * Owner phone resolution: hall_owners.business_phone first (the number the
 * owner registered for their venue), falling back to their personal
 * profiles.phone. Customer phone: the booking's own contact_phone snapshot
 * first, falling back to profiles.phone.
 */
async function loadBookingContext(bookingId: string): Promise<BookingContext | null> {
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  const { data, error } = await db
    .from("bookings")
    .select(
      // hall_owners has TWO FKs to profiles (profile_id, verified_by) — the
      // embed must disambiguate with !profile_id or PostgREST errors out.
      "id, hall_id, customer_id, event_date, end_date, total_amount, contact_phone, " +
      "halls(name, owner_id, hall_owners!owner_id(business_name, business_phone, profile_id, " +
      "profiles!profile_id(phone, sms_notifications_enabled)))," +
      "profiles!customer_id(phone, phone_verified, sms_notifications_enabled)"
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (error || !data) {
    console.error("[notifications] booking context load failed:", error?.message ?? "not found");
    return null;
  }

  const hall = data.halls ?? {};
  const ownerRow = hall.hall_owners ?? null;
  const ownerProfile = ownerRow?.profiles ?? null;
  const customerProfile = data.profiles ?? null;

  return {
    bookingId: data.id,
    hallId: data.hall_id,
    hallName: hall.name ?? "your venue",
    dateLabel: formatBookingDates(data.event_date, data.end_date),
    totalAmount: Number(data.total_amount ?? 0),
    customer: {
      userId: data.customer_id,
      // An OTP-VERIFIED profile phone outranks the booking's contact_phone:
      // contact_phone is client-supplied at booking time, so on its own it
      // would let an account direct branded SMS at an arbitrary number. With a
      // verified number on file, that number wins; otherwise the booking's
      // contact number is used (capped per-account in the service layer).
      phone:
        (customerProfile?.phone_verified && customerProfile?.phone)
          ? customerProfile.phone
          : data.contact_phone ?? customerProfile?.phone ?? null,
      optedIn: customerProfile?.sms_notifications_enabled ?? true,
    },
    owner: {
      userId: ownerRow?.profile_id ?? null,
      phone: pickPhone(ownerRow?.business_phone, ownerProfile?.phone),
      optedIn: ownerProfile?.sms_notifications_enabled ?? true,
    },
  };
}

function adminRequest(
  eventKey: string,
  eventType: string,
  message: string,
  ids: { bookingId?: string | null; hallId?: string | null } = {},
): NotificationRequest {
  return {
    eventKey,
    eventType,
    recipientType: "admin",
    recipientUserId: null,
    phone: getAdminNotificationPhone(),
    message,
    bookingId: ids.bookingId ?? null,
    hallId: ids.hallId ?? null,
    critical: true,
  };
}

/**
 * Fires SMS for one booking lifecycle event. Idempotent per (event, booking,
 * recipient) — safe to call from webhook redeliveries and re-run actions.
 *
 * opts.amount     — display rupees for payment messages (e.g. the advance paid)
 * opts.reason     — owner's rejection note, cancellation reason, …
 * opts.keySuffix  — extra dedupe entropy (e.g. the payment order id, so a
 *                   SECOND payment attempt's failure still notifies)
 */
export async function notifyBookingEvent(
  kind: BookingEventKind,
  bookingId: string,
  opts: { amount?: number; reason?: string | null; keySuffix?: string } = {},
): Promise<void> {
  try {
    const ctx = await loadBookingContext(bookingId);
    if (!ctx) return;

    const eventKey = `${kind}:${bookingId}${opts.keySuffix ? `:${opts.keySuffix}` : ""}`;
    const d: BookingSmsData = {
      bookingRef: bookingRef(bookingId),
      hallName: ctx.hallName,
      dateLabel: ctx.dateLabel,
      amountLabel: formatAmountForSms(opts.amount ?? ctx.totalAmount),
      // Free text (e.g. an owner's rejection note) is stripped of URLs, long
      // digit runs and handles before entering a branded SMS — phishing text
      // must not ride on "HALLNECT:" credibility.
      reason: sanitizeSmsFreeText(opts.reason),
    };

    const toCustomer = (message: string): NotificationRequest => ({
      eventKey, eventType: kind, recipientType: "customer",
      recipientUserId: ctx.customer.userId, phone: ctx.customer.phone,
      message, bookingId, hallId: ctx.hallId,
      critical: true, smsOptedIn: ctx.customer.optedIn,
    });
    const toOwner = (message: string): NotificationRequest => ({
      eventKey, eventType: kind, recipientType: "owner",
      recipientUserId: ctx.owner.userId, phone: ctx.owner.phone,
      message, bookingId, hallId: ctx.hallId,
      critical: true, smsOptedIn: ctx.owner.optedIn,
    });
    const toAdmin = (message: string) => adminRequest(eventKey, kind, message, { bookingId, hallId: ctx.hallId });

    const requests: NotificationRequest[] = [];
    switch (kind) {
      case "booking.requested":
        requests.push(
          toCustomer(customerTemplates.bookingRequested(d)),
          toOwner(ownerTemplates.newBooking(d)),
          toAdmin(adminTemplates.newBooking(d)),
        );
        break;
      case "booking.confirmed":
        requests.push(toCustomer(customerTemplates.bookingConfirmed(d)));
        break;
      case "booking.rejected":
        requests.push(
          toCustomer(customerTemplates.bookingRejected(d)),
          toAdmin(adminTemplates.bookingCancelled(d)),
        );
        break;
      case "booking.cancelled":
        requests.push(
          toCustomer(customerTemplates.bookingCancelled(d)),
          toOwner(ownerTemplates.bookingCancelled(d)),
          toAdmin(adminTemplates.bookingCancelled(d)),
        );
        break;
      case "payment.success":
        requests.push(
          toCustomer(customerTemplates.paymentSuccess(d)),
          toOwner(ownerTemplates.paymentReceived(d)),
          toAdmin(adminTemplates.paymentReceived(d)),
        );
        break;
      case "payment.failed":
        requests.push(
          toCustomer(customerTemplates.paymentFailed(d)),
          toAdmin(adminTemplates.paymentFailed(d)),
        );
        break;
      case "refund.initiated":
        requests.push(
          toCustomer(customerTemplates.refundInitiated(d)),
          toAdmin(adminTemplates.refundDue(d)),
        );
        break;
    }

    await dispatchAll(requests);
  } catch (e) {
    console.error("[notifications] notifyBookingEvent failed:", e instanceof Error ? e.message : e);
  }
}

/** Admin alert: a hall was submitted (creation or resubmission). Max 1/day/hall. */
export async function notifyHallSubmitted(hallId: string): Promise<void> {
  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;
    const { data: hall } = await db
      .from("halls")
      .select("name, hall_owners!owner_id(business_name)")
      .eq("id", hallId)
      .maybeSingle();
    if (!hall) return;

    const ownerName = hall.hall_owners?.business_name ?? "a venue owner";
    await dispatchAll([
      adminRequest(
        `hall.submitted:${hallId}:${todayInBusinessTz()}`,
        "hall.submitted",
        adminTemplates.newHall(hall.name ?? "Unnamed hall", ownerName),
        { hallId },
      ),
    ]);
  } catch (e) {
    console.error("[notifications] notifyHallSubmitted failed:", e instanceof Error ? e.message : e);
  }
}

/** Owner alert after an admin moderates their hall. */
export async function notifyHallModerated(
  hallId: string,
  action: "approved" | "rejected" | "suspended" | "unsuspended",
  reason?: string | null,
): Promise<void> {
  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;
    const { data: hall } = await db
      .from("halls")
      .select("name, hall_owners!owner_id(business_phone, profile_id, profiles!profile_id(phone, sms_notifications_enabled))")
      .eq("id", hallId)
      .maybeSingle();
    if (!hall) return;

    const ownerRow = hall.hall_owners ?? null;
    const hallName = hall.name ?? "your hall";
    const message =
      action === "approved" ? ownerTemplates.hallApproved(hallName)
      : action === "rejected" ? ownerTemplates.hallRejected(hallName, sanitizeSmsFreeText(reason))
      : action === "suspended" ? ownerTemplates.hallSuspended(hallName, sanitizeSmsFreeText(reason))
      : ownerTemplates.hallUnsuspended(hallName);

    // Minute-resolution key: a double-click resends nothing, but a SECOND
    // decision later the same day (reject → owner fixes → reject again with a
    // different reason) still notifies. A day-scoped key silently swallowed it.
    const decisionMinute = new Date().toISOString().slice(0, 16);
    await dispatchAll([{
      eventKey: `hall.${action}:${hallId}:${decisionMinute}`,
      eventType: `hall.${action}`,
      recipientType: "owner",
      recipientUserId: ownerRow?.profile_id ?? null,
      phone: pickPhone(ownerRow?.business_phone, ownerRow?.profiles?.phone),
      message,
      hallId,
      critical: true,
      smsOptedIn: ownerRow?.profiles?.sms_notifications_enabled ?? true,
    }]);
  } catch (e) {
    console.error("[notifications] notifyHallModerated failed:", e instanceof Error ? e.message : e);
  }
}

/** Owner alert when premium is activated/deactivated. NON-critical (respects the SMS preference). */
export async function notifyPremiumChanged(
  listingId: string,
  hallId: string,
  activated: boolean,
  planLabel: string,
): Promise<void> {
  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;
    const { data: hall } = await db
      .from("halls")
      .select("name, hall_owners!owner_id(business_phone, profile_id, profiles!profile_id(phone, sms_notifications_enabled))")
      .eq("id", hallId)
      .maybeSingle();
    if (!hall) return;

    const ownerRow = hall.hall_owners ?? null;
    const hallName = hall.name ?? "your hall";
    await dispatchAll([{
      eventKey: `premium.${activated ? "activated" : "deactivated"}:${listingId}:${todayInBusinessTz()}`,
      eventType: activated ? "premium.activated" : "premium.deactivated",
      recipientType: "owner",
      recipientUserId: ownerRow?.profile_id ?? null,
      phone: pickPhone(ownerRow?.business_phone, ownerRow?.profiles?.phone),
      message: activated
        ? ownerTemplates.premiumActivated(hallName, planLabel)
        : ownerTemplates.premiumDeactivated(hallName),
      hallId,
      critical: false,
      smsOptedIn: ownerRow?.profiles?.sms_notifications_enabled ?? true,
    }]);
  } catch (e) {
    console.error("[notifications] notifyPremiumChanged failed:", e instanceof Error ? e.message : e);
  }
}

/** Owner alert when an admin verifies/rejects their manual commission payment. */
export async function notifyCommissionVerification(
  paymentId: string,
  decision: "approve" | "reject",
  note?: string | null,
): Promise<void> {
  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;
    const { data: pay } = await db
      .from("owner_commission_payments")
      .select("commission_id, commissions(booking_id), hall_owners!owner_id(business_phone, profile_id, profiles!profile_id(phone, sms_notifications_enabled))")
      .eq("id", paymentId)
      .maybeSingle();
    if (!pay) return;

    const ownerRow = pay.hall_owners ?? null;
    const bId: string = pay.commissions?.booking_id ?? "";
    const d: BookingSmsData = {
      bookingRef: bId ? bookingRef(bId) : "—",
      hallName: "", dateLabel: "",
      reason: sanitizeSmsFreeText(note),
    };
    await dispatchAll([{
      eventKey: `commission.payment.${decision}:${paymentId}`,
      eventType: `commission.payment.${decision === "approve" ? "verified" : "rejected"}`,
      recipientType: "owner",
      recipientUserId: ownerRow?.profile_id ?? null,
      phone: pickPhone(ownerRow?.business_phone, ownerRow?.profiles?.phone),
      message: decision === "approve"
        ? ownerTemplates.commissionVerified(d)
        : ownerTemplates.commissionRejected(d),
      bookingId: bId || null,
      critical: true,
      smsOptedIn: ownerRow?.profiles?.sms_notifications_enabled ?? true,
    }]);
  } catch (e) {
    console.error("[notifications] notifyCommissionVerification failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Overdue sweep alerts: one SMS per newly-overdue commission to its owner
 * (max once/day per commission — a rejected resubmission can go overdue again)
 * plus one daily summary to the admin.
 */
export async function notifyCommissionsOverdue(commissionIds: string[]): Promise<void> {
  if (commissionIds.length === 0) return;
  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;
    // Chunked so EVERY overdue commission gets its owner alert — a slice-based
    // cap would silently starve ids beyond it forever (once marked overdue they
    // never re-enter the sweep's "newly overdue" set).
    const rows: Array<{ id: string; booking_id: string | null; hall_owners: unknown }> = [];
    for (let i = 0; i < commissionIds.length; i += 100) {
      const { data: chunk } = await db
        .from("commissions")
        .select("id, booking_id, hall_owners!hall_owner_id(business_phone, profile_id, profiles!profile_id(phone, sms_notifications_enabled))")
        .in("id", commissionIds.slice(i, i + 100));
      rows.push(...(chunk ?? []));
    }

    const today = todayInBusinessTz();
    const requests: NotificationRequest[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const c of rows as any[]) {
      const ownerRow = c.hall_owners ?? null;
      requests.push({
        eventKey: `commission.overdue:${c.id}:${today}`,
        eventType: "commission.overdue",
        recipientType: "owner",
        recipientUserId: ownerRow?.profile_id ?? null,
        phone: pickPhone(ownerRow?.business_phone, ownerRow?.profiles?.phone),
        message: ownerTemplates.commissionOverdue({
          bookingRef: bookingRef(c.booking_id ?? ""), hallName: "", dateLabel: "",
        }),
        bookingId: c.booking_id ?? null,
        critical: true,
        smsOptedIn: ownerRow?.profiles?.sms_notifications_enabled ?? true,
      });
    }
    requests.push(
      adminRequest(
        `commission.overdue.summary:${today}`,
        "commission.overdue",
        adminTemplates.commissionOverdue(commissionIds.length),
      ),
    );

    await dispatchAll(requests);
  } catch (e) {
    console.error("[notifications] notifyCommissionsOverdue failed:", e instanceof Error ? e.message : e);
  }
}

/** Admin alert: new support ticket. */
export async function notifyTicketCreated(ticketId: string, subject: string): Promise<void> {
  try {
    await dispatchAll([
      adminRequest(`ticket.created:${ticketId}`, "ticket.created", adminTemplates.supportTicket(subject)),
    ]);
  } catch (e) {
    console.error("[notifications] notifyTicketCreated failed:", e instanceof Error ? e.message : e);
  }
}
