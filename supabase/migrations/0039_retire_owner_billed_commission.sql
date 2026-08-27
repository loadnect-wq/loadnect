-- ─────────────────────────────────────────────────────────────────────────────
-- 0039 — Retire the owner-billed commission model.
--
-- Hallnect's commission is 2.5% of the hall price, retained out of the
-- customer's advance at settlement. An owner is never invoiced, so the manual
-- "owner pays Hallnect by a due date" flow and everything that enforced it has
-- been removed from the application.
--
-- WHAT THIS MIGRATION DOES *NOT* DO, DELIBERATELY:
--   • It does not drop owner_commission_payments or owner_settlement_adjustments.
--     Those tables hold financial records. Historical rows are never rewritten
--     or destroyed, even when the feature that produced them is gone.
--   • It does not drop any commissions column or commission_status enum value.
--     'waived' and 'paid_out' are still READ as filters by the admin and owner
--     reporting views, and the removed states still need to render honestly if
--     a historical row carries one.
--
-- WHAT IT DOES: closes the write path that no application code can reach any
-- more. owner_commission_payments accepted an INSERT from any authenticated
-- owner. With the submission UI and its server action deleted, nothing reads
-- those rows — so an insert is now purely unaudited, unreachable data sitting
-- in a financial table. Admin write access is retained so an admin can still
-- correct or annotate history.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists ocp_owner_insert on public.owner_commission_payments;

comment on table public.owner_commission_payments is
  'RETIRED (migration 0039). Manual owner commission payment submissions from the '
  'owner-billed model. Read-only history: owners may still SELECT their own rows, '
  'only an admin may write. Nothing in the application creates rows here — '
  'commission is retained from the customer advance at settlement instead.';

comment on table public.owner_settlement_adjustments is
  'Deductions applied to an owner settlement. The automatic overdue-commission '
  'sweep that used to create these was removed in migration 0039; rows are now '
  'created by an admin only, and are surfaced read-only to the owner.';
