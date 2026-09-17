// ─────────────────────────────────────────────────────────────────────────────
// lib/commission.ts — THE Hallnect commission rate. One number, one place.
//
// Hallnect charges ONE standard commission on every applicable booking:
//
//     commission = booking amount × 2.5%   (was 2% until 2026-09-17)
//
//       ₹10,000 → ₹250     ₹25,000 → ₹625     ₹50,000 → ₹1,250     ₹1,00,000 → ₹2,500
//
// It replaced an owner-selectable rate (1.5, 2, 2.5, 3, 3.5, 4, 4.5 or 5%, per
// hall) and an admin-editable platform default. Neither exists any more: no
// form, action, schema, API parameter or setting can choose a rate, so there is
// nothing for a customer, an owner, DevTools or a crafted request to change.
//
// WHERE IT APPLIES
//   • Direct booking — 2.5% of the FULL HALL PRICE, retained out of the customer's
//     advance (lib/booking-payment.ts calculateBookingPayment).
//   • Lead generation — 2.5% of the amount the venue confirms, billed to the
//     venue (lib/leads.ts calculateLeadCommission).
// Both call commissionPaiseOn() with this constant; neither accepts a rate.
//
// MONEY IS INTEGER PAISE. The rate is applied in basis points, as
// floor(paise × 250 / 10,000) — exact for every amount, rounding a fraction of
// a paisa DOWN so Hallnect never rounds in its own favour.
//
// NOT PUBLISHED. The rate is shown to signed-in owners and admins only — never
// on a public or customer page (business decision, 2026-09-17). The database
// mirror, public.standard_commission_percent(), is not callable by anon or
// authenticated (migration 0100).
//
// HISTORY IS NOT RECOMPUTED. Every booking and lead commission stores the rate
// and amount it was charged at (commission_rate / commission_amount). Readers
// show those snapshots; this constant only prices NEW bookings.
//
// Pure (lib/money.ts has no I/O). Owner and admin pages may display it.
// ─────────────────────────────────────────────────────────────────────────────

import { commissionPaiseOn, toPaise, PAISE_PER_RUPEE } from "@/lib/money";

/** The standard Hallnect commission, in percent (2.5 = 2.5%). */
export const STANDARD_COMMISSION_PERCENT = 2.5;

/** The same rate as a fraction (0.025), for anyone reading the business rule. */
export const COMMISSION_RATE = STANDARD_COMMISSION_PERCENT / 100;

/** How the rate is written wherever it is shown: "2.5%". */
export const COMMISSION_PERCENT_LABEL = `${STANDARD_COMMISSION_PERCENT}%`;

/**
 * The standard commission on a booking amount, in rupees.
 *
 *   calculateBookingCommission(100000)   → 2500
 *   calculateBookingCommission(12345.67) → 308.64   (30,864.175 paise, floored)
 *
 * The same integer-paise primitive both calculators use (commissionPaiseOn),
 * so this can never disagree with what a booking or a lead is actually charged.
 */
export function calculateBookingCommission(amountRupees: number): number {
  return commissionPaiseOn(toPaise(amountRupees), STANDARD_COMMISSION_PERCENT) / PAISE_PER_RUPEE;
}
