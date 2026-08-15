# Payment & Commission — Security Notes

Security posture for the advance-booking + owner-commission workflow (migration
0017 and the code that uses it).

## Customer-safety invariant (legal/financial)
- No function in this workflow ever writes to `bookings.*` amounts or any customer
  record. The customer's advance always stays recorded as paid toward their booking.
- Unpaid commission is recovered **only** via `owner_settlement_adjustments`, which
  reduces the **owner** payout — never an extra customer charge, never a reduction
  of customer booking credit.
- In-app wording follows the brief: no text implies the customer is charged extra
  or loses credit.

## Server-authoritative calculations
- Advance, remaining balance, platform fee, total, and commission amount are all
  computed server-side from the DB (`halls`, `platform_settings`). The client value
  is never trusted.
- Terms acceptance is re-verified server-side in `createBookingRequest`.
- `customer_id` / `owner_id` / roles are read from the session, never the form.

## Row-Level Security (RLS)
- `commissions`: owner reads only own (via `owns_hall`); customer default-deny;
  writes admin-only. `guard_commission_writes` trigger blocks non-admin writes.
- `owner_commission_payments`: owner selects/inserts only own rows and only with a
  submitted status; admin full access; `guard_commission_payment_writes` blocks any
  owner attempt to self-verify or set `verified_*`.
- `owner_settlement_adjustments`: owner read-only on own rows; admin full access;
  `guard_settlement_adjustment_writes` blocks all non-admin/non-backend writes.
- `platform_settings`: admin-only. Non-sensitive fields (UPI id/QR, advance %,
  feature flags) are exposed to authenticated users through the SECURITY DEFINER
  RPC `get_public_payment_settings()` — the admin-only `commission_percent` and the
  row itself are never exposed.

## Idempotency / no duplicates
- One commission per booking (`commissions.booking_id` UNIQUE; upsert ignores dupes).
- One open UPI submission per commission (partial unique index).
- One settlement adjustment per commission (`commission_id` UNIQUE) → the auto-sweep
  can't double-deduct; a repeat run is a no-op.
- Admin verification is guarded against re-deciding a resolved submission.

## Owner cannot self-settle
- Owners can submit a UPI payment claim but can **never** mark a commission paid;
  only an admin (or a future signature-verified gateway webhook) can. Enforced by
  both RLS and DB triggers.

## Secrets & service role
- Service-role client (`lib/supabase/admin.ts`) is `import "server-only"` and used
  only by trusted server code (payments, the overdue engine, the cron route).
- `CRON_SECRET` is server-only; the cron route compares it in constant time and
  disables the header path when it's unset (no empty-secret bypass).
- Missing Cashfree env never crashes the app (`isCashfreeConfigured()` is a pure
  boolean). No secret has a `NEXT_PUBLIC_` prefix.

## Enum / migration safety
- New `commission_status` values are added with `ALTER TYPE … ADD VALUE IF NOT
  EXISTS` and are **not** referenced as literals within the same migration, avoiding
  the "unsafe use of new enum value" error.
- All of 0017 is additive + idempotent (no drops); safe to re-run.
- Booking statuses reuse the existing enum so the double-booking guards and the
  `validate_booking_transition` state machine remain intact.
