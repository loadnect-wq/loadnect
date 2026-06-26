# Hallnect — Manual QA Checklist

> Scope: full pre-release manual regression pass for the Hallnect wedding-venue
> marketplace (Next.js App Router + Supabase + Cashfree).
> Mark each item ✅ pass / ❌ fail / ⚠️ blocked. Record the build/commit under test.

**Build under test:** `__________`  **Tester:** `__________`  **Date:** `__________`
**Environment:** ☐ Local ☐ Preview ☐ Production

---

## 0. Preconditions

- [ ] All SQL migrations applied (`supabase/migrations/0001` … `0016`). **In particular 0013–0016** add `halls.premium_tier`, premium plans, advertisements columns, review sub-ratings/`title`, and support-ticket `internal_notes` + `medium` priority. If missing, the app logs `premium_tier missing — run migration 0013` and premium/ads/sub-ratings degrade silently.
- [ ] Storage bucket `hall-images` exists (public, 5 MB limit, mime `image/jpeg,png,webp`) — migration 0010.
- [ ] Env vars set (see [§24](#24-vercel-deployment)).
- [ ] Cashfree credentials are **sandbox** for QA (`CASHFREE_ENV=sandbox`).
- [ ] At least 2 approved halls seeded with cover images, pricing, and availability.

---

## Test accounts

Create these before starting. Roles map to dashboards via `getDashboardPath()`.

| Label | Email (suggested) | Role (`profiles.role`) | Purpose |
|---|---|---|---|
| **customer1** | `customer1@qa.hallnect.test` | `customer` | Primary booker; makes payments, reviews |
| **customer2** | `customer2@qa.hallnect.test` | `customer` | Data-isolation checks (must NOT see customer1's data) |
| **owner_pending** | `owner.pending@qa.hallnect.test` | `owner_pending` | Awaiting approval; blocked from owner dashboard |
| **owner_approved_1** | `owner1@qa.hallnect.test` | `owner_approved` | Owns Hall A + Hall B; manages bookings |
| **owner_approved_2** | `owner2@qa.hallnect.test` | `owner_approved` | Owns Hall C; cross-owner isolation checks |
| **admin** | `admin@qa.hallnect.test` | `admin` | Approvals, moderation, settings |

> **How to create roles safely:** `customer` and `owner_pending` are created through the normal signup UI (a self-signup can never pick a privileged role — enforced by the `handle_new_user` trigger + RLS). **`owner_approved` and `admin` must be set by an admin / trusted backend** (admin approves the owner; `admin` is seeded directly in the DB). Never set these from the client.
>
> Suggested ownership: assign **Hall A** & **Hall B** to owner_approved_1, **Hall C** to owner_approved_2.

---

## 1. Authentication (general)

- [ ] Unauthenticated visit to a protected route (`/customer`, `/owner/dashboard`, `/admin/dashboard`) redirects to `/login`.
- [ ] After login, user is sent to `/auth/redirect`, which routes by role.
- [ ] Logout clears the session; revisiting a protected route redirects to `/login`.
- [ ] Session persists across page reload (cookie-based; `proxy.ts` refreshes it).
- [ ] Expired/invalid session is handled gracefully (no crash; redirect to login).
- [ ] Password field min length enforced client-side (Zod, ≥ 8 chars) **and** server/Supabase-side.
- [ ] Invalid email format rejected before any network call (Zod toast).
- [ ] Open-redirect guard: `/auth/callback?next=@evil.com`, `?next=//evil.com`, `?next=.evil.com` all stay on-origin (never bounce to an external host).
- [ ] `/auth/callback` with no `code` → `/login?error=oauth_failed`.

## 2. Customer signup / login

- [ ] Signup (`/signup`) with valid name/email/password creates a `customer` profile.
- [ ] If email confirmation is ON: "check your email" screen appears; confirmation link signs in and routes to `/customer`.
- [ ] If email confirmation is OFF: immediate session → `/auth/redirect` → `/customer`.
- [ ] Duplicate email signup shows a friendly error (no raw Supabase error).
- [ ] Google signup (`/signup` → Continue with Google) lands on `/auth/callback?next=/auth/redirect` → `/customer`, role `customer`.
- [ ] Email login (`/login`) with correct credentials → `/customer`.
- [ ] Wrong password shows "Sign in failed" toast (no account enumeration detail).
- [ ] Customer cannot reach `/owner/dashboard` or `/admin/*` (redirected to `/customer`).

## 3. Owner signup / login

- [ ] Owner registration (`/owner/register`) email path creates an `owner_pending` profile (role metadata → `handle_new_user` trigger).
- [ ] Owner email path redirect lands on `/approval-pending`.
- [ ] Google owner registration → `/auth/callback?next=/auth/set-owner-role` upgrades `customer → owner_pending`, then role-router lands on `/approval-pending`.
- [ ] A self-signup can **never** obtain `owner_approved` or `admin` directly (verify in DB: role is `owner_pending`).
- [ ] `owner_pending` logging in is routed to `/approval-pending`, not the owner dashboard.
- [ ] After admin approval (role → `owner_approved`), next login routes to `/owner/dashboard`.
- [ ] Deleted legacy endpoint `/auth/set-owner-role` returns **404** (CSRF surface removed).

## 4. Admin login

- [ ] `admin` login routes to `/admin/dashboard`.
- [ ] Non-admin (customer/owner) directly visiting `/admin/dashboard` is redirected away (server-side `requireRole(["admin"])`).
- [ ] Admin sidebar shows pending counts (halls, owners, tickets, ads).

## 5. Role-based redirects

Verify `getDashboardPath` for each role via `/auth/redirect`:

- [ ] `customer` → `/customer`
- [ ] `owner_pending` → `/approval-pending`
- [ ] `owner_approved` → `/owner/dashboard`
- [ ] `admin` → `/admin/dashboard`
- [ ] Unknown/no session → `/login`

---

## 6. Customer dashboard

- [ ] `/customer` loads with greeting, stats/booking cards; loading skeleton shows on slow network.
- [ ] My Bookings lists only customer1's bookings (customer2 sees none of them).
- [ ] Saved halls (heart) toggles persist and are private to the customer.
- [ ] Profile edit (name, phone) saves; role/email are read-only.
- [ ] "Contact support" link reaches `/customer/support`.
- [ ] Cancel-booking confirmation dialog appears; cancelling respects allowed statuses.
- [ ] Empty states render when no bookings / no saved halls.

## 7. Owner dashboard

- [ ] `/owner/dashboard` (owner_approved_1) loads stats; skeleton on slow load.
- [ ] Hall management lists only this owner's halls (owner_approved_1 cannot see Hall C).
- [ ] Create hall: rejects negative price, invalid/zero capacity, min > max capacity (Zod, server-side).
- [ ] New hall starts in `pending_approval` (owner cannot self-approve — trigger blocks it).
- [ ] Edit hall persists changes; amenities sync correctly.
- [ ] Image upload: accepts JPEG/PNG/WebP ≤ 5 MB; rejects other types/oversize (client + bucket-level mime enforcement).
- [ ] Delete image shows confirmation dialog; deletion removes file + row.
- [ ] Availability calendar: block/open slots (morning/evening/full_day) saves.
- [ ] Booking requests list shows bookings for owner's halls only; accept/reject/complete work.
- [ ] Revenue/commission summary reflects completed bookings.
- [ ] Owner support page (`/owner/support`) lists own tickets + create form.

## 8. Admin dashboard

- [ ] Stats cards + tables render; skeleton on load.
- [ ] Hall approvals: approve / reject / suspend / unsuspend update status and revalidate.
- [ ] Owner approvals: approve sets `owner_approved` + verifies `hall_owners` row; reject downgrades to `customer`.
- [ ] Admin cannot deactivate their own account.
- [ ] Users list, commissions, premium listings, advertisements, reviews, support tickets all load and paginate/filter.
- [ ] Admin actions use the session client (RLS + `is_admin()`), not a client-exposed service key.

---

## 9. Hall listing (`/halls`)

- [ ] Public (logged-out) sees only `approved` halls.
- [ ] Cards show name, city, capacity, price/day, rating (only when reviews exist), premium badge (when tier active).
- [ ] Grid is responsive (1 col mobile → 2 tablet → 3 desktop).
- [ ] Empty state shows when no results; "Clear filters" appears when filters active.
- [ ] Sponsored banner (`search_page_banner`) renders when an active ad exists.

## 10. Hall detail page (`/halls/[slug]`)

- [ ] Approved hall renders gallery, name, rating, price, capacity, amenities, reviews.
- [ ] Non-existent slug → 404 (`not-found.tsx`).
- [ ] Non-approved hall → 404 for public; visible as preview to its owner/admin (RLS).
- [ ] Sticky "Book Now" on mobile; sidebar booking card on desktop.
- [ ] Review sub-ratings (cleanliness/value/location/service) + title display when present (migration 0015).
- [ ] Similar halls section renders.
- [ ] Sidebar ad (`hall_detail_sidebar`) renders when active.

## 11. Search and filters

- [ ] Keyword search matches name/city/address.
- [ ] City filter, capacity filter, price min/max filter all narrow results.
- [ ] Amenity filter works; category chips (premium/budget/wedding/banquet/party) work.
- [ ] Sort: recommended, price asc, price desc, rating, capacity.
- [ ] Date filter excludes fully-blocked halls.
- [ ] Mobile: filter bottom sheet opens, applies, and result count updates.
- [ ] Filters reflected in URL query params (shareable/back-button safe).

## 12. Availability

- [ ] Calendar shows blocked vs available per slot for an approved hall.
- [ ] Owner-blocked dates are not bookable by customers.
- [ ] Slots: morning, evening, full_day behave independently except full-day overlap (see booking).
- [ ] Past dates are not selectable for booking.

---

## 13. Booking

- [ ] Logged-out "Book Now" prompts sign-in.
- [ ] Booking requires a valid future date (past dates rejected server-side, IST).
- [ ] Guest count > hall capacity is rejected with a clear message.
- [ ] Price is recomputed server-side from the DB (client cannot tamper with amount).
- [ ] Advance = 25% of total; platform fee = current rate from `platform_settings` (default 5%).
- [ ] Booking is created as `pending_payment` with a 15-minute expiry.
- [ ] **Double-booking:** two customers booking the same hall/date/slot — only one succeeds; the other sees "just booked by someone else."
- [ ] **Full-day vs half-day overlap:** a full_day booking blocks morning & evening for that date and vice-versa.
- [ ] Expired pending booking is auto-cancelled (cron or admin "cleanup expired" button).

## 14. Cashfree payment — SUCCESS

- [ ] "Pay advance" opens Cashfree sandbox checkout with the correct advance amount.
- [ ] Successful test payment returns to the status/return URL.
- [ ] Return-url server verification confirms the booking (works even without the webhook in local dev).
- [ ] Booking transitions `pending_payment → booking_requested` (availability blocked, commission recorded).
- [ ] Customer sees a success state; confirmation reflects on My Bookings.
- [ ] Amount charged equals the advance (not the full total, not a client-supplied value).

## 15. Cashfree payment — FAILURE

- [ ] Failed/declined test payment returns without confirming the booking.
- [ ] No money-charged messaging is friendly; user can retry.
- [ ] User-dropped (closed checkout) leaves booking recoverable until expiry.
- [ ] Booking does **not** advance to `booking_requested` on failure.
- [ ] Failure path never exposes raw gateway codes/refs (uses `paymentStatusMessage`).

## 16. Cashfree webhook

- [ ] Valid signed webhook (`x-webhook-signature` + `x-webhook-timestamp`) is accepted.
- [ ] **Invalid/absent signature → HTTP 401** (fail closed; no processing).
- [ ] Webhook re-verifies order status against Cashfree's order API — it does **not** trust body amounts/status.
- [ ] Idempotent: redelivering the same event does not double-write (payment/booking/availability/commission).
- [ ] `GET` to the webhook URL returns 200 (dashboard URL validation probe).
- [ ] Logs contain only event type + order id — never secrets, headers, or PII.

## 17. Commission creation

- [ ] On payment success, a `commissions` row is created for the booking.
- [ ] Commission amount = booking `platform_fee` snapshot (rate at booking time, not later changes).
- [ ] `commissions.booking_id` is unique — no duplicate on webhook redelivery.
- [ ] Owner sees commissions for their halls only; admin sees all.
- [ ] Changing the admin commission rate does **not** retroactively alter existing bookings.

## 18. Premium listings

- [ ] Requires migration 0013 (`premium_tier`, `premium_plans`).
- [ ] Admin can grant a premium/pro listing with start/end dates and amount (no negative amount, end ≥ start).
- [ ] Active premium/pro halls show the correct badge and rank above free halls in sorting.
- [ ] Expired/inactive premium reverts the hall to no badge.
- [ ] Owners cannot self-grant premium (no client write policy; trigger-guarded).

## 19. Advertisements

- [ ] Requires migration 0014.
- [ ] Admin can create/edit/delete ads; non-admins cannot (RLS `is_admin()`).
- [ ] Target/image URLs reject `javascript:`/`data:`/`file:` and non-http(s).
- [ ] Public sees only `active` ads within their start/end date window.
- [ ] Ads render in their placements: `homepage_banner`, `search_page_banner`, `hall_detail_sidebar`.
- [ ] End date before start date is rejected.

## 20. Reviews

- [ ] A customer can review **only** a hall they have a `completed` booking for.
- [ ] One review per booking (duplicate attempt → "already reviewed this booking").
- [ ] Rating 1–5 enforced; sub-ratings (cleanliness/value/location/service) optional, 1–5.
- [ ] Public sees only `is_visible` reviews.
- [ ] Admin can hide/show and delete reviews.
- [ ] Hall `rating_average` / `rating_count` recompute after a visible review change (trigger).
- [ ] Review text is sanitized (no raw `<script>` persists / renders).

## 21. Support tickets

- [ ] Customer and owner can create tickets (subject ≥ 3, message ≥ 10 chars).
- [ ] Priorities: low/medium/high/urgent; statuses: open/in_progress/resolved/closed.
- [ ] User sees only their own tickets; admin sees all.
- [ ] Admin reply (`admin_response`) is visible to the user.
- [ ] **`internal_notes` are NEVER shown to the user** (admin-only field; not selected by user-facing reader).
- [ ] Status updates by admin reflect on the user's view.

---

## 22. Supabase RLS (security)

Run each as the wrong actor and confirm **denial** (not just a hidden UI button):

- [ ] customer2 cannot read customer1's bookings/payments/saved halls (direct query returns nothing).
- [ ] owner_approved_1 cannot read/update Hall C (owned by owner_approved_2).
- [ ] A non-admin cannot change `profiles.role` (RLS + `prevent_role_change` trigger).
- [ ] A non-admin cannot flip `hall_owners.is_verified` (`prevent_owner_self_verify`).
- [ ] An owner cannot set their hall to `approved/rejected/suspended` (`prevent_hall_self_approve`).
- [ ] No client can write `payments`, `commissions`, `premium_listings` (service-role only).
- [ ] Public/anon cannot read non-approved halls, their images, or availability.
- [ ] Booking financial/identity fields (amounts, customer_id, hall_id) are immutable to customer/owner (`validate_booking_transition`).
- [ ] Illegal booking status transitions are rejected (e.g. customer → `completed`).
- [ ] Service-role key is **not** present in any client bundle / `NEXT_PUBLIC_*` var.

## 23. Mobile responsiveness

Test at 375 px (mobile), 768 px (tablet), 1280 px+ (desktop):

- [ ] Bottom nav (Home/Search/Bookings/Saved/Profile) shows on mobile, hidden on desktop.
- [ ] Landing: app-style stack on mobile; hero + grids + FAQ on desktop.
- [ ] Hall listing: vertical cards + filter sheet on mobile; grid on desktop.
- [ ] Hall detail: sticky Book Now bar on mobile; sidebar booking card on desktop.
- [ ] Dashboards: card layout on mobile; sidebar layout on desktop.
- [ ] No horizontal overflow, no overlapping text, tap targets ≥ 44 px.
- [ ] Forms, dialogs (ConfirmationDialog), and toasts are usable on small screens.
- [ ] Images use responsive sizes; no layout shift on load.

## 24. Vercel deployment

- [ ] Build succeeds (`next build`) with no type errors (`tsc --noEmit` clean).
- [ ] Environment variables set in Vercel project:
  - `NEXT_PUBLIC_APP_URL`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` *(server-only — confirm NOT exposed to client)*
  - `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV`
  - `NEXT_PUBLIC_CASHFREE_ENV`
- [ ] `NEXT_PUBLIC_APP_URL` matches the deployed domain (used for OAuth + return/notify URLs).
- [ ] Supabase Auth redirect URLs include the deployed `/auth/callback`.
- [ ] Cashfree dashboard `notify_url` points to `https://<domain>/api/webhooks/cashfree` and validates (GET 200).
- [ ] Cashfree `return_url`/allowed domains include the deployed domain.
- [ ] OAuth (Google) redirect works on the deployed domain.
- [ ] All migrations applied to the production Supabase project.
- [ ] Production smoke test: signup → browse → book → sandbox/live pay → confirm.
- [ ] Error/404 pages render branded fallbacks (`error.tsx`, `not-found.tsx`, `global-error.tsx`).
- [ ] No secrets in client bundle or browser console; no raw DB errors surfaced to users.

---

## Sign-off

| Area | Result | Notes |
|---|---|---|
| Authentication & roles | ☐ | |
| Customer flows | ☐ | |
| Owner flows | ☐ | |
| Admin flows | ☐ | |
| Booking & payments | ☐ | |
| Webhook & commission | ☐ | |
| Monetization (premium/ads) | ☐ | |
| Reviews & tickets | ☐ | |
| RLS / security | ☐ | |
| Responsiveness | ☐ | |
| Deployment | ☐ | |

**Overall:** ☐ Pass ☐ Pass-with-issues ☐ Fail  **Signed:** `__________`
