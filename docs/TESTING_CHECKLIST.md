# Hallnect — Testing Checklist

Condensed, action-oriented test plan. For the full per-feature manual pass see `docs/QA_CHECKLIST.md`. This file focuses on the **automated gates**, **test accounts**, and the **manual security tests** the audit prompt called out.

---

## A. Automated checks (run these first)

```bash
npm install
npm run lint         # eslint .  → must be 0 errors (warnings OK)
npm run type-check   # tsc --noEmit → must be clean
npm run build        # next build → must exit 0
# npm run test       # NO test setup yet — see "Test setup" below
```

**Last verified (2026-06-25):** lint ✅ 0 errors / 41 warnings · type-check ✅ · build ✅.

> ⚠️ Don't run `next build` while a dev server is using `.next` — it corrupts the dev cache (routes 404). If that happens: stop dev, `rm -rf .next`, restart.

### Test setup (missing — recommended)
No test runner is installed, so there is **no `test` script** (intentionally not faked). To add real coverage:
- Unit/integration: **Vitest** (`vitest`, `@testing-library/react`).
- E2E: **Playwright** — ideal for the auth/booking/RLS flows.
- Then add `"test": "vitest run"` and `"test:e2e": "playwright test"`.

---

## B. Test accounts

| Label | Role (`profiles.role`) | How to create |
|---|---|---|
| customer1 | `customer` | Sign up via `/signup` |
| customer2 | `customer` | Sign up via `/signup` |
| owner_pending | `owner_pending` | Register via `/owner/register` (email path) |
| owner_approved_1 | `owner_approved` | Register as owner → **admin approves**; assign Hall A + Hall B |
| owner_approved_2 | `owner_approved` | Register as owner → admin approves; assign Hall C |
| admin | `admin` | Sign up, then promote in SQL: `update public.profiles set role='admin' where email='admin@…';` |

> `owner_approved` and `admin` **cannot** be self-assigned from the UI (enforced by `handle_new_user` + RLS + `prevent_role_change`). That is the correct behavior — see the role-escalation tests below.

---

## C. Auth & role-redirect tests

- [ ] Customer signup → profile role = `customer` → lands on `/customer`.
- [ ] Owner email registration → role = `owner_pending` → lands on `/approval-pending`.
- [ ] Owner Google registration → role upgraded to `owner_pending` in the callback → `/approval-pending`.
- [ ] Admin login → `/admin/dashboard`.
- [ ] Logout clears session; protected routes redirect to `/login`.
- [ ] `getDashboardPath`: customer→`/customer`, owner_pending→`/approval-pending`, owner_approved→`/owner/dashboard`, admin→`/admin/dashboard`.

## D. Route protection (server-side, not just hidden UI)

- [ ] Logged-out → `/customer`, `/owner/dashboard`, `/admin/dashboard` all 307 → `/login`.
- [ ] customer cannot reach `/owner/*` or `/admin/*` (redirected).
- [ ] owner_pending cannot reach `/owner/dashboard` (sees `/approval-pending`).
- [ ] owner_approved cannot reach `/admin/*`.

## E. Manual security tests (the audit's explicit list)

> Run each by **logging in as the named actor** and attempting the action / direct query. Confirm **denial**, not just a hidden button.

- [ ] customer1 cannot see customer2's bookings/payments/saved halls/reviews.
- [ ] customer cannot access `/admin`.
- [ ] customer cannot access `/owner`.
- [ ] owner_pending cannot access the owner dashboard.
- [ ] owner_approved_1 cannot edit owner_approved_2's halls.
- [ ] owner_approved_1 cannot see owner_approved_2's bookings.
- [ ] owner cannot approve their own hall (trigger blocks `approved/rejected/suspended`).
- [ ] owner cannot update payment records (no client write policy on `payments`).
- [ ] non-admin cannot approve owners.
- [ ] non-admin cannot approve halls.
- [ ] public cannot see pending/rejected/suspended halls (or their images/availability).
- [ ] failed payment does NOT confirm a booking.
- [ ] duplicate webhook does NOT duplicate a commission (unique `booking_id`).
- [ ] same hall + date + slot cannot be double-booked (unique index + overlap trigger); full-day blocks morning+evening.

## F. Regression checks for THIS audit's fixes

- [ ] `GET /auth/set-owner-role` → **404** (CSRF endpoint removed).
- [ ] `/auth/callback?next=@evil.com` (and `//evil.com`, `.evil.com`) → stays on-origin (`/login`).
- [ ] `/auth/callback?next=/auth/set-owner-role` with no code → `/login?error=oauth_failed` (no role change).
- [ ] Server actions: triggering a DB error returns a friendly message, not raw Postgres text.
- [ ] `/halls` "Clear all filters" navigates client-side (no full reload).
- [ ] `npm run lint` runs to completion with 0 errors.
- [ ] `sanitizeTicketText("a - b c", 50)` preserves spaces/dashes → `"a - b c"`.

## G. Payment flow (sandbox — needs tunnel or deploy)

- [ ] Successful advance payment → booking `pending_payment → booking_requested`, availability blocked, commission row created, amount = advance (server-computed).
- [ ] Failed / user-dropped payment → booking NOT advanced; friendly message; no gateway codes leaked.
- [ ] Webhook: valid signed event accepted; **invalid signature → 401**; redelivery idempotent (no duplicate writes).

## H. Pages to smoke (all should 200 / render)

Public: `/`, `/halls`, `/halls/[slug]`, `/login`, `/signup`, `/owner/register`, `/premium`, `/contact`, `/terms`, `/privacy`, `/refund-policy`, `/cancellation-policy`, `/disclaimer`.
Customer: `/customer`, `/customer/bookings`, `/customer/saved-halls`, `/customer/profile`, `/customer/support`.
Owner: `/owner/dashboard`, `/owner/halls`, `/owner/halls/new`, `/owner/bookings`, `/owner/revenue`, `/owner/support`.
Admin: `/admin/dashboard`, `/admin/users`, `/admin/owners`, `/admin/halls`, `/admin/bookings`, `/admin/payments`, `/admin/commissions`, `/admin/reviews`, `/admin/advertisements`, `/admin/support-tickets`.

## I. Responsiveness

- [ ] 375px (mobile): bottom nav, app shell, sticky booking bar, filter bottom sheet.
- [ ] 768px (tablet): layout holds, no overflow.
- [ ] 1280px+ (desktop): sidebars, grids, hover states.

## J. Preconditions before any "pass" is meaningful

- [ ] ⛔ Migrations 0013–0016 applied to the DB under test (else premium/ads/sub-ratings/ticket-notes are dark — `halls.premium_tier missing` log confirms they're not applied).
- [ ] Storage bucket `hall-images` exists.
- [ ] Cashfree sandbox credentials set; webhook URL reachable (tunnel/deploy).
- [ ] All 6 test accounts created with the right roles + hall ownership.
