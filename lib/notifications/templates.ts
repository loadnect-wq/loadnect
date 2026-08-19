// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications/templates.ts — every SMS the platform sends (PURE).
//
// One place for all message copy so wording stays consistent and auditable.
// Templates receive structured data and return plain strings. Rules:
//   • Concise — these are SMS, not emails.
//   • NEVER include card numbers, OTPs, tokens, passwords, or credentials.
//   • Amounts are display rupees (the caller formats), dates pre-formatted.
//   • No "server-only" import: pure string functions, unit-testable standalone.
// ─────────────────────────────────────────────────────────────────────────────

export type BookingSmsData = {
  bookingRef: string;   // short reference (first 8 of the uuid, uppercased)
  hallName: string;
  dateLabel: string;    // pre-formatted via formatBookingDates()
  amountLabel?: string; // pre-formatted "₹1,50,000"
  reason?: string | null;
};

/** Short human booking reference from the uuid — full uuids waste SMS space. */
export function bookingRef(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** Rupee display for SMS: integer rupees with en-IN grouping. */
export function formatAmountForSms(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

// ── Customer ─────────────────────────────────────────────────────────────────

export const customerTemplates = {
  bookingRequested: (d: BookingSmsData) =>
    `HALLNECT: Your booking request for '${d.hallName}' (${d.dateLabel}) has been received. Booking ID: ${d.bookingRef}. We will notify you once the venue confirms.`,

  bookingConfirmed: (d: BookingSmsData) =>
    `HALLNECT: Your booking at '${d.hallName}' for ${d.dateLabel} is confirmed. Booking ID: ${d.bookingRef}. Please check your dashboard for details.`,

  bookingRejected: (d: BookingSmsData) =>
    `HALLNECT: Your booking request ${d.bookingRef} at '${d.hallName}' for ${d.dateLabel} was declined by the venue.${d.reason ? ` Reason: ${d.reason}.` : ""} Any payment made will be addressed by our team.`,

  bookingCancelled: (d: BookingSmsData) =>
    `HALLNECT: Your booking ${d.bookingRef} at '${d.hallName}' for ${d.dateLabel} has been cancelled.`,

  paymentSuccess: (d: BookingSmsData) =>
    `HALLNECT: Payment of ${d.amountLabel} for booking ${d.bookingRef} was successful.`,

  paymentFailed: (d: BookingSmsData) =>
    `HALLNECT: Payment for booking ${d.bookingRef} at '${d.hallName}' could not be completed. You can retry from your dashboard.`,

  refundInitiated: (d: BookingSmsData) =>
    `HALLNECT: Refund for booking ${d.bookingRef} has been initiated. Please check your payment account for the refund status.`,
};

// ── Owner ────────────────────────────────────────────────────────────────────

export const ownerTemplates = {
  newBooking: (d: BookingSmsData) =>
    `HALLNECT: Your hall '${d.hallName}' has received a new booking for ${d.dateLabel}. Booking ID: ${d.bookingRef}. Please check your dashboard for details.`,

  bookingCancelled: (d: BookingSmsData) =>
    `HALLNECT: Booking ${d.bookingRef} for '${d.hallName}' on ${d.dateLabel} has been cancelled.`,

  paymentReceived: (d: BookingSmsData) =>
    `HALLNECT: Payment received for booking ${d.bookingRef} at '${d.hallName}'. Amount: ${d.amountLabel}.`,

  hallApproved: (hallName: string) =>
    `HALLNECT: Your hall '${hallName}' has been approved and is now available to customers.`,

  hallRejected: (hallName: string, reason?: string | null) =>
    `HALLNECT: Your hall '${hallName}' requires changes before approval.${reason ? ` Reason: ${reason}.` : ""} Please check your Hallnect dashboard.`,

  hallSuspended: (hallName: string, reason?: string | null) =>
    `HALLNECT: Your hall '${hallName}' has been suspended.${reason ? ` Reason: ${reason}.` : ""} Please contact Hallnect support.`,

  hallUnsuspended: (hallName: string) =>
    `HALLNECT: Your hall '${hallName}' has been restored and is available to customers again.`,

  premiumActivated: (hallName: string, planLabel: string) =>
    `HALLNECT: Premium listing (${planLabel}) is now active for '${hallName}'. Your hall gets priority placement in search results.`,

  premiumDeactivated: (hallName: string) =>
    `HALLNECT: The premium listing for '${hallName}' has been deactivated. Contact Hallnect support with any questions.`,

  commissionOverdue: (d: BookingSmsData) =>
    `HALLNECT: Commission payment for booking ${d.bookingRef} is overdue. Please pay from your Commissions dashboard to avoid settlement adjustment.`,

  commissionVerified: (d: BookingSmsData) =>
    `HALLNECT: Your commission payment for booking ${d.bookingRef} has been verified. Thank you.`,

  commissionRejected: (d: BookingSmsData) =>
    `HALLNECT: Your commission payment submission for booking ${d.bookingRef} could not be verified.${d.reason ? ` Note: ${d.reason}.` : ""} Please re-submit from your dashboard.`,
};

// ── Admin ────────────────────────────────────────────────────────────────────

export const adminTemplates = {
  newBooking: (d: BookingSmsData) =>
    `HALLNECT ADMIN: New booking received for '${d.hallName}' on ${d.dateLabel}. Booking ID: ${d.bookingRef}.${d.amountLabel ? ` Booking value: ${d.amountLabel}.` : ""} Please check the admin dashboard.`,

  bookingCancelled: (d: BookingSmsData) =>
    `HALLNECT ADMIN: Booking ${d.bookingRef} for '${d.hallName}' has been cancelled.`,

  paymentReceived: (d: BookingSmsData) =>
    `HALLNECT ADMIN: Payment received for booking ${d.bookingRef}. Amount: ${d.amountLabel}.`,

  paymentFailed: (d: BookingSmsData) =>
    `HALLNECT ADMIN: Payment FAILED for booking ${d.bookingRef} at '${d.hallName}'. Check the payments dashboard.`,

  refundDue: (d: BookingSmsData) =>
    `HALLNECT ADMIN: Booking ${d.bookingRef} was cancelled after payment (slot conflict) — a refund is due. Check the payments dashboard.`,

  newHall: (hallName: string, ownerName: string) =>
    `HALLNECT ADMIN: New hall '${hallName}' submitted by ${ownerName}. Approval is required.`,

  commissionOverdue: (count: number) =>
    `HALLNECT ADMIN: ${count} commission payment${count === 1 ? " is" : "s are"} now overdue. Check the commissions dashboard.`,

  supportTicket: (subject: string) =>
    `HALLNECT ADMIN: New support ticket: "${subject.slice(0, 80)}". Please respond from the admin dashboard.`,
};
