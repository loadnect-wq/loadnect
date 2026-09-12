# Hallnect — Production Security Checklist

**As of:** 12 September 2026 · verified against production unless marked otherwise.

`[x]` verified during this assessment · `[ ]` outstanding · `[~]` partial, with
the gap named.

---

## 1. Blocking — do these before taking real customers

- [ ] **`CONTACT_IP_SALT` set in Vercel** (Production, Preview, Development).
      Until it is, the contact form's per-sender rate limit is dormant and only
      the platform-wide backstop applies. See `REMEDIATION-PLAN.md` §1.1.
- [x] **Password sign-in removed** — AUTH-4 is closed by deletion rather than
      by building recovery. No account in this product ever had a password set
      (checked: 0 of 4 in `auth.users`), the field implied a reset flow that did
      not exist, and there is now no credential in the product that cannot be
      recovered. Sign-in is Google or a mobile number; both create an account on
      first use, so `/signup` redirects to `/login`.
- [x] **Custom SMTP no longer needed.** It had exactly two consumers and both
      are gone with the email option: the sign-in link and the password-signup
      confirmation. Everything else — booking updates, enquiry alerts, owner
      notifications, OTP — is SMS over MSG91 and always has been. Tax invoices
      record a `recipient_email` and nothing has ever sent one. If email is ever
      wanted again, the provider settings are preserved in git history at
      commit `8a1b164`.

- [ ] **2-Step Verification on the admin Google account.** One account can
      change the commission rate, approve venues, issue refunds and release
      payouts. Half an hour, and the largest single risk reduction available.
- [ ] **One end-to-end paid booking on the Cashfree sandbox**, confirming the
      booking reaches `booking_requested`, the payment reaches
      `payment_success`, the tax invoice is issued exactly once, and the
      availability row appears. Both booking outages found in this assessment
      were invisible from outside; this is the test that catches them.
- [ ] **Verified Cashfree payout beneficiary**, then **change the bank account
      and re-register**, confirming dispatch refuses until the new destination
      is registered. Direct Booking only.
- [ ] **DLT approval for `OWNER_NEW_LEAD` and `CUSTOMER_LEAD_UPDATE`.**
      Not security; an outstanding launch dependency.

---

## 2. Authentication and sessions

- [x] Supabase Auth with email/password and Google OAuth; no custom credential handling
- [x] Role held in `profiles.role`, locked by the `prevent_role_change` trigger **and** the `profiles_update` policy
- [x] OAuth callback validates `next` — must start with `/`, rejects `//` and `/\`
- [x] Session cookies `Secure` and `SameSite=Lax`
- [x] `requireAuth()` enforces `profiles.is_active` on every role-gated page
- [x] **Suspension now enforced in the database**, not only in the app — restrictive write policies on all seven client-writable tables (migration 0081). A banned user's in-hand access token can no longer write, including straight to PostgREST
- [x] Suspended users can reach `/login` and see why (the redirect loop is fixed)
- [x] Maintenance routes require an **active** admin, from the same origin
- [~] Signup role is client-supplied metadata — `owner` yields `owner_approved` by design, `admin` is rejected, and listing still needs admin approval. Accepted
- [~] Session cookies are not `HttpOnly` — the Supabase SSR default. Accepted; revisit with the nonce CSP
- [x] No password credential exists at all — the field was removed rather than given a reset flow (see §1)
- [ ] No MFA on the single admin account (see §1)

---

## 3. Authorisation, RLS and grants

- [x] RLS enabled on **all 37 tables**; 71 policies captured and reviewed verbatim
- [x] All 28 `SECURITY DEFINER` functions reviewed for `search_path` and EXECUTE grants
- [x] Guard triggers are `SECURITY INVOKER` — inside a `DEFINER` function `current_user` becomes the owner, `is_trusted_backend()` returns true, and the guard would never fire. One migration in this engagement was caught making exactly that mistake, by its own verification block
- [x] **`TRUNCATE` revoked from `anon` and `authenticated` across the whole schema**, plus default privileges so a table added tomorrow starts closed (migration 0079). RLS does not filter TRUNCATE at all
- [x] `support_tickets` privileged columns guarded on INSERT and UPDATE (0076)
- [x] `profiles` write surface narrowed to the columns the product actually writes; `email`, `created_at`, `updated_at` and `id` no longer client-writable (0084)
- [x] `contact_messages` UPDATE narrowed to `is_read`; `anon` loses select and update (0082)
- [x] `hall_owners` payout destination columns are service-role only (0068), and `payout_beneficiary_digest` joins them (0080)
- [x] `halls.commission_rate` hidden from the session client (0072)
- [x] Owner role gate on every action that reaches Cashfree Payouts
- [x] Admin role changes refuse to act on another admin account

> **The rule this schema keeps re-learning:** a column-level `REVOKE` cannot
> narrow a table-level `GRANT`. Three migrations here failed their own
> verification on exactly that. When narrowing, drop the table grant and
> re-grant the columns; check with `has_column_privilege`, never
> `has_table_privilege`.

---

## 4. Payments

- [x] Every apply path re-reads the order from Cashfree — client-reported status is never trusted
- [x] Captured amount compared against the stored amount (±₹0.50)
- [x] `cashfree_order_id` unique; status-guarded claims make replays no-ops
- [x] Webhook signature is `Base64(HMAC-SHA256(timestamp + rawBody, secret))`, compared with `timingSafeEqual`, verified **before** the body is parsed
- [x] Webhook returns 503 on `error` / `unactivated` / `unsettled` so Cashfree retries
- [x] **Rejected webhook signatures are now logged** — presence and length only, never the forged body
- [x] Commission and fee amounts computed server-side; never accepted from the client
- [x] Commission snapshots immutable after creation
- [x] **A captured payment whose booking never transitioned now heals on retry** instead of being swept away with no refund record
- [x] **Refund ids are keyed on the payment**, so both captures on a double-charged booking can be refunded
- [x] Coupon caps enforced at the moment of redemption, not only at insert
- [x] Booking totals, the fee cap and the database floor now agree (0077, 0078)
- [~] No webhook timestamp-freshness window. Accepted: replay is idempotent because state is re-read from Cashfree
- [ ] Owner-paid commission settlement not yet observed end to end in production

---

## 5. OTP and SMS

- [x] MSG91 owns the OTP; Hallnect never generates, stores or logs a code
- [x] MSG91 credentials are server-only and absent from the client bundle
- [x] A lead is forwarded to the venue **only after** the OTP is verified
- [x] Five database-backed send ceilings, shared by both OTP flows: 60-second cooldown; 5/hour per user+phone; 10/day per phone; 15/day per account; 300/day global, failing **closed**
- [x] **Three check ceilings** (0TP-2 fix): 5 per account+phone, 20 per phone, 15 per account — so a stranger can no longer spend a victim's allowance
- [x] A code may only be checked for a number this account requested one for
- [x] All check refusals return one identical message, so nothing leaks about other accounts' activity on a number
- [x] **SMS free text is sanitised in its GSM-7 form** — the string actually sent — closing the zero-width bypass
- [x] Delivery webhook behind a constant-time shared-secret check
- [~] OTP ceilings fail *open* when a counter cannot be read. Deliberate; the global fuse still fails closed
- [ ] No country allowlist on OTP destinations

---

## 6. Input, storage and web platform

- [x] Zod validation server-side on every action; the client form is a convenience
- [x] PostgREST `or()` filters quote the value rather than blocklisting separators, in both public and admin search
- [x] Errors sanitised before reaching a client — no raw PostgREST messages
- [x] Hall image URLs **derived** from the storage path, plus a database constraint requiring our own bucket
- [x] Uploads validated by **magic bytes**, and stored with the sniffed content type rather than the declared one
- [x] Storage path bound to the hall id; storage RLS enforces the same
- [x] Per-hall image cap
- [x] `next.config.ts` image `remotePatterns` scoped to this project's Supabase host — it was `**`, matching every host on the internet
- [x] Security headers: CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS one year with subdomains
- [x] `X-Powered-By` removed
- [x] HSTS `preload` deliberately absent, and documented as a decision — sending it while not submitted reads as done to an auditor and does nothing
- [x] `form-action` includes the Cashfree payment hosts (omitting them blocked every payment, client-side, with nothing in the logs)
- [~] CSP allows `'unsafe-inline'` and `'unsafe-eval'`. Accepted; nonce-based policy is the named follow-up

---

## 7. Privacy

- [x] A customer's phone reaches the venue only once the booking is real — not when checkout opens
- [x] A venue's number reaches the customer only after a verified enquiry
- [x] Phone numbers masked in admin and owner views where full display is not needed
- [x] Contact-form sender identity stored as a salted hash, never the address
- [x] Analytics behind a consent banner; nothing loads until accepted
- [x] The whole `/owner` and `/admin` subtree is `noindex` at the layout, so a new page cannot leak by forgetting a directive
- [ ] Account deletion leaves personal data in `leads`, `bookings.contact_phone` and contact messages — decide the retention policy, then make the code match

---

## 8. Monitoring and forensics

- [x] `admin_audit_log` is append-only and now records the money settings: commission rate (with the previous value), payment settings, premium grants, plan prices, ticket responses
- [x] Ticket responses audited **without** copying the reply text — it already lives on the ticket, and duplicating customer correspondence widens where personal data sits for no investigative gain
- [x] Invalid webhook signatures logged
- [x] Operational SMS alerts for failed payouts, beneficiary conflicts and unrecorded refunds
- [x] Notification outbox with dedupe keys, so retries do not re-send
- [ ] No centralised alerting on error rates. Vercel logs exist; nothing watches them

---

## 9. Infrastructure and configuration

- [x] No secret in the client bundle (scanned)
- [x] No secret in git history (pattern scan; values never printed)
- [x] Service-role key server-only, never reachable from a client component
- [x] `CRON_SECRET` set; the GET path is secret-only, and an unset secret disables it rather than becoming a blank-token bypass
- [x] Supabase Pro with point-in-time recovery; Vercel Pro
- [x] Database in `ap-southeast-2`, functions pinned to `syd1`
- [x] HTTPS enforced; HTTP redirects
- [ ] `CONTACT_IP_SALT` (see §1)
- [ ] Vercel Spend Management limit not confirmed

---

## 10. The habit worth keeping

Every migration in this engagement ends with a verification block that **raises
and fails the migration** if the fix does not hold, and no block swallows its
own assertion. That caught three real mistakes before they shipped.

It is the cheapest quality control in this repository. Keep writing them, and
keep them behavioural — assert on the stored value, never on "no exception was
raised". An RLS-filtered `UPDATE` matches zero rows **without** raising, so
"it didn't error" is not evidence that anything happened.
