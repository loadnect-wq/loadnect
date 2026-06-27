# Hallnect — Route Audit Report

**Date:** 2026-06-26. Inventory of App Router routes vs. the required-route list, plus UI link audit.

## Existing route files (app/)
**Public:** `/`, `/halls`, `/halls/[slug]`, `/(auth)/login`, `/(auth)/signup`, `/owner/register`, `/premium`, `/contact`, `/(legal)/terms`, `/(legal)/privacy`, `/(legal)/refund-policy`, `/(legal)/cancellation-policy`, `/(legal)/disclaimer`, `/approval-pending`, plus legacy guest pages `/bookings`, `/saved`, `/profile`.

**Customer:** `/customer` (dashboard), `/customer/bookings`, `/customer/bookings/[id]`, `/customer/saved-halls`, `/customer/profile`, `/customer/reviews`, `/customer/support`.

**Owner** (under `(dashboard)` group): `/owner`, `/owner/dashboard`, `/owner/halls`, `/owner/halls/new`, `/owner/halls/[id]/edit`, `/owner/halls/[id]/images`, `/owner/halls/[id]/availability`, `/owner/bookings`, `/owner/revenue`, `/owner/profile`, `/owner/premium`, `/owner/premium/upgrade`, `/owner/support`.

**Admin:** `/admin`, `/admin/dashboard`, `/admin/users`, `/admin/owners`, `/admin/halls`, `/admin/hall-approvals`, `/admin/bookings`, `/admin/payments`, `/admin/commissions`, `/admin/reviews`, `/admin/advertisements`, `/admin/support-tickets`, `/admin/premium-listings`, `/admin/settings`.

**Booking/payment:** `/book/[slug]`, `/booking/[id]/status`, `/api/webhooks/cashfree`.

## Required vs actual
| Required | Status |
|---|---|
| Public set (/, /halls, /halls/[slug], /login, /signup, /owner/register, /contact, legal pages) | ✅ all present |
| `/pricing` | ⚠️ Not present — app uses **`/premium`**. Nav "Pricing" → `/premium`. Add a redirect if `/pricing` is required verbatim. |
| `/customer/dashboard` | ⚠️ App uses **`/customer`**. `getDashboardPath('customer')` → `/customer`. Add redirect if the exact path is required. |
| Customer set (bookings, saved-halls, profile) | ✅ present |
| Owner set (dashboard, halls, halls/new, bookings, revenue, profile) | ✅ present |
| Admin set (dashboard, users, owners, halls, bookings, payments, commissions, reviews, advertisements, support-tickets, settings) | ✅ present |
| Cashfree API: `/api/webhooks/cashfree` | ✅ present |
| Cashfree API: `/api/payments/cashfree/create-order`, `/verify` | ⚠️ Not present as REST routes — order creation + verification are implemented as **server actions** (`app/book/[slug]/actions.ts` → `lib/payments.ts`). Functionally equivalent and server-side; no 404 because nothing fetches those REST paths. |

## UI links audited
- **Navbar / Footer** (`lib/constants.ts`): had 7 dead links (`/about`, `/how-it-works`, `/careers`, `/blog`, `/press`, `/help`, `/safety`) → **removed**. Now all point to real routes.
- **Mobile bottom nav** (`components/app/BottomNav.tsx`): `/`, `/halls`, `/bookings`, `/saved`, `/profile` — all route files exist (no 404).
- **Homepage featured cards**: were mock slugs → **now real DB slugs** via `HallCard`.
- **Hall cards / "Book Now" / dashboard sidebars**: link to existing routes (verified via build + route sweep).

## Routes to remove / redirect / consolidate (recommendations, not done this pass)
- **Legacy guest duplicates** `/saved`, `/bookings`, `/profile` overlap with `/customer/*`. Recommend redirecting them to the `/customer/*` equivalents (or to `/login` for guests) and removing the duplicate pages. `/saved` still uses demo data (see `DATA_CLEANUP_REPORT.md`).
- Optional: add `/pricing` → `/premium` and `/customer/dashboard` → `/customer` redirects if the exact paths are wanted.

## Verdict
No active UI link now points to a missing page. All required dashboards exist and are server-side protected. Remaining items are consolidation/redirect recommendations, not 404s.
