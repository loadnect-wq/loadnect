# Owner Commission Dashboard

**Status:** Implemented (2026-08-15). Route: `/owner/commissions`.

## What it does
For every advance-paid/successful booking, a commission record is written by the
trusted backend (`createCommission` in `lib/payments.ts`) with:

`booking_id, hall_id, hall_owner_id, customer_id, booking_amount, advance_amount,
commission_rate, commission_amount, owner_payout_amount, status, due_date, paid_at,
payment_method, payment_reference, payment_screenshot_url, admin_note,
settlement_adjustment_status`.

The commission rate comes from `platform_settings.commission_percent` (admin-editable,
default 5%; the brief's "≈10%" is just a suggested default — set it in Admin → Settings).
Amounts are **always** computed server-side; the frontend value is never trusted.

## Owner dashboard (`/owner/commissions`)
- Summary cards: **Outstanding**, **Overdue**, **Paid**, **Next due**.
- Per-commission card: hall, booking id, commission amount, rate, due date,
  days remaining/overdue, and status badge.
- **Pay Now** (UPI) for outstanding commissions → see `UPI_COMMISSION_PAYMENT_FLOW.md`.
- **Settlement-adjustment** notice when an overdue commission was recovered from
  the owner's payout (see `AUTO_COMMISSION_ADJUSTMENT.md`).
- Owner terms text is shown verbatim per the brief.

Data is read via `fetchOwnerCommissions` / `fetchOwnerSettlementAdjustments`
(`lib/owner.ts`), both RLS-scoped to the owner's own halls/rows.

## Admin dashboard (`/admin/commissions`)
- Full commission table + by-owner rollup (existing).
- **New:** "Run overdue check" button, "UPI payments awaiting verification"
  section (approve/reject/mark paid + admin note), and "Owner settlement
  adjustments" history.
- Admin → Settings has a **Payments & commission** panel to configure the
  commission rate, due days, default advance %, Hallnect UPI ID/QR, and the three
  feature flags.

## Statuses (commission_status enum, extended in migration 0017)
Existing: `pending, collected, paid_out, refunded`.
Added: `paid, overdue, payment_submitted, payment_under_review, rejected,
adjusted_from_owner_settlement, waived, disputed`.

> **Model note:** in the current build the platform fee is collected from the
> customer's total at booking time, and the commission row (status `collected`)
> represents the platform's cut. The owner-pays-commission-by-UPI workflow layers
> on top: an outstanding commission is one the owner still needs to settle with
> Hallnect. If you move to a pure "owner owes commission" settlement model, the
> same tables and flows apply unchanged. See `PAYMENT_SECURITY_NOTES.md`.

## Security
- Owners see only their own commissions (RLS via `owns_hall`).
- Owners **cannot** edit commission amount / due date, mark paid, or delete —
  enforced by RLS + the `guard_commission_writes` trigger.
- Customers can never see commission data (default-deny; no select policy).
