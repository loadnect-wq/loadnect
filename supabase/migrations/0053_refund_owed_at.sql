-- ─────────────────────────────────────────────────────────────────────────────
-- 0053_refund_owed_at.sql — start the clock the refund SLA is measured against.
--
-- /refund-policy §8 promises approved refunds within 5-7 business days. Nothing
-- counted those days: recordBookingRefund marks refund_state='owed' and stops,
-- and the money moves only when an admin presses the button. The nightly sweep
-- added in lib/refund-sla.ts now reports refunds that have sat too long — but a
-- report needs a start time, and the only timestamp available was updated_at.
--
-- updated_at IS A PROXY AND IT LEANS THE WRONG WAY. Any later touch to the row
-- resets it, so a refund reads YOUNGER than it is and the alarm fires late — on
-- a promise, late is the failure mode that matters. This column is stamped in
-- the same write that sets 'owed', so the clock starts exactly when the debt
-- does and cannot drift from it.
--
-- Rows written before this migration have no stamp. The sweep falls back to
-- updated_at for those and says so in its own comment; they are NOT back-filled,
-- because inventing a start time for a debt is manufacturing evidence about how
-- long a customer has been waiting.

alter table public.payments
  add column if not exists refund_owed_at timestamptz;

comment on column public.payments.refund_owed_at is
  'When the refund became owed, stamped by recordBookingRefund. The published SLA (5-7 business days) is measured from here. NULL on rows that predate this column; the overdue sweep falls back to updated_at for those, which is a proxy and not exact.';

-- Partial: the sweep only ever reads rows in these two states, so the index
-- stays small and does not carry every settled payment for no reason.
create index if not exists idx_payments_refund_owed
  on public.payments (refund_owed_at)
  where refund_state in ('owed', 'failed');

-- Readable, not writable. 0046 revoked every client write on payments and
-- restored none; a new column inherits no grant, so there is nothing to revoke.
-- The customer has the strongest claim to see when their own refund clock
-- started.
grant select (refund_owed_at) on public.payments to anon, authenticated;
