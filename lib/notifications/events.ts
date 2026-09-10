// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications/events.ts — business events → SMS notifications
// (SERVER-ONLY).
//
// The single translation layer between "something happened" and "who gets
// which message". Call sites pass ENTITY IDS ONLY — every recipient phone
// number is resolved here from the database (booking → hall → owner → profile),
// never accepted from the client. A customer cannot make the platform message
// a number of their choosing, cannot pick the template, and cannot pick the
// sender: all three are decided here from server-side data.
//
// Every function is fire-safe: errors are logged and swallowed so the business
// action that triggered the event can never be failed by its notification.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizePhoneE164, sanitizeNotificationText, sanitizeName } from "@/lib/notifications/phone";

import { formatBookingDates, todayInBusinessTz } from "@/lib/dates";
import { bookingRef, formatAmount } from "@/lib/notifications/templates";
import {
  dispatchAll,
  getAdminNotificationPhone,
  type NotificationRequest,
} from "@/lib/notifications/service";
import { templateIdFor, type SmsTemplateKey } from "@/lib/notifications/sms-templates";

/**
 * First candidate that is actually a VALID phone number.
 *
 * The fallback chain used to be presence-based (`business_phone ?? phone`), so
 * an owner whose business_phone was malformed — e.g. a 9-digit number — had
 * every message routed to that dead value and never fell through to their valid
 * personal number. The owner then silently missed booking requests, which
 * auto-expire after 48 hours.
 */
function pickPhone(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    if (c && normalizePhoneE164(c)) return c;
  }
  return null;
}

/** Owner contact columns, selected identically everywhere an owner is notified. */
const OWNER_EMBED =
  "business_phone, business_name, profile_id, " +
  "profiles!profile_id(full_name, phone, notifications_enabled)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OwnerRow = any;

function ownerRecipient(ownerRow: OwnerRow) {
  return {
    userId: ownerRow?.profile_id ?? null,
    phone: pickPhone(ownerRow?.business_phone, ownerRow?.profiles?.phone),
    optedIn: ownerRow?.profiles?.notifications_enabled ?? true,
    // Owner-chosen text landing in a branded message — sanitised like any
    // other user-supplied string.
    name: sanitizeName(ownerRow?.business_name ?? ownerRow?.profiles?.full_name, "a venue owner"),
  };
}

/** Builds the single admin-alert request. `phone` is resolved by the caller. */
function adminAlert(input: {
  adminPhone: string | null;
  eventKey: string;
  eventType: string;
  event: string;
  details: string;
  reference: string;
  bookingId?: string | null;
  leadId?: string | null;
  hallId?: string | null;
}): NotificationRequest {
  return {
    eventKey: input.eventKey,
    eventType: input.eventType,
    recipientType: "admin",
    recipientUserId: null,
    phone: input.adminPhone,
    templateKey: "ADMIN_ALERT",
    templateVariables: [input.event, input.details, input.reference],
    bookingId: input.bookingId ?? null,
    leadId: input.leadId ?? null,
    hallId: input.hallId ?? null,
    critical: true,
  };
}

export type BookingEventKind =
  | "booking.requested"
  | "booking.confirmed"
  | "booking.rejected"
  | "booking.cancelled"
  | "payment.success"
  | "payment.failed"
  | "refund.initiated"
  | "refund.sent";

type BookingContext = {
  bookingId: string;
  hallId: string;
  hallName: string;
  dateLabel: string;
  totalAmount: number;
  customer: { userId: string; name: string; phone: string | null; optedIn: boolean };
  owner: { userId: string | null; name: string; phone: string | null; optedIn: boolean };
};

/**
 * Loads everything needed to notify about one booking in a single query.
 * Owner phone resolution: hall_owners.business_phone first (the number the
 * owner registered for their venue), falling back to their personal
 * profiles.phone. Customer phone: an OTP-verified profile number first, then
 * the booking's own contact_phone snapshot.
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
      `halls(name, owner_id, hall_owners!owner_id(${OWNER_EMBED})),` +
      "profiles!customer_id(full_name, phone, phone_verified, notifications_enabled)"
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (error || !data) {
    console.error("[notifications] booking context load failed:", error?.message ?? "not found");
    return null;
  }

  const hall = data.halls ?? {};
  const ownerRow = hall.hall_owners ?? null;
  const customerProfile = data.profiles ?? null;
  const owner = ownerRecipient(ownerRow);

  return {
    bookingId: data.id,
    hallId: data.hall_id,
    hallName: sanitizeName(hall.name, "your venue"),
    dateLabel: formatBookingDates(data.event_date, data.end_date),
    totalAmount: Number(data.total_amount ?? 0),
    customer: {
      userId: data.customer_id,
      name: sanitizeName(customerProfile?.full_name, "there"),
      // An OTP-VERIFIED profile phone outranks the booking's contact_phone:
      // contact_phone is client-supplied at booking time, so on its own it
      // would let an account direct branded messages at an arbitrary number.
      // With a verified number on file, that number wins; otherwise the
      // booking's contact number is used (capped per-account in the service).
      phone:
        (customerProfile?.phone_verified && customerProfile?.phone)
          ? customerProfile.phone
          : data.contact_phone ?? customerProfile?.phone ?? null,
      optedIn: customerProfile?.notifications_enabled ?? true,
    },
    owner: {
      userId: owner.userId,
      name: owner.name,
      phone: owner.phone,
      optedIn: owner.optedIn,
    },
  };
}

/**
 * Fires SMS messages for one booking lifecycle event. Idempotent per
 * (event, booking, recipient) — safe to call from webhook redeliveries and
 * re-run actions.
 *
 * opts.amount     — display rupees for payment messages. CONTRACT: for
 *                   payment.success / booking.requested this is the ADVANCE
 *                   ONLY (never advance + ₹200 platform fee — the venue-balance
 *                   arithmetic in balanceNote depends on it); for
 *                   refund.initiated it is the actual refund figure.
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

    const adminPhone = await getAdminNotificationPhone();
    const eventKey = `${kind}:${bookingId}${opts.keySuffix ? `:${opts.keySuffix}` : ""}`;

    const ref = bookingRef(bookingId);
    const paid = opts.amount ?? 0;
    const totalLabel = formatAmount(ctx.totalAmount);
    const paidLabel = formatAmount(paid);
    // Free text (e.g. an owner's rejection note) is stripped of URLs, long
    // digit runs and handles before entering a branded message — phishing text
    // must not ride on Hallnect's credibility.
    const reason = sanitizeNotificationText(opts.reason);

    const toCustomer = (
      templateKey: SmsTemplateKey,
      templateVariables: Array<string | number | null | undefined>,
    ): NotificationRequest => ({
      eventKey, eventType: kind, recipientType: "customer",
      recipientUserId: ctx.customer.userId, phone: ctx.customer.phone,
      templateKey, templateVariables,
      bookingId, hallId: ctx.hallId,
      critical: true, optedIn: ctx.customer.optedIn,
    });

    const toOwner = (
      templateKey: SmsTemplateKey,
      templateVariables: Array<string | number | null | undefined>,
    ): NotificationRequest => ({
      eventKey, eventType: kind, recipientType: "owner",
      recipientUserId: ctx.owner.userId, phone: ctx.owner.phone,
      templateKey, templateVariables,
      bookingId, hallId: ctx.hallId,
      critical: true, optedIn: ctx.owner.optedIn,
    });

    const toAdmin = (event: string, details: string) =>
      adminAlert({
        adminPhone, eventKey, eventType: kind, event, details,
        reference: `Booking ${ref}`, bookingId, hallId: ctx.hallId,
      });

    const requests: NotificationRequest[] = [];
    switch (kind) {
      case "booking.requested":
        requests.push(
          toCustomer("CUSTOMER_BOOKING_CREATED",
            [ctx.customer.name, ctx.hallName, ctx.dateLabel, totalLabel, ref]),
          toOwner("OWNER_NEW_BOOKING",
            [ctx.hallName, ctx.customer.name, ctx.dateLabel, ref,
             paid > 0 ? paidLabel : "Not yet paid", totalLabel]),
          toAdmin("New booking request",
            `${ctx.hallName} on ${ctx.dateLabel} for ${ctx.customer.name}. Value ${totalLabel}.`),
        );
        break;

      case "booking.confirmed":
        requests.push(
          toCustomer("CUSTOMER_BOOKING_CONFIRMED",
            [ctx.customer.name, ctx.hallName, ctx.dateLabel, ref]),
        );
        break;

      case "booking.rejected":
        requests.push(
          toCustomer("CUSTOMER_BOOKING_CANCELLED",
            [ctx.customer.name, ctx.hallName, ctx.dateLabel, ref,
             reason ? `Declined by the venue — ${reason}` : "Declined by the venue"]),
          toAdmin("Booking declined by venue",
            `${ctx.hallName} on ${ctx.dateLabel}.${reason ? ` Reason: ${reason}.` : ""}`),
        );
        break;

      case "booking.cancelled":
        requests.push(
          toCustomer("CUSTOMER_BOOKING_CANCELLED",
            [ctx.customer.name, ctx.hallName, ctx.dateLabel, ref,
             reason ? `Cancelled — ${reason}` : "Cancelled"]),
          toOwner("OWNER_BOOKING_CANCELLED", [ctx.hallName, ctx.dateLabel, ref]),
          toAdmin("Booking cancelled", `${ctx.hallName} on ${ctx.dateLabel}.`),
        );
        break;

      case "payment.success":
        requests.push(
          toCustomer("CUSTOMER_PAYMENT_SUCCESS",
            [ctx.customer.name, ctx.hallName, ref, paidLabel, balanceNote(paid, ctx.totalAmount)]),
          toOwner("OWNER_PAYMENT_RECEIVED", [ctx.hallName, ref, paidLabel]),
          toAdmin("Payment received", `${paidLabel} for ${ctx.hallName} on ${ctx.dateLabel}.`),
        );
        break;

      case "payment.failed":
        requests.push(
          toCustomer("CUSTOMER_PAYMENT_FAILED", [ctx.customer.name, ctx.hallName, ref]),
          toAdmin("Payment FAILED", `${ctx.hallName} on ${ctx.dateLabel}. Check the payments dashboard.`),
        );
        break;

      // A refund has been WORKED OUT and is owed. Admin only, deliberately:
      // nothing has been sent yet, and the approved customer template says a
      // refund "has been initiated" and lands in 5-7 working days. Telling a
      // customer that while the money is still sitting in Hallnect's account
      // starts a clock that nobody has actually started.
      case "refund.initiated":
        requests.push(
          toAdmin("Refund due", `Booking cancelled after payment for ${ctx.hallName}. Amount ${paidLabel} owed — action it in the payments dashboard.`),
        );
        break;

      // The money has genuinely left, so now the 5-7 day promise is true.
      case "refund.sent":
        requests.push(
          toCustomer("CUSTOMER_REFUND_INITIATED", [ctx.customer.name, ref, paidLabel]),
          toAdmin("Refund sent", `${paidLabel} refunded for ${ctx.hallName}.`),
        );
        break;
    }

    await dispatchAll(requests);
  } catch (e) {
    console.error("[notifications] notifyBookingEvent failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Whether anything remains payable. Stated explicitly rather than left implied,
 * because "Amount paid ₹7,350" against a ₹29,400 booking reads as a shortfall
 * unless the message says the rest is due at the venue.
 *
 * `paid` must be the ADVANCE only (fee-exclusive — see the opts.amount
 * contract): the ₹200 platform fee is not a rupee toward the hall total, and
 * including it would understate the venue balance by ₹200 on every message.
 */
function balanceNote(paid: number, total: number): string {
  const balance = Math.round((total - paid) * 100) / 100;
  if (!(paid > 0)) return "Your booking is not yet paid.";
  if (balance <= 0.5) return "Your booking is paid in full.";
  return `Balance ${formatAmount(balance)} is payable directly at the venue.`;
}

/**
 * A hall was submitted for review (creation or resubmission).
 * Notifies BOTH the admin (who must action it) and the owner (who otherwise
 * has no confirmation that their submission was received). Max 1/day/hall.
 */
/**
 * A booking was accepted but the owner's money could not be sent.
 *
 * This is the one failure in the whole pipeline that is otherwise SILENT and
 * costs a real person real money: the booking confirms, the customer is
 * charged, Hallnect holds the entire advance, and the owner is simply never
 * paid. `payments.split_status` records it, but nothing reads that column, so
 * without this alert nobody finds out until an owner complains.
 *
 * Deliberately admin-only. The owner is not told their payout failed, because
 * the fix is always on Hallnect's side (vendor onboarding, KYC, gateway) and a
 * "your money is stuck" message they cannot act on is worse than a quiet fix.
 */
// ── Lead generation ──────────────────────────────────────────────────────────

export type LeadEventKind = "lead.created" | "lead.confirmed" | "lead.rejected";

type LeadContext = {
  leadId: string;
  hallId: string;
  hallName: string;
  dateLabel: string;
  guestLabel: string;
  contactName: string;
  contactPhone: string | null;
  phoneVerified: boolean;
  customer: { userId: string; name: string; phone: string | null; optedIn: boolean };
  owner: { userId: string | null; name: string; phone: string | null; optedIn: boolean };
};

/**
 * Everything needed to notify about one lead, in a single query.
 *
 * Mirrors loadBookingContext, including the two-FK disambiguation on
 * hall_owners — PostgREST errors out without `!owner_id`.
 */
async function loadLeadContext(leadId: string): Promise<LeadContext | null> {
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  const { data, error } = await db
    .from("leads")
    .select(
      "id, hall_id, customer_id, event_date, guest_count, contact_name, contact_phone, phone_verified, " +
      `halls!hall_id(name, owner_id, hall_owners!owner_id(${OWNER_EMBED})),` +
      "profiles!customer_id(full_name, phone, phone_verified, notifications_enabled)",
    )
    .eq("id", leadId)
    .maybeSingle();

  if (error || !data) {
    console.error("[notifications] lead context load failed:", error?.message ?? "not found");
    return null;
  }

  const hall = data.halls ?? {};
  const customerProfile = data.profiles ?? null;

  return {
    leadId: data.id,
    hallId: data.hall_id,
    hallName: sanitizeName(hall.name, "your venue"),
    dateLabel: formatBookingDates(data.event_date, null),
    // "Not specified" rather than an empty slot: guest_count is optional on an
    // enquiry, and DLT operators drop messages with empty variables.
    guestLabel: data.guest_count == null ? "Not specified" : String(data.guest_count),
    contactName: sanitizeName(data.contact_name, "a customer"),
    contactPhone: data.contact_phone ?? null,
    phoneVerified: Boolean(data.phone_verified),
    customer: {
      userId: data.customer_id,
      name: sanitizeName(customerProfile?.full_name ?? data.contact_name, "there"),
      // THE ENQUIRY'S OWN NUMBER WINS HERE, unlike on a booking — and only
      // because it has been through MSG91. leads.contact_phone reaches
      // 'pending' status solely by verification (leads_forwarded_is_verified),
      // so by the time anything is sent it is a number this customer has
      // proved they hold. The profile phone is the fallback for the one message
      // that can precede verification.
      phone: data.phone_verified
        ? data.contact_phone
        : (customerProfile?.phone ?? data.contact_phone ?? null),
      optedIn: customerProfile?.notifications_enabled ?? true,
    },
    owner: ownerRecipient(hall.hall_owners ?? null),
  };
}

/**
 * Which template can actually carry a new-lead notification to the venue TODAY.
 *
 * ═══ THIS IS A DELIBERATE, TEMPORARY SUBSTITUTION ═══════════════════════════
 *
 * OWNER_NEW_LEAD is the right template and its body is written. It is not
 * DLT-approved yet, and in India an unapproved body is dropped by the operator
 * silently — so with it alone the venue learns nothing about an enquiry it is
 * being charged commission on.
 *
 * OWNER_ACCOUNT_STATUS *is* approved (MSG91 "HallnectAccount") and its
 * registered body is genuinely generic:
 *
 *   "Hallnect venue owner account update for your hall listing. Item: {#var#}.
 *    New status: {#var#}. Detail: {#var#}. Sign in to your owner dashboard to
 *    review it."
 *
 * A new enquiry on their listing IS an account update about their listing, and
 * the sentence ends by telling them exactly where to go — which is the action
 * we want. THE REGISTERED CONTENT IS UNCHANGED; only the variable values
 * differ, which is what variables are for. Nothing is sent that a DLT reviewer
 * did not approve.
 *
 * ═══ IT RETIRES ITSELF ══════════════════════════════════════════════════════
 *
 * There is no flag to remember and no cleanup ticket. The moment
 * MSG91_TEMPLATE_OWNER_NEW_LEAD is set, the first branch wins and the
 * substitution stops — permanently, everywhere, with no deploy. A temporary
 * measure that needs a human to end it is a permanent measure.
 *
 * ═══ WHAT IS NOT SUBSTITUTED, AND WHY ══════════════════════════════════════
 *
 * The CUSTOMER's side. Every approved customer template says "hall booking":
 * sending CUSTOMER_BOOKING_CONFIRMED for an enquiry would tell someone their
 * venue is CONFIRMED when they have only asked a question. That is not a
 * stretched fit, it is a false statement to a consumer about a wedding venue,
 * and the harm lands on the person least able to check it. The customer's
 * enquiry confirmation waits for DLT; their side of the flow already works
 * on-screen.
 *
 * Exported for tests — the branch that matters is the one nobody exercises.
 */
export function ownerLeadNotification(input: {
  hallName: string;
  contactName: string;
  dateLabel: string;
  guestLabel: string;
  contactPhone: string | null;
  ref: string;
}): {
  templateKey: SmsTemplateKey;
  templateVariables: Array<string | number | null | undefined>;
  substituted: boolean;
} {
  if (templateIdFor("OWNER_NEW_LEAD")) {
    return {
      templateKey: "OWNER_NEW_LEAD",
      templateVariables: [
        input.hallName, input.contactName, input.dateLabel,
        input.guestLabel, input.contactPhone ?? "Not available", input.ref,
      ],
      substituted: false,
    };
  }

  if (templateIdFor("OWNER_ACCOUNT_STATUS")) {
    // Each value is clamped to MAX_VARIABLE_LENGTH (60) downstream; these are
    // shaped to sit well inside it so nothing is truncated mid-phone-number.
    //
    // THE PHONE IS THE POINT. It is passed raw rather than through
    // sanitizeNotificationText, which strips runs of 7+ digits to stop a hall
    // name smuggling a phishing number into a branded message. Here the number
    // is not user-supplied prose — it is the verified contact this venue paid
    // a commission to receive, resolved server-side from the lead row.
    return {
      templateKey: "OWNER_ACCOUNT_STATUS",
      templateVariables: [
        `New enquiry for ${input.hallName}`,
        "Awaiting your reply",
        input.contactPhone
          ? `${input.contactName}, ${input.dateLabel}, call ${input.contactPhone}`
          : `${input.contactName}, ${input.dateLabel}, ref ${input.ref}`,
      ],
      substituted: true,
    };
  }

  // Neither is configured. Record against the REAL template so the admin
  // notification centre names the template that is actually missing, rather
  // than blaming a stand-in that was never going to be used.
  return {
    templateKey: "OWNER_NEW_LEAD",
    templateVariables: [
      input.hallName, input.contactName, input.dateLabel,
      input.guestLabel, input.contactPhone ?? "Not available", input.ref,
    ],
    substituted: false,
  };
}

/**
 * Notifies about a lead. `lead.created` is the moment the enquiry is FORWARDED
 * — i.e. after MSG91 confirmed the customer's number, never before.
 *
 * THE VERIFICATION GUARD IS RESTATED HERE. lib/leads.ts will not promote an
 * unverified lead, and RLS hides one from the venue, but this function reads
 * with the service role and sends SMS to a number a customer typed. So it
 * checks for itself: an unverified lead notifies nobody. Three independent
 * layers, because the failure this prevents is texting a stranger.
 *
 * Idempotent through the outbox: dedupe_key is `${kind}:${leadId}:${recipient}`
 * and carries a UNIQUE index, so a repeat call inserts nothing and sends
 * nothing. Fire-safe — a notification failure never fails the lead.
 */
export async function notifyLeadEvent(
  kind: LeadEventKind,
  leadId: string,
  opts: { reason?: string | null; amount?: number } = {},
): Promise<void> {
  try {
    const ctx = await loadLeadContext(leadId);
    if (!ctx) return;

    if (!ctx.phoneVerified) {
      console.error(`[notifications] refusing to notify unverified lead ${leadId}`);
      return;
    }

    const adminPhone = await getAdminNotificationPhone();
    const eventKey = `${kind}:${leadId}`;
    const ref = bookingRef(leadId);
    const reason = sanitizeNotificationText(opts.reason);

    const toCustomer = (statusNote: string): NotificationRequest => ({
      eventKey, eventType: kind, recipientType: "customer",
      recipientUserId: ctx.customer.userId, phone: ctx.customer.phone,
      templateKey: "CUSTOMER_LEAD_UPDATE",
      templateVariables: [ctx.customer.name, ctx.hallName, ctx.dateLabel, statusNote],
      leadId: ctx.leadId, hallId: ctx.hallId,
      critical: true, optedIn: ctx.customer.optedIn,
    });

    const requests: NotificationRequest[] = [];
    switch (kind) {
      case "lead.created":
        requests.push(
          {
            eventKey, eventType: kind, recipientType: "owner",
            recipientUserId: ctx.owner.userId, phone: ctx.owner.phone,
            // Picks OWNER_NEW_LEAD once it is DLT-approved, and the approved
            // generic owner template until then. See ownerLeadNotification.
            ...ownerLeadNotification({
              hallName: ctx.hallName,
              contactName: ctx.contactName,
              dateLabel: ctx.dateLabel,
              guestLabel: ctx.guestLabel,
              contactPhone: ctx.contactPhone,
              ref,
            }),
            leadId: ctx.leadId, hallId: ctx.hallId,
            critical: true, optedIn: ctx.owner.optedIn,
          },
          toCustomer("Sent to the venue"),
          adminAlert({
            adminPhone, eventKey, eventType: kind,
            event: "New venue enquiry",
            // Under MAX_VARIABLE_LENGTH (60) or DLT truncates the tail away.
            details: `${ctx.hallName} on ${ctx.dateLabel}`.slice(0, 58),
            reference: `Enquiry ${ref}`,
            leadId: ctx.leadId, hallId: ctx.hallId,
          }),
        );
        break;

      case "lead.confirmed":
        requests.push(
          toCustomer("Confirmed by the venue"),
          adminAlert({
            adminPhone, eventKey, eventType: kind,
            event: "Venue confirmed an enquiry",
            details: opts.amount
              ? `${ctx.hallName} for ${formatAmount(opts.amount)}`.slice(0, 58)
              : ctx.hallName.slice(0, 58),
            reference: `Enquiry ${ref}`,
            leadId: ctx.leadId, hallId: ctx.hallId,
          }),
        );
        break;

      case "lead.rejected":
        requests.push(
          toCustomer(reason ? `Declined by the venue - ${reason}` : "Declined by the venue"),
        );
        break;
    }

    await dispatchAll(requests);
  } catch (e) {
    console.error("[notifications] lead event failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Tells the admin a venue settled a lead commission.
 *
 * Its own function rather than a LeadEventKind because it is about a
 * COMMISSION, not a lead: it fires from the payment path, is keyed on the
 * commission id, and must stay idempotent across a webhook redelivery and the
 * owner refreshing the return page at the same moment.
 */
export async function notifyCommissionSettled(input: {
  commissionId: string;
  amount: number;
  hallName: string | null;
}): Promise<void> {
  try {
    const adminPhone = await getAdminNotificationPhone();
    await dispatchAll([
      adminAlert({
        adminPhone,
        eventKey: `commission.paid:${input.commissionId}`,
        eventType: "commission.paid",
        event: "Commission paid by a venue",
        details: `${formatAmount(input.amount)} from ${sanitizeName(input.hallName, "a venue")}`.slice(0, 58),
        reference: `Commission ${bookingRef(input.commissionId)}`,
      }),
    ]);
  } catch (e) {
    console.error("[notifications] commission settled alert failed:", e instanceof Error ? e.message : e);
  }
}

export async function notifyOwnerPayoutFailed(input: {
  bookingId: string;
  ownerAmount: number;
  reason: string;
}): Promise<void> {
  try {
    const adminPhone = await getAdminNotificationPhone();
    await dispatchAll([
      adminAlert({
        adminPhone,
        // Keyed on the booking, so repeated Accept attempts on the same
        // booking cannot fan out into a burst of identical alerts.
        eventKey: `payout.failed:${input.bookingId}`,
        eventType: "payout.failed",
        event: "Owner payout FAILED",
        details: sanitizeNotificationText(
          `₹${input.ownerAmount} could not be sent to the owner. ${input.reason}`,
          200,
        ) ?? "Owner payout failed",
        reference: `Booking ${input.bookingId.slice(0, 8).toUpperCase()}`,
        bookingId: input.bookingId,
      }),
    ]);
  } catch (e) {
    console.error("[notifications] notifyOwnerPayoutFailed failed:", e instanceof Error ? e.message : e);
  }
}

export async function notifyHallSubmitted(hallId: string): Promise<void> {
  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;
    const { data: hall } = await db
      .from("halls")
      .select(`name, hall_owners!owner_id(${OWNER_EMBED})`)
      .eq("id", hallId)
      .maybeSingle();
    if (!hall) return;

    const owner = ownerRecipient(hall.hall_owners);
    const hallName = sanitizeName(hall.name, "Unnamed hall");
    const adminPhone = await getAdminNotificationPhone();

    // Minute-resolution key, matching notifyHallModerated. A day-scoped key
    // silently swallowed the common recovery loop: admin rejects in the
    // morning, the owner fixes the listing and resubmits the same afternoon,
    // and nobody was told — the hall then sat unreviewed. A double-clicked
    // submit inside the same minute still dedupes, and the per-phone hourly
    // ceiling in the service layer is what caps deliberate resubmit spam.
    const submitMinute = new Date().toISOString().slice(0, 16);

    await dispatchAll([
      {
        eventKey: `hall.submitted:${hallId}:${submitMinute}`,
        eventType: "hall.submitted",
        recipientType: "owner",
        recipientUserId: owner.userId,
        phone: owner.phone,
        templateKey: "OWNER_HALL_SUBMITTED",
        templateVariables: [hallName],
        hallId,
        critical: true,
        optedIn: owner.optedIn,
      },
      adminAlert({
        adminPhone,
        eventKey: `hall.submitted:${hallId}:${submitMinute}`,
        eventType: "hall.submitted",
        event: "New hall submitted",
        details: `${hallName}, submitted by ${owner.name}. Approval required.`,
        reference: hallName,
        hallId,
      }),
    ]);
  } catch (e) {
    console.error("[notifications] notifyHallSubmitted failed:", e instanceof Error ? e.message : e);
  }
}

/** Owner alert after an admin moderates their hall. */
/**
 * An APPROVED hall's material details changed.
 *
 * Admin approval is a one-time gate: once a hall is live, an owner can edit its
 * name, address, capacity or pricing and the change publishes instantly with
 * nobody reviewing it. On a marketplace that is the shape of a bait-and-switch
 * — approved as one venue, live as another.
 *
 * This deliberately does NOT un-publish the hall. Sending an approved listing
 * back to pending for a typo fix would take a working venue off the site and
 * punish exactly the owners who keep their details current. Visibility for the
 * admin is the proportionate answer; if a listing turns out to have changed
 * into something else, suspending it is one click away.
 */
export async function notifyHallEdited(hallId: string, changed: string[]): Promise<void> {
  try {
    const adminPhone = await getAdminNotificationPhone();
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: hall } = await (admin as any)
      .from("halls").select("name").eq("id", hallId).maybeSingle();

    await dispatchAll([
      adminAlert({
        adminPhone,
        // Keyed to the hour so a burst of edits in one sitting is one alert,
        // not one per keystroke-save.
        eventKey: `hall.edited:${hallId}:${new Date().toISOString().slice(0, 13)}`,
        eventType: "hall.edited",
        event: "Live hall edited",
        details: sanitizeNotificationText(
          `${hall?.name ?? "A hall"} changed: ${changed.join(", ")}`, 180,
        ) ?? "A live hall was edited",
        reference: `Hall ${hallId.slice(0, 8).toUpperCase()}`,
        hallId,
      }),
    ]);
  } catch (e) {
    console.error("[notifications] notifyHallEdited failed:", e instanceof Error ? e.message : e);
  }
}

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
      .select(`name, hall_owners!owner_id(${OWNER_EMBED})`)
      .eq("id", hallId)
      .maybeSingle();
    if (!hall) return;

    const owner = ownerRecipient(hall.hall_owners);
    const hallName = sanitizeName(hall.name, "your hall");
    const cleanReason = sanitizeNotificationText(reason);

    // Approval and rejection get their own dedicated templates because they are
    // the two the owner acts on. Suspension/restoration reuse the general
    // account-update template rather than burning two more Meta approvals.
    let templateKey: SmsTemplateKey;
    let templateVariables: Array<string | null>;
    switch (action) {
      case "approved":
        templateKey = "OWNER_HALL_LIVE";
        templateVariables = [hallName];
        break;
      case "rejected":
        templateKey = "OWNER_HALL_REJECTED";
        templateVariables = [hallName, cleanReason ?? "Please review your listing details."];
        break;
      case "suspended":
        templateKey = "OWNER_ACCOUNT_STATUS";
        templateVariables = [
          hallName,
          "Suspended",
          cleanReason
            ? `${cleanReason}. Contact Hallnect support to resolve this.`
            : "Contact Hallnect support to resolve this.",
        ];
        break;
      default:
        templateKey = "OWNER_ACCOUNT_STATUS";
        templateVariables = [
          hallName,
          "Restored",
          "Your hall is visible to customers again.",
        ];
        break;
    }

    // Minute-resolution key: a double-click resends nothing, but a SECOND
    // decision later the same day (reject → owner fixes → reject again with a
    // different reason) still notifies. A day-scoped key silently swallowed it.
    const decisionMinute = new Date().toISOString().slice(0, 16);
    await dispatchAll([{
      eventKey: `hall.${action}:${hallId}:${decisionMinute}`,
      eventType: `hall.${action}`,
      recipientType: "owner",
      recipientUserId: owner.userId,
      phone: owner.phone,
      templateKey,
      templateVariables,
      hallId,
      critical: true,
      optedIn: owner.optedIn,
    }]);
  } catch (e) {
    console.error("[notifications] notifyHallModerated failed:", e instanceof Error ? e.message : e);
  }
}

/** Owner alert when premium is activated/deactivated. NON-critical (respects the preference). */
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
      .select(`name, hall_owners!owner_id(${OWNER_EMBED})`)
      .eq("id", hallId)
      .maybeSingle();
    if (!hall) return;

    const owner = ownerRecipient(hall.hall_owners);
    const hallName = sanitizeName(hall.name, "your hall");

    await dispatchAll([{
      eventKey: `premium.${activated ? "activated" : "deactivated"}:${listingId}:${todayInBusinessTz()}`,
      eventType: activated ? "premium.activated" : "premium.deactivated",
      recipientType: "owner",
      recipientUserId: owner.userId,
      phone: owner.phone,
      templateKey: "OWNER_ACCOUNT_STATUS",
      templateVariables: activated
        ? [`${planLabel} listing for ${hallName}`,
           "Active",
           `Your ${planLabel} plan gives this hall priority placement in search results.`]
        : [`${planLabel} listing for ${hallName}`,
           "Ended",
           "Your hall remains listed with standard placement."],
      hallId,
      critical: false,
      optedIn: owner.optedIn,
    }]);
  } catch (e) {
    console.error("[notifications] notifyPremiumChanged failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Re-resolves the recipient phone for an EXISTING outbox row.
 *
 * Why this exists: when an event fires and the recipient has no usable number,
 * the row is still written (status 'failed') so the gap is visible — and that
 * row permanently owns its dedupe key. Once the owner or customer adds a valid
 * number, a fresh dispatch is suppressed by that key and the row itself has no
 * phone to retry against, so the message was lost for good. That mattered most
 * for exactly the message an owner cannot afford to miss: a booking request
 * that auto-expires after 48 hours.
 *
 * The recipient is re-derived from the LINKED ENTITIES, never from anything a
 * caller supplies, so a repair cannot redirect a message.
 */
export async function resolveRecipientPhoneForNotification(input: {
  recipientType: "customer" | "owner" | "admin";
  bookingId: string | null;
  hallId: string | null;
}): Promise<string | null> {
  try {
    if (input.recipientType === "admin") return await getAdminNotificationPhone();

    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;

    if (input.bookingId) {
      const ctx = await loadBookingContext(input.bookingId);
      if (ctx) {
        return input.recipientType === "customer" ? ctx.customer.phone : ctx.owner.phone;
      }
    }

    // Hall-scoped events (submission, moderation, premium) carry no booking.
    if (input.recipientType === "owner" && input.hallId) {
      const { data: hall } = await db
        .from("halls")
        .select(`hall_owners!owner_id(${OWNER_EMBED})`)
        .eq("id", input.hallId)
        .maybeSingle();
      if (hall) return ownerRecipient(hall.hall_owners).phone;
    }

    return null;
  } catch (e) {
    console.error("[notifications] recipient re-resolve failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Admin alert: support tickets are waiting.
 *
 * ONE ALERT PER HOUR, NOT ONE PER TICKET. The key used to carry the ticket id,
 * which made it unique by construction and left the outbox's idempotency
 * nothing to collapse: every ticket was a billed SMS, and any signed-in account
 * can open tickets in a loop. Worse than the money, MAX_PER_PHONE_PER_HOUR (15)
 * in the service layer is shared with the alerts that genuinely need waking
 * someone up — a failed owner payout, a payment mismatch — so a ticket flood
 * would silence those for the rest of the hour.
 *
 * Same fix and the same reasoning as the contact form in
 * app/contact/actions.ts: bucket by UTC hour, and point the admin at the list
 * rather than at one ticket, because this SMS may now stand for several. The
 * dashboard is the record; the SMS is only the nudge. Nothing here is
 * customer-facing — the ticket itself is stored either way.
 */
export async function notifyTicketCreated(subject: string): Promise<void> {
  try {
    const adminPhone = await getAdminNotificationPhone();
    const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    await dispatchAll([
      adminAlert({
        adminPhone,
        eventKey: `ticket.created:${hourBucket}`,
        eventType: "ticket.created",
        event: "New support ticket",
        // A ticket subject is user-supplied text landing in a branded message —
        // sanitise it exactly like an owner's rejection note.
        details: sanitizeNotificationText(subject, 120) ?? "No subject",
        reference: "See all in /admin/support-tickets",
      }),
    ]);
  } catch (e) {
    console.error("[notifications] notifyTicketCreated failed:", e instanceof Error ? e.message : e);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION AND ACCOUNT EVENTS
//
// Added after a coverage review found 42 confirmed state changes that told
// nobody. These are the ones where silence costs money or trust:
//
//   • A standing monthly debit with no receipt. An owner on Pro is charged
//     Rs9,999 every month and the only record is an opaque Cashfree line on
//     their bank statement. That is what people charge back, and what a payment
//     regulator treats as an unauthorised recurring mandate.
//   • A mandate that stops collecting. The bank declines, Cashfree moves it to
//     ON_HOLD, the last paid month runs out, the sweep retires the listing, and
//     the owner discovers it as "my enquiries dried up". It is the one
//     subscription failure they can actually fix, and it was the one nobody
//     told them about.
//   • Money captured for something never delivered — reported to an admin who
//     can put it right by hand, because a console.error is not a person.
//
// Every message below uses OWNER_ACCOUNT_UPDATE or ADMIN_ALERT, both already
// Meta-approved and both designed for exactly this: two fixed-scaffold
// templates whose variables carry the specifics. No new template approval is
// needed, so these ship immediately rather than waiting on Meta.
// ═════════════════════════════════════════════════════════════════════════════

/** Loads a hall plus its owner in the shape ownerRecipient() expects. */
async function hallWithOwner(hallId: string) {
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;
  const { data } = await db
    .from("halls")
    .select(`name, hall_owners!owner_id(${OWNER_EMBED})`)
    .eq("id", hallId)
    .maybeSingle();
  return data ?? null;
}

/**
 * A monthly subscription debit succeeded — the sign-up charge and every renewal.
 *
 * Deduped on the CHARGE, not the day: two genuine charges in one day (rare, but
 * possible after a retry) must both be receipted, while a redelivered webhook
 * for the same charge must not send twice.
 */
export async function notifySubscriptionCharged(input: {
  chargeRef: string;
  hallId: string;
  planLabel: string;
  amount: number;
  paidUntil?: string | null;
}): Promise<void> {
  try {
    const hall = await hallWithOwner(input.hallId);
    if (!hall) return;
    const owner = ownerRecipient(hall.hall_owners);
    const hallName = sanitizeName(hall.name, "your hall");

    const until = input.paidUntil
      ? new Date(`${input.paidUntil}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
      : "See your premium page";

    await dispatchAll([{
      eventKey: `subscription.charged:${input.chargeRef}`,
      eventType: "subscription.charged",
      recipientType: "owner",
      recipientUserId: owner.userId,
      phone: owner.phone,
      templateKey: "OWNER_PAYMENT_RECEIPT",
      templateVariables: [
        formatAmount(input.amount),
        input.planLabel,
        hallName,
        until,
      ],
      hallId: input.hallId,
      // A receipt for money taken is critical: it must send even if the owner
      // has muted non-essential notifications.
      critical: true,
      optedIn: owner.optedIn,
    }]);
  } catch (e) {
    console.error("[notifications] notifySubscriptionCharged failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * The mandate stopped collecting — declined by the bank, paused, or cancelled.
 *
 * `critical` because this is the owner's cue to act: re-authorise, or accept
 * that the boost ends when the paid month runs out. Muting non-essential
 * messages should not cost them their placement.
 */
export async function notifySubscriptionStopped(input: {
  subscriptionId: string;
  hallId: string;
  planLabel: string;
  status: "on_hold" | "paused" | "cancelled" | "failed" | "completed";
  paidUntil?: string | null;
}): Promise<void> {
  try {
    const hall = await hallWithOwner(input.hallId);
    if (!hall) return;
    const owner = ownerRecipient(hall.hall_owners);
    const hallName = sanitizeName(hall.name, "your hall");

    const until = input.paidUntil
      ? `The month you have already paid for runs to ${new Date(`${input.paidUntil}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long" })}, then ${hallName} returns to standard placement.`
      : `${hallName} returns to standard placement when the paid period ends.`;

    const chosen = input.status === "cancelled";
    const detail = chosen
      ? `No further payments will be taken. ${until}`
      : `Your bank did not approve the automatic payment. ${until} To keep it running, set up billing again from Premium in your dashboard.`;

    await dispatchAll([{
      eventKey: `subscription.stopped:${input.subscriptionId}:${input.status}`,
      eventType: "subscription.stopped",
      recipientType: "owner",
      recipientUserId: owner.userId,
      phone: owner.phone,
      templateKey: "OWNER_ACCOUNT_STATUS",
      templateVariables: [
        `Monthly ${input.planLabel} billing for ${hallName}`,
        chosen ? "Cancelled" : "Payment failed",
        detail,
      ],
      hallId: input.hallId,
      critical: true,
      optedIn: owner.optedIn,
    }]);
  } catch (e) {
    console.error("[notifications] notifySubscriptionStopped failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Money was captured and the thing it paid for could not be delivered.
 *
 * Goes to the ADMIN, because the admin is the only party who can put it right
 * (grant the listing by hand from /admin/premium-listings). The owner is not
 * messaged: they have already been told on the status page that activation is
 * still in progress, and a second message saying "we took your money and
 * something went wrong" helps nobody until a human has looked.
 *
 * Same reasoning as notifyOwnerPayoutFailed: a recorded failure nobody reads is
 * still a silent failure.
 */
export async function notifyPlanChargeUnactivated(input: {
  purchaseId: string;
  hallId: string;
  planSlug: string;
  amount: number;
}): Promise<void> {
  try {
    const adminPhone = await getAdminNotificationPhone();
    const hall = await hallWithOwner(input.hallId);
    const hallName = sanitizeName(hall?.name, "a hall");

    await dispatchAll([
      adminAlert({
        adminPhone,
        eventKey: `plan.unactivated:${input.purchaseId}`,
        eventType: "plan.unactivated",
        event: "Plan paid but NOT activated",
        details:
          `${formatAmount(input.amount)} taken for ${input.planSlug} on ${hallName}, ` +
          `but the premium listing could not be created. The owner has paid and has nothing. ` +
          `Grant it by hand from Premium Listings.`,
        reference: `purchase ${input.purchaseId.slice(0, 8)}`,
        hallId: input.hallId,
      }),
    ]);
  } catch (e) {
    console.error("[notifications] notifyPlanChargeUnactivated failed:", e instanceof Error ? e.message : e);
  }
}

/** A generic operational alert to the admin. One call site per real condition. */
export async function notifyAdminOperational(input: {
  key: string;
  eventType: string;
  event: string;
  details: string;
  reference: string;
  hallId?: string | null;
  bookingId?: string | null;
}): Promise<void> {
  try {
    const adminPhone = await getAdminNotificationPhone();
    await dispatchAll([
      adminAlert({
        adminPhone,
        eventKey: input.key,
        eventType: input.eventType,
        event: input.event,
        details: input.details,
        reference: input.reference,
        hallId: input.hallId ?? null,
        bookingId: input.bookingId ?? null,
      }),
    ]);
  } catch (e) {
    console.error("[notifications] notifyAdminOperational failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * An owner-account decision an admin made: approved, verified, suspended or
 * restored.
 *
 * Suspension is the sharpest of these. requireAuth() bounces a deactivated
 * profile to /login?error=account_disabled, so the moment the flag flips the
 * owner is locked out of every owner page — while their halls stay live and any
 * pending booking request keeps counting down to auto-cancel, which they can no
 * longer answer. The admin is required to type a reason and it goes into an
 * audit log only admins can read. Being locked out with no explanation is the
 * worst version of that, so this one is always sent.
 */
export async function notifyOwnerAccountDecision(input: {
  profileId: string;
  kind: "approved" | "verified" | "suspended" | "restored";
  reason?: string | null;
}): Promise<void> {
  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;
    const { data: profile } = await db
      .from("profiles")
      .select("id, phone, full_name, notifications_enabled")
      .eq("id", input.profileId)
      .maybeSingle();
    if (!profile) return;

    const reason = input.reason?.trim();
    // [status, detail] — `status` fills the template's Status: line, so it is a
    // single plain word the owner can act on, not a sentence.
    const copy: Record<typeof input.kind, [string, string]> = {
      approved: [
        "Approved",
        "You can now list halls, manage booking requests and receive payouts. Open your owner dashboard to add your first hall.",
      ],
      // WAS: "Verified venues rank better and customers see a verified badge on
      // your listings." Both halves were false. fetchHalls orders on
      // premium_tier then rating_average and never reads is_verified, and
      // HallCard renders premium badges only — there is no verified badge for a
      // customer to see. Telling an owner their listing now ranks better is the
      // kind of promise they make decisions on. This says what the flag
      // actually is: an internal check an admin has completed.
      verified: [
        "Verified",
        "Your business details are confirmed on file. No action is needed from you.",
      ],
      suspended: [
        "Suspended",
        reason
          ? `${reason}. You will not be able to sign in until this is resolved. Reply to this message or email hallnect@gmail.com to appeal.`
          : "You will not be able to sign in until this is resolved. Please email hallnect@gmail.com and we will explain and help put it right.",
      ],
      restored: [
        "Restored",
        "You can sign in again and your listings are active. Thank you for your patience.",
      ],
    };

    const [status, detail] = copy[input.kind];

    await dispatchAll([{
      eventKey: `owner.account.${input.kind}:${input.profileId}:${todayInBusinessTz()}`,
      eventType: `owner.account.${input.kind}`,
      recipientType: "owner",
      recipientUserId: profile.id,
      phone: pickPhone(profile.phone, null),
      templateKey: "OWNER_ACCOUNT_STATUS",
      templateVariables: ["Your Hallnect owner account", status, detail],
      // Being told you are locked out, or that you may now trade, is never
      // "non-essential".
      critical: true,
      optedIn: profile.notifications_enabled ?? true,
    }]);
  } catch (e) {
    console.error("[notifications] notifyOwnerAccountDecision failed:", e instanceof Error ? e.message : e);
  }
}
