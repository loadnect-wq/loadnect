# Hallnect — "Not Available" / Dead-State Fix Report

**Date:** 2026-06-28

## The one real blocker: payment-gated booking
**Before:** the booking flow's final step required Cashfree. With Cashfree unconfigured, `createPaymentSession` returned "Online payments are temporarily unavailable", so customers **could not complete a booking** — a launch blocker.

**Fixed:** booking flow now runs in **manual request mode** when Cashfree is off (see `CASHFREE_LATER_SETUP.md`):
- Step 4 shows "Submit booking request" (not "Pay the advance").
- CTA: **Submit Booking Request** → creates `booking_requested` with no payment.
- Success copy: "Your booking request has been submitted. Hallnect will contact you for confirmation and payment."
- Owner + admin see the request in their dashboards.

Files: `app/book/[slug]/page.tsx`, `app/book/[slug]/_components/BookingFlow.tsx`, `app/book/[slug]/actions.ts` (new `submitManualBookingRequest`).

## `/pricing` 404 → fixed
The pricing page lives at `/premium`; `/pricing` 404'd. Added `app/pricing/page.tsx` → redirects to `/premium` (which shows Free ₹0 / Pro ₹4,999 / Elite ₹9,999).

## Other "Cashfree" / "coming soon" mentions — reviewed, not blockers
| Location | Verdict |
|---|---|
| `/admin/payments` | Informational header ("Cashfree payment transactions, read-only") + empty list. Correct for manual mode — admin sees no payments yet. Not broken. |
| `/admin/settings` | Shows a config row "Payment gateway: Cashfree". Informational. Not broken. |
| `/booking/[id]/status` | Cashfree return/verify page — customers don't reach it in manual mode (they land on the Done step → /customer/bookings). Inert. |
| Pricing "WhatsApp lead notifications (coming soon)" | Intentional, honest "coming soon" label on an unimplemented feature. Kept. |
| Legal pages / errors.ts "not configured" strings | Internal/safe messages, not user-facing dead pages. |

## Required pages — none show a blocking "not available"
All public, customer, owner, and admin routes render (200) or redirect cleanly (private → login). Verified via route sweep: every required route resolves; `/pricing` redirects to `/premium`; non-existent hall slug → branded not-found.
