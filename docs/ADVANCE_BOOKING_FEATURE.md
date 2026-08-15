# Advance Booking Feature

**Status:** Implemented (2026-08-15). Works with or without Cashfree.

## What it does
The customer booking flow (`app/book/[slug]/_components/BookingFlow.tsx`) collects
date → slot → event details → **price summary + terms** → pay/submit. The summary
step now shows, all computed **server-side**:

- Hall base price
- Platform fee (%)
- Total
- **Advance payable now** (25% of total)
- **Remaining balance** (total − advance)
- Advance terms, cancellation & refund terms (with policy links)
- A mandatory **"I agree to the booking, cancellation, and remaining balance terms"** checkbox

The **Continue** button is disabled until the checkbox is ticked, and the server
(`createBookingRequest` in `app/book/[slug]/actions.ts`) **re-verifies** acceptance
(`input.termsAccepted === true`) — the client cannot bypass it. Acceptance is stored
on the booking (`terms_accepted`, `terms_accepted_at`).

## Online vs manual mode
- **Cashfree configured** → customer pays the advance via Cashfree checkout; on
  verified success the booking becomes `payment_success` and a commission record
  is written (`lib/payments.ts`).
- **Cashfree NOT configured** → manual mode: `createBookingRequest` creates a
  `pending_payment` booking, then `submitManualBookingRequest` promotes it to
  `booking_requested`. The UI shows "Online payment is coming soon…". No crash.

## Where it shows
- **Customer:** `/customer/bookings` (status + amounts).
- **Owner:** `/owner/bookings` (incoming requests / paid bookings).
- **Admin:** `/admin/bookings` and `/admin/payments`.

## Statuses
The existing `booking_status` enum is reused (`pending_payment`, `payment_success`,
`booking_requested`, `owner_confirmed`, `owner_rejected`, `cancelled`, `completed`,
`refunded`). The brief's suggested names map onto these; we did **not** rename the
enum to avoid breaking the state-machine trigger (`validate_booking_transition`) and
the double-booking guards. See `PAYMENT_SECURITY_NOTES.md`.

## Server-side safety
- Advance, platform fee, remaining balance, and total are recomputed from the DB
  hall record and `platform_settings` — never trusted from the client.
- `customer_id` comes from the session, never the form.
- Double-booking prevented by the partial unique index + overlap trigger (unchanged).

## Not yet done / manual test
- Live Cashfree advance E2E needs sandbox keys + a logged-in customer.
- See `FINAL_PAYMENT_FEATURE_TEST_REPORT.md` for the full manual checklist.
