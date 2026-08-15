# Auto-Adjust Unpaid Commission (after 7 days)

**Status:** Implemented (2026-08-15). Engine: `lib/commissions.ts` →
`runOverdueCommissionCheck()`.

## The customer-safety rule (non-negotiable)
Auto-adjustment **never** charges the customer, never reduces the customer's
booking credit, and never touches any `bookings.*` amount. The customer's advance
remains recorded as paid toward their booking. Unpaid commission is recovered
**only** by reducing what Hallnect releases to the **owner** — an
`owner_settlement_adjustments` row.

## How it works
1. **Due date:** set when the commission is created — `due_date = created_at + 7 days`
   (also `commission_due_days` in `platform_settings`, default 7, admin-editable).
2. **Sweep (Step 1 — mark overdue):** any unpaid commission
   (`pending / collected / payment_submitted / payment_under_review / rejected`)
   whose `due_date` has passed is set to `overdue`.
3. **Sweep (Step 2 — adjust, only if enabled):** if
   `enable_auto_commission_adjustment` is on, for each overdue commission **without**
   an existing adjustment, insert one `owner_settlement_adjustments` row:
   - `adjustment_type = commission_deduction`, `source = overdue_commission`
   - `amount = commission_amount`, plus `owner_id`, `booking_id`, `commission_id`
   Then flip the commission to `adjusted_from_owner_settlement`
   (and `settlement_adjustment_status = adjusted`).

## Idempotency (no duplicate deductions)
- `owner_settlement_adjustments.commission_id` is **UNIQUE** — a second insert for
  the same commission fails with `23505` and is swallowed as a no-op.
- The engine also skips commissions already flagged `settlement_adjustment_status = adjusted`.
- Running the sweep any number of times produces the same result. Verified logic in
  `FINAL_PAYMENT_FEATURE_TEST_REPORT.md`.

## Where it's shown
- **Owner** (`/owner/commissions`): a settlement-adjustment notice + per-commission
  message — *"Commission was adjusted from owner settlement because payment was not
  completed within the allowed 7-day period."*
- **Admin** (`/admin/commissions`): "Owner settlement adjustments" history table.
- **Customer:** unchanged — their advance still shows fully paid.

## Triggering the sweep
- **Admin button:** Admin → Commissions → "Run overdue check"
  (`runOverdueCommissionCheckAction`).
- **Machine/cron:** `POST /api/admin/commissions/run-overdue-check` with
  `Authorization: Bearer <CRON_SECRET>`. See `COMMISSION_CRON_SETUP.md`.
