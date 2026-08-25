// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications/events.ts — business events → WhatsApp notifications
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
import type { WhatsAppTemplateKey } from "@/lib/notifications/whatsapp-templates";

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
  "profiles!profile_id(full_name, phone, whatsapp_notifications_enabled)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OwnerRow = any;

function ownerRecipient(ownerRow: OwnerRow) {
  return {
    userId: ownerRow?.profile_id ?? null,
    phone: pickPhone(ownerRow?.business_phone, ownerRow?.profiles?.phone),
    optedIn: ownerRow?.profiles?.whatsapp_notifications_enabled ?? true,
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
  | "refund.initiated";

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
      "profiles!customer_id(full_name, phone, phone_verified, whatsapp_notifications_enabled)"
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
      optedIn: customerProfile?.whatsapp_notifications_enabled ?? true,
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
 * Fires WhatsApp messages for one booking lifecycle event. Idempotent per
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
      templateKey: WhatsAppTemplateKey,
      templateVariables: Array<string | number | null | undefined>,
    ): NotificationRequest => ({
      eventKey, eventType: kind, recipientType: "customer",
      recipientUserId: ctx.customer.userId, phone: ctx.customer.phone,
      templateKey, templateVariables,
      bookingId, hallId: ctx.hallId,
      critical: true, optedIn: ctx.customer.optedIn,
    });

    const toOwner = (
      templateKey: WhatsAppTemplateKey,
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

      case "refund.initiated":
        requests.push(
          toCustomer("CUSTOMER_REFUND_INITIATED", [ctx.customer.name, ref, paidLabel]),
          toAdmin("Refund due", `Booking cancelled after payment for ${ctx.hallName}. Amount ${paidLabel}.`),
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
    let templateKey: WhatsAppTemplateKey;
    let templateVariables: Array<string | null>;
    switch (action) {
      case "approved":
        templateKey = "OWNER_HALL_APPROVED";
        templateVariables = [hallName];
        break;
      case "rejected":
        templateKey = "OWNER_HALL_REJECTED";
        templateVariables = [hallName, cleanReason ?? "Please review your listing details."];
        break;
      case "suspended":
        templateKey = "OWNER_ACCOUNT_UPDATE";
        templateVariables = [
          `${hallName} has been suspended.`,
          cleanReason
            ? `Reason: ${cleanReason}. Contact Hallnect support to resolve this.`
            : "Contact Hallnect support to resolve this.",
        ];
        break;
      default:
        templateKey = "OWNER_ACCOUNT_UPDATE";
        templateVariables = [
          `${hallName} has been restored.`,
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
      templateKey: "OWNER_ACCOUNT_UPDATE",
      templateVariables: activated
        ? [`Premium listing is active for ${hallName}.`,
           `Your ${planLabel} plan gives this hall priority placement in search results.`]
        : [`Premium listing has ended for ${hallName}.`,
           "Your hall remains listed with standard placement."],
      hallId,
      critical: false,
      optedIn: owner.optedIn,
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
      .select(`commission_id, commissions(booking_id), hall_owners!owner_id(${OWNER_EMBED})`)
      .eq("id", paymentId)
      .maybeSingle();
    if (!pay) return;

    const owner = ownerRecipient(pay.hall_owners);
    const bId: string = pay.commissions?.booking_id ?? "";
    const ref = bId ? bookingRef(bId) : "—";
    const cleanNote = sanitizeNotificationText(note);

    await dispatchAll([{
      eventKey: `commission.payment.${decision}:${paymentId}`,
      eventType: `commission.payment.${decision === "approve" ? "verified" : "rejected"}`,
      recipientType: "owner",
      recipientUserId: owner.userId,
      phone: owner.phone,
      templateKey: "OWNER_ACCOUNT_UPDATE",
      templateVariables: decision === "approve"
        ? [`Commission payment verified for booking ${ref}.`, "Thank you — nothing further is due."]
        : [`Commission payment for booking ${ref} could not be verified.`,
           cleanNote ? `Note: ${cleanNote}. Please submit it again.` : "Please submit it again."],
      bookingId: bId || null,
      critical: true,
      optedIn: owner.optedIn,
    }]);
  } catch (e) {
    console.error("[notifications] notifyCommissionVerification failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Overdue sweep alerts: one message per newly-overdue commission to its owner
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
        .select(`id, booking_id, hall_owners!hall_owner_id(${OWNER_EMBED})`)
        .in("id", commissionIds.slice(i, i + 100));
      rows.push(...(chunk ?? []));
    }

    const today = todayInBusinessTz();
    const requests: NotificationRequest[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const c of rows as any[]) {
      const owner = ownerRecipient(c.hall_owners);
      const ref = bookingRef(c.booking_id ?? "");
      requests.push({
        eventKey: `commission.overdue:${c.id}:${today}`,
        eventType: "commission.overdue",
        recipientType: "owner",
        recipientUserId: owner.userId,
        phone: owner.phone,
        templateKey: "OWNER_ACCOUNT_UPDATE",
        templateVariables: [
          `Commission for booking ${ref} is overdue.`,
          "Pay it from the Commissions page in your owner dashboard to avoid a settlement adjustment.",
        ],
        bookingId: c.booking_id ?? null,
        critical: true,
        optedIn: owner.optedIn,
      });
    }

    const adminPhone = await getAdminNotificationPhone();
    requests.push(
      adminAlert({
        adminPhone,
        eventKey: `commission.overdue.summary:${today}`,
        eventType: "commission.overdue",
        event: "Commissions overdue",
        details: `${commissionIds.length} commission${commissionIds.length === 1 ? " is" : "s are"} now overdue.`,
        reference: today,
      }),
    );

    await dispatchAll(requests);
  } catch (e) {
    console.error("[notifications] notifyCommissionsOverdue failed:", e instanceof Error ? e.message : e);
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

/** Admin alert: new support ticket. */
export async function notifyTicketCreated(ticketId: string, subject: string): Promise<void> {
  try {
    const adminPhone = await getAdminNotificationPhone();
    await dispatchAll([
      adminAlert({
        adminPhone,
        eventKey: `ticket.created:${ticketId}`,
        eventType: "ticket.created",
        event: "New support ticket",
        // A ticket subject is user-supplied text landing in a branded message —
        // sanitise it exactly like an owner's rejection note.
        details: sanitizeNotificationText(subject, 120) ?? "No subject",
        reference: `Ticket ${ticketId.slice(0, 8).toUpperCase()}`,
      }),
    ]);
  } catch (e) {
    console.error("[notifications] notifyTicketCreated failed:", e instanceof Error ? e.message : e);
  }
}
