# Hallnect — Supabase RLS Testing Guide

How to verify Row Level Security and data isolation **using real authenticated user sessions** (NOT the service-role key, which bypasses RLS). This is a **launch blocker** — the policies are correct by inspection but not yet exercised per-role.

> Principle: every test logs in as a specific user and attempts to read/modify data they should NOT be able to. **Confirm denial** (empty result or error), not just a hidden UI button.

---

## Test accounts (create first)
| Label | Role | Notes |
|---|---|---|
| customer1 | `customer` | via `/signup` |
| customer2 | `customer` | via `/signup` |
| owner_pending | `owner_pending` | via `/owner/register` |
| owner_approved_1 | `owner_approved` | register → admin approves; owns Hall A, Hall B |
| owner_approved_2 | `owner_approved` | register → admin approves; owns Hall C |
| admin | `admin` | promote in SQL: `update public.profiles set role='admin' where email='…';` |

> `owner_approved` and `admin` cannot be self-assigned — that's enforced by `handle_new_user` + RLS + `prevent_role_change`. Verifying that is Test 9.

## How to run a check with a real session
Use the anon client authenticated as the user (browser console on the app, or a script using `supabase.auth.signInWithPassword` then a query). **Do not use the service-role key** — it bypasses RLS and invalidates the test.

Example (browser console, logged in as customer1):
```js
// Should return ONLY customer1's bookings; never customer2's.
const { data } = await window.__sb.from('bookings').select('id,customer_id');
```
(Or run the queries through the app UI and confirm what's visible.)

---

## Customer isolation
- [ ] customer1 reads `bookings` → only their own (not customer2's).
- [ ] customer1 reads `payments` → only their own.
- [ ] customer1 reads `saved_halls` → only their own; can insert/delete only their own.
- [ ] customer1 reads `reviews` → public visible reviews + their own; cannot read another user's hidden review.
- [ ] customer2, logged in, cannot see any of customer1's rows in the above.

## Owner isolation
- [ ] owner_approved_1 can read/update `halls` A & B; **cannot** update Hall C (owner_2's).
- [ ] owner_approved_1 can manage `availability`/`hall_images`/`hall_amenities` only for A & B.
- [ ] owner_approved_1 sees `bookings` only for A & B; cannot see Hall C's bookings.
- [ ] owner_approved_1 sees `commissions` only for their halls; cannot see owner_2's.
- [ ] owner_approved_1 cannot read other owners' `payments`.

## Public / anonymous
- [ ] Logged out: `halls` returns only `approved` rows; pending/rejected/suspended are invisible.
- [ ] Logged out: `hall_images` / `availability` for non-approved halls are invisible.
- [ ] Logged out: cannot read `bookings`, `payments`, `commissions`, `support_tickets`.

## Privilege / escalation (must be DENIED)
- [ ] A customer cannot `update profiles set role='admin'` (RLS WITH CHECK + `prevent_role_change`).
- [ ] An owner cannot set `hall_owners.is_verified = true` on their own row (`prevent_owner_self_verify`).
- [ ] An owner cannot set their hall `status='approved'` (`prevent_hall_self_approve`).
- [ ] A non-admin cannot insert/update `payments`, `commissions`, `premium_listings` (no client write policy).
- [ ] A customer/owner cannot change a booking's `customer_id`/`hall_id`/amounts (`validate_booking_transition`).
- [ ] A customer cannot transition a booking to an illegal status (e.g. → `completed`).

## Route protection (server-side)
- [ ] Logged out → `/customer`, `/owner/dashboard`, `/admin/dashboard` redirect to `/login`.
- [ ] customer → `/owner/*` and `/admin/*` redirect away.
- [ ] owner_pending → `/owner/dashboard` shows `/approval-pending`.
- [ ] non-admin → `/admin/*` redirected.

## Admin (must be ALLOWED)
- [ ] admin can read platform-wide users/owners/halls/bookings/payments/commissions/reviews/ads/tickets.
- [ ] admin can approve/reject owners and halls; suspend halls.
- [ ] admin cannot deactivate their own account (app guard).

## Regression (this build's security fixes)
- [ ] `GET /auth/set-owner-role` → 404 (CSRF endpoint removed).
- [ ] `/auth/callback?next=@evil.com` stays on-origin.
- [ ] Triggering a DB error returns a friendly message, not raw Postgres text.

## Pass criteria
Every "isolation" and "escalation" row must show **denial** for the wrong actor and **success** for the right actor. Any leak is a launch blocker.
