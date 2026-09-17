// ─────────────────────────────────────────────────────────────────────────────
// lib/ai/knowledge.server.ts — what the HallNect Assistant is allowed to know.
// SERVER-ONLY.
//
// NOT A SECOND COPY OF THE BUSINESS. Every number and name below is read from
// the constant or table the product itself uses — the platform fee from
// lib/booking-payment.ts, the refund table from lib/refund-schedule.ts, the
// plans from premium_plans, the advance from the payment settings RPC, the
// contact details from lib/constants.ts. Change the product and the assistant
// changes with it; nothing here has to be remembered.
//
// ROLE-GATED. The commission rate is not published (business decision,
// 2026-09-17): only a signed-in owner or an admin gets it. Everyone else is
// told that customers never pay a commission and that owners see the rate in
// their dashboard. The gate is applied HERE, before the text reaches the model,
// so no prompt can talk the model into repeating something it was never given.
//
// Kept as structured sections so an admin-managed knowledge source can later
// replace or extend individual sections without touching the route.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { CONTACT, SUPPORT_HOURS } from "@/lib/constants";
import { LAUNCH_CITIES } from "@/lib/content";
import { COMMISSION_PERCENT_LABEL } from "@/lib/commission";
import {
  platformFeeDisclosure,
  PLATFORM_FEE_MAX_PERCENT_OF_ADVANCE,
  PENDING_PAYMENT_TIMEOUT_MIN,
} from "@/lib/booking-payment";
import { CUSTOMER_REFUND_SCHEDULE } from "@/lib/refund-schedule";
import { getPublicPaymentSettings } from "@/lib/platform-settings";
import { fetchPremiumPlans, PLAN_FEATURES } from "@/lib/premium-plans";
import { formatPrice } from "@/lib/mock-data";

export type ChatRole = "guest" | "customer" | "owner" | "admin";

export function chatRoleFor(role: string | null | undefined): ChatRole {
  if (role === "admin") return "admin";
  if (role === "owner_approved" || role === "owner_pending") return "owner";
  if (role === "customer") return "customer";
  return "guest";
}

function refundScheduleText(): string {
  const tiers = [...CUSTOMER_REFUND_SCHEDULE];
  return tiers
    .map((t, i) => {
      const next = tiers[i - 1];
      const window = next
        ? `${t.minDaysBeforeEvent}–${next.minDaysBeforeEvent - 1} days before the event`
        : `${t.minDaysBeforeEvent} or more days before the event`;
      return `${window}: ${t.percentOfAdvance}% of the advance`;
    })
    .join("; ");
}

async function plansText(): Promise<string> {
  const plans = await fetchPremiumPlans();
  return plans
    .map((p) => {
      const price = p.monthly_price > 0 ? `${formatPrice(p.monthly_price)} per month, per hall` : "free";
      const features = (PLAN_FEATURES[p.slug] ?? []).map((f) => f.label).join(", ");
      return `- ${p.name} (${price})${features ? `: ${features}` : ""}`;
    })
    .join("\n");
}

/** The factual knowledge block for one request, for one role. */
export async function buildKnowledge(role: ChatRole): Promise<string> {
  const [settings, plans] = await Promise.all([getPublicPaymentSettings(), plansText()]);
  const advance = settings.defaultAdvancePercentage;
  const ownerOrAdmin = role === "owner" || role === "admin";

  const sections: string[] = [];

  sections.push(`## About HallNect
- HallNect (legal name ${CONTACT.legalName}) is a marketplace for wedding halls and event venues in Tamil Nadu, India. Customers discover venues and book or enquire; venue owners list their halls.
- Cities with launch coverage: ${LAUNCH_CITIES.join(", ")}. The live catalogue is whatever the hall search tool returns — do not assume a city has halls.
- Venue types: wedding, reception, party, banquet.
- Reviews are shown only where real customers have left them. Never state a rating that the tools did not return.`);

  sections.push(`## Two kinds of venue (booking modes)
- Direct Booking: the customer books online. They pick dates (up to 4 days) and a slot (morning, evening or full day; multi-day bookings are full days), pay an advance online, and the balance directly to the venue.
- Lead Generation (shown as "Send Enquiry"): the customer sends a free enquiry and verifies their mobile number with a one-time password (OTP). Only after that verification is the enquiry passed to the venue, which contacts the customer to agree the date and price. The customer pays HallNect nothing for these venues.
- A hall's page shows which mode it uses. The hall details tool returns the mode.`);

  sections.push(`## Booking a Direct Booking venue
1. Open the hall's page and choose "Book Now".
2. Choose date(s), slot, event type, guest count and a mobile number, then review the price summary.
3. Accept the booking terms and pay online through Cashfree (card, UPI or net banking). Hallnect never asks for card numbers, CVV, UPI PIN or OTPs in chat.
4. The slot is held for ${PENDING_PAYMENT_TIMEOUT_MIN} minutes while payment is completed.
5. A booking is confirmed only after the payment is verified on HallNect's server AND the venue accepts it. The venue has 48 hours to accept; if it does not respond, the booking is cancelled automatically and the customer is refunded in full, including the platform fee.
- Online payment is currently ${settings.enableOnlineCustomerPayment ? "enabled" : "switched off; customers submit a booking request and HallNect arranges payment with them"}.
- Customers track bookings under My Bookings (/customer/bookings) and enquiries under My Enquiries (/customer/enquiries).`);

  sections.push(`## What a customer pays (Direct Booking)
- An advance of ${advance}% of the hall price, paid online.
- Plus a ${platformFeeDisclosure()}. On a small booking the fee is capped at ${PLATFORM_FEE_MAX_PERCENT_OF_ADVANCE}% of the advance, so it can be less. A valid promo code can waive it. The exact amount is always shown before payment.
- The remaining balance is paid directly to the venue.
- Customers are never charged a commission. Nothing else is added by HallNect.`);

  sections.push(`## Cancellation and refunds
- If the customer cancels, the refund of the ADVANCE depends on how far ahead the event is — ${refundScheduleText()}. The platform fee and its GST are not refunded on a customer cancellation.
- If the venue declines, cancels, or does not respond within 48 hours, the customer is refunded the full advance AND the platform fee.
- Full details: Refund Policy (/refund-policy) and Cancellation Policy (/cancellation-policy).`);

  sections.push(`## Accounts and sign-in
- Customers sign in with Google or with their mobile number and a one-time password (OTP) at /login. New users can register at /signup.
- OTP problems: check the number (10-digit Indian mobile), wait for the resend timer before asking again, check network/SMS signal and DND settings, and after repeated failures wait a few minutes before retrying. Never share an OTP with anyone, including HallNect support or this assistant.
- Customer dashboard (/customer): bookings, enquiries, saved halls, reviews, notifications, profile, and support tickets.`);

  sections.push(`## For venue owners
- Joining: go to List Your Hall (/owner/register) and continue with Google. The owner account is ready straight away; listing is free.
- Adding a hall: from the owner dashboard, add the hall with photos, capacity, pricing, address, amenities and the booking mode. Every hall is reviewed by the HallNect team for completeness before it goes live; HallNect does not visit venues.
- Direct Booking halls: requests arrive with date, customer and amount; the owner accepts or declines within 48 hours. HallNect collects the advance, keeps its commission out of that advance and pays the rest to the owner; the balance is collected by the owner at the venue. Bank account details and PAN are needed only to receive payouts.
- Lead Generation halls: verified enquiries appear under Enquiries. The owner contacts the customer, agrees the price, then confirms the enquiry with the agreed amount. That raises a commission the owner pays from the Commissions page.
- Owner dashboard sections: Dashboard, My Halls (details, photos, availability calendar), Bookings, Enquiries, Revenue, Commissions, Premium, Notifications, Support, Profile.
- Commission: ${ownerOrAdmin
    ? `one standard rate of ${COMMISSION_PERCENT_LABEL} of the hall price (Direct Booking) or of the agreed amount (Lead Generation), the same for every venue. It is shown on the owner's hall form, Commissions and Revenue pages. Never quote a payout figure for a specific booking unless the owner's own records are available; point them to Revenue and Commissions.`
    : `HallNect charges venue owners one standard commission, the same for every venue. The rate is shown to owners inside their dashboard after they sign in — do NOT state a percentage or estimate one. Customers never pay it.`}`);

  sections.push(`## Premium listing plans for owners (live prices)
${plans}
- Plans are monthly subscriptions per hall, managed at Owner Dashboard → Premium; cancelling stops future charges, months already paid are not refunded.
- HallNect sometimes grants complimentary plans at its discretion; never present that as something an owner can expect.
- Plan overview page: /premium.`);

  sections.push(`## Support
- Email: ${CONTACT.email}. Phone: ${CONTACT.phone}. Hours: ${SUPPORT_HOURS.label}.
- Contact form: /contact. Signed-in users can also raise a support ticket from their dashboard.`);

  return sections.join("\n\n");
}
