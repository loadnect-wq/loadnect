# Hallnect — Cashfree Testing Guide

How to verify the payment flow end-to-end in **sandbox** before going live. This is a **launch blocker** — payments are the revenue path and have not been exercised end-to-end yet.

> Local note: Cashfree cannot reach `localhost`. Test on a Vercel preview deploy, or expose the app via a tunnel (e.g. ngrok) and use the tunnel URL for `notify_url`/`return_url`.

---

## Setup
1. `CASHFREE_ENV=sandbox`, `NEXT_PUBLIC_CASHFREE_ENV=sandbox`, with sandbox `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY`.
2. Cashfree dashboard → webhook `notify_url = https://<domain>/api/webhooks/cashfree`. Saving triggers a GET probe → endpoint returns 200.
3. Allow `<domain>` for `return_url`.

## Architecture being verified (server-authoritative)
- Order creation is **server-side only**; `CASHFREE_SECRET_KEY` never reaches the browser.
- Frontend receives only a `payment_session_id`.
- Amount is **recomputed server-side** from the booking's stored `total_amount` (advance = 25%); client cannot influence the charge.
- Booking is confirmed only after **server verification** (return-url verify and/or signed webhook), never on frontend "success" alone.

---

## Test 1 — Successful payment
1. As a logged-in customer, book an approved hall (future date, available slot).
2. Booking is created `pending_payment`; pay the advance with a Cashfree **sandbox success** card.
3. **Expected:**
   - [ ] Booking transitions `pending_payment → booking_requested`.
   - [ ] Availability for that hall/date/slot is blocked.
   - [ ] A `commissions` row is created (rate snapshot from `platform_settings`).
   - [ ] Amount charged == advance (not full total, not a client value).
   - [ ] Customer sees a success state; owner sees the booking request; admin sees payment + commission.

## Test 2 — Failed payment
1. Repeat with a sandbox **failure** card.
2. **Expected:**
   - [ ] Booking does NOT advance past `pending_payment`.
   - [ ] Availability NOT blocked; NO commission row.
   - [ ] Friendly message; no raw gateway codes leaked.

## Test 3 — User-dropped / cancelled
1. Open checkout, close it without paying.
2. **Expected:** booking stays `pending_payment` (recoverable until the 20-min expiry), then auto-cancels. No availability block, no commission.

## Test 4 — Webhook signature
- [ ] Valid signed event (correct `x-webhook-signature` + `x-webhook-timestamp`) → accepted, applied.
- [ ] **Invalid/absent signature → HTTP 401**, no processing.
- [ ] Webhook re-verifies order status against Cashfree's API — does NOT trust body amounts/status.

## Test 5 — Idempotency (duplicate webhook)
1. Redeliver the same `PAYMENT_SUCCESS` event (Cashfree dashboard → resend, or repeat the POST).
2. **Expected — no duplication:**
   - [ ] Payment update is status-guarded → no-op on repeat.
   - [ ] Booking transition guarded on old status → 0 rows on repeat.
   - [ ] Availability is an upsert on `(hall_id,date,slot)` → no double block.
   - [ ] Commission `booking_id` is UNIQUE → no duplicate commission.

## Test 6 — Logs & secrets
- [ ] Server logs show only event type + order id (no secrets/headers/PII).
- [ ] `CASHFREE_SECRET_KEY` absent from client bundle/network.

## Routes involved
- Order creation server action (`app/book/[slug]/actions.ts` → `lib/payments.ts` → `lib/cashfree.ts`).
- Webhook: `app/api/webhooks/cashfree/route.ts` (signature verify + idempotent apply).
- Return/status page performs the same server-side verification (so dev without a webhook still confirms).

## Go-live
Switch to production credentials + `CASHFREE_ENV=production` **only after** Tests 1–6 pass in sandbox. Re-point the production webhook + return URL allow-list to the prod domain.
