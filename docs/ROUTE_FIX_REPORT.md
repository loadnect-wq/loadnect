# Hallnect — Route Fix Report

**Date:** 2026-06-30 · Runtime-verified this pass: **33/33 required routes** OK.

## Verification method
Live fetch sweep against the dev server (`redirect: manual`): public routes must be 200; private routes must be 0/307 (redirect to login), never 404/500.

## Public routes — all 200
`/`, `/halls`, `/login`, `/signup`, `/owner/register`, `/pricing` (→ `/premium`), `/contact`, `/terms`, `/privacy`, `/refund-policy`, `/cancellation-policy`, `/disclaimer`.

## Private routes — all redirect cleanly (307 → /login when logged out)
Customer: `/customer`, `/customer/bookings`, `/customer/saved-halls`, `/customer/profile`.
Owner: `/owner/dashboard`, `/owner/halls`, `/owner/halls/new`, `/owner/bookings`, `/owner/revenue`, `/owner/profile`.
Admin: `/admin/dashboard`, `/admin/users`, `/admin/owners`, `/admin/halls`, `/admin/bookings`, `/admin/payments`, `/admin/commissions`, `/admin/reviews`, `/admin/advertisements`, `/admin/support-tickets`, `/admin/settings`.

## Fixes applied across the build series
| Issue | Fix |
|---|---|
| Footer/navbar linked 7 non-existent marketing pages (`/about`, `/how-it-works`, `/careers`, `/blog`, `/press`, `/help`, `/safety`) → 404 on every page | Removed dead links from `lib/constants.ts`; nav/footer now point only to real routes |
| Homepage featured cards linked fake `MOCK_HALLS` slugs → `/halls/<slug>` 404 | Homepage renders real approved halls (or empty state); no dead slugs |
| `/pricing` → 404 | Added `app/pricing/page.tsx` → redirect to `/premium` |
| Booking blocked without Cashfree | Manual "Submit Booking Request" mode |
| Non-existent hall slug | `notFound()` → branded not-found page |

## Route-name notes (intentional, not bugs)
- `/pricing` is an alias → `/premium` (the canonical pricing page).
- `/customer/dashboard` in the brief maps to `/customer` (the dashboard index); `getDashboardPath('customer')` → `/customer`. Both resolve; no 404.
- Cashfree `create-order`/`verify` are server actions (`app/book/[slug]/actions.ts`), not REST routes — nothing fetches missing REST paths, so no 404.

## Error/fallback pages present
`app/not-found.tsx` (branded 404), `app/error.tsx` (route error, no raw details), `app/global-error.tsx` (root fallback). Loading skeletons at `app/**/loading.tsx`.

## Remaining
- Dynamic hall detail (`/halls/grand-lotus-mahal`) resolves; shows the real hall once `supabase/seeds/seed_clean_hallnect_demo.sql` is run (until then, branded not-found — correct).
- Legacy guest duplicates `/saved`, `/bookings`, `/profile` resolve (no 404) but overlap `/customer/*`; consolidation recommended, not required for launch.
