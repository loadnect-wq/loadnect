# Hallnect — Enabling Cashfree Later

Hallnect launches **without** Cashfree. The booking flow runs in **manual request mode** until you attach Cashfree. Nothing crashes when the Cashfree env vars are missing.

## How "no Cashfree" behaves today
- `isCashfreeConfigured()` (`lib/cashfree.ts`) returns **false** when `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` are absent — it **never throws**.
- The booking page (`app/book/[slug]/page.tsx`) passes `onlinePaymentEnabled={isCashfreeConfigured()}` to the booking flow.
- When false, the flow's final step becomes **"Submit Booking Request"** instead of "Pay with Cashfree":
  - The customer's booking is created and promoted to **`booking_requested`** with **no payment** (server action `submitManualBookingRequest`).
  - The customer sees: *"Your booking request has been submitted. Hallnect will contact you for confirmation and payment."*
  - The **owner** sees it in `/owner/bookings`; the **admin** sees it in `/admin/bookings`.
- Cashfree server routes/code remain in place but are inert:
  - `createPaymentSession` returns a safe generic error if called without config (no secret leak).
  - `/api/webhooks/cashfree` still verifies signatures (fail-closed 401) — harmless with no traffic.
- **No secret is ever exposed to the browser** (`lib/cashfree.ts` is `import "server-only"`).

## Manual booking → confirmation flow (no payment)
1. Customer submits a booking request on an approved hall.
2. Booking status = `booking_requested` (slot reserved by the partial unique index; double-booking still prevented).
3. Owner reviews in their dashboard → confirms (`owner_confirmed`) or rejects (`owner_rejected`).
4. You collect payment offline and mark completion as your process dictates.

## When you're ready to enable Cashfree
1. Get **sandbox** credentials from the Cashfree dashboard.
2. In **Vercel → Settings → Environment Variables** add:
   - `CASHFREE_APP_ID`
   - `CASHFREE_SECRET_KEY`
   - `CASHFREE_ENV` = `sandbox` (later `production`)
   - `NEXT_PUBLIC_CASHFREE_ENV` = `sandbox` (later `production`)
3. **Redeploy without build cache** (`NEXT_PUBLIC_*` are inlined at build time).
4. Set the webhook `notify_url` = `https://<domain>/api/webhooks/cashfree` and allow `<domain>` for `return_url` in the Cashfree dashboard.
5. The booking flow automatically switches back to **online payment** (the "Submit Booking Request" CTA becomes "Pay … with Cashfree") — no code change needed.
6. Test per `docs/CASHFREE_TESTING_GUIDE.md` (success / failure / webhook / idempotency) in sandbox before going production.

## Safety guarantees
- No runtime crash from missing `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY`.
- Manual mode never marks a booking as paid — it only creates a **request**.
- Cashfree secret stays server-only; the browser only ever receives a `payment_session_id` (when payments are on).
