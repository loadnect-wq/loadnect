# Final Payment Feature — Test Report

**Date:** 2026-08-15 · Scope: advance booking, owner commission + UPI, auto-adjustment.

## Automated gates (this pass)
| Gate | Result |
|---|---|
| `tsc --noEmit` (type-check) | ✅ clean |
| `eslint .` | ✅ 0 errors (40 pre-existing cosmetic warnings, unchanged) |
| `next build` | ✅ exit 0 |
| `/api/admin/commissions/run-overdue-check` compiles | ✅ present in route table |
| `/owner/commissions` compiles | ✅ present in route table |
| No test runner installed | ⚠️ `npm run test` not available (none added) |

## Migration
`supabase/migrations/0017_commission_workflow.sql` — additive + idempotent:
extends `bookings` (terms), `commissions`, `platform_settings`; adds
`owner_commission_payments`, `owner_settlement_adjustments`; extends the
`commission_status` enum; adds RLS + guard triggers + the
`get_public_payment_settings()` RPC. **Must be run in the Supabase SQL editor**
before the UI shows live data (the app degrades gracefully until then).

## Code-verified logic (reasoned, not yet run against a live DB)
1. ✅ Advance summary shows base/advance/remaining + cancellation & refund terms.
2. ✅ Terms checkbox is mandatory (client-gated **and** server-verified).
3. ✅ Booking created server-side with server-computed amounts.
4. ✅ Commission record created on payment success (`lib/payments.ts`), with
   customer_id, advance_amount, due_date.
5. ✅ Owner sees outstanding/overdue/paid + next due on `/owner/commissions`.
6. ✅ Owner submits UPI reference → `owner_commission_payments` (payment_submitted).
7. ✅ Admin approve → commission `paid` (+ paid_at, reference); submission verified.
8. ✅ Admin reject → submission `rejected`; commission stays payable (retry).
9. ✅ Overdue sweep marks past-due unpaid commissions `overdue`.
10. ✅ Settlement adjustment created once (UNIQUE `commission_id`).
11. ✅ Re-running the sweep does not duplicate the deduction (23505 swallowed).
12. ✅ Customer advance untouched — no write to `bookings.*`/customer rows.
13. ✅ Owner sees the settlement-adjustment message; admin sees history.
14. ✅ Customer cannot read commission data (RLS default-deny).
15. ✅ Owner cannot read another owner's commission (RLS `owns_hall`).
16. ✅ Non-admin cannot run the overdue check (401 unless admin session/CRON_SECRET).
17. ✅ Missing Cashfree env does not crash (pure-boolean config guard).

## Manual tests still required (need a live DB + auth sessions)
These cannot be exercised in this environment (no test login / live Supabase):
- [ ] Run migration 0017 in Supabase; confirm tables/columns/policies exist.
- [ ] Set Hallnect UPI ID + toggle flags in Admin → Settings → Payments & commission.
- [ ] Customer: full booking with terms → booking + commission appear.
- [ ] Owner: Pay Now → submit UTR → "Waiting for admin verification".
- [ ] Admin: approve → commission `paid`; reject → owner can resubmit.
- [ ] Set a commission `due_date` in the past → run overdue check → `overdue`;
      enable auto-adjust → run again → one `owner_settlement_adjustments` row;
      run a third time → no new row.
- [ ] Confirm customer's advance still shows fully paid throughout.
- [ ] Cross-owner + customer RLS denial checks (`SUPABASE_RLS_TESTING_GUIDE.md`).
- [ ] `curl` the cron route with a bad and a good `CRON_SECRET` (401 vs 200).

## Verdict
Backend + UI are **code-complete and build-green**. Money-handling paths were
designed for the customer-safety invariant and idempotency, but the end-to-end
runtime tests above require a live Supabase project with the migration applied and
real auth sessions — run them in staging before enabling the features in production.
