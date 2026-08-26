-- ─────────────────────────────────────────────────────────────────────────────
-- 0033_refund_execution.sql — tell "we owe a refund" apart from "we paid it".
--
-- Until now a cancelled booking recorded refund_amount and flipped
-- payments.status to 'refunded' in the same breath, while no money moved:
-- Hallnect had no refund integration at all, so every dashboard, receipt and
-- message said REFUNDED to a customer who had received nothing. The amount was
-- right; the claim was not.
--
-- These columns separate the two facts. refund_amount stays "what is owed";
-- refund_state says whether it has actually been sent, and carries Cashfree's
-- own id so the money can be traced outside our database.
--
-- Nothing here rewrites history: existing rows are backfilled from what they
-- already assert, and no amount is recomputed.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.payments
  add column if not exists refund_state        text not null default 'none',
  add column if not exists cashfree_refund_id  text,
  add column if not exists refund_initiated_at timestamptz,
  add column if not exists refund_completed_at timestamptz,
  add column if not exists refund_error        text,
  add column if not exists refund_initiated_by uuid references public.profiles(id);

-- The lifecycle, spelled out so an invalid state cannot be written:
--   none       nothing owed
--   owed       computed and recorded; money NOT sent yet
--   processing handed to Cashfree, awaiting its verdict
--   completed  Cashfree confirmed the money went back
--   failed     Cashfree rejected it; refund_error says why. Retryable.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payments_refund_state_check'
  ) then
    alter table public.payments
      add constraint payments_refund_state_check
      check (refund_state in ('none','owed','processing','completed','failed'));
  end if;
end $$;

-- Backfill: a row already carrying a refund_amount is money we OWE. It is
-- deliberately NOT marked completed — we have no evidence any of it was sent,
-- and recording an unpaid refund as paid is the exact error being corrected.
update public.payments
set refund_state = 'owed'
where refund_state = 'none'
  and refund_amount is not null
  and refund_amount > 0;

-- One refund per payment at the gateway; the unique id is our idempotency key.
create unique index if not exists uq_payments_cashfree_refund_id
  on public.payments (cashfree_refund_id)
  where cashfree_refund_id is not null;

-- The admin refund queue reads exactly this.
create index if not exists idx_payments_refund_state
  on public.payments (refund_state)
  where refund_state in ('owed','processing','failed');

comment on column public.payments.refund_state is
  'Lifecycle of the refund. refund_amount is what is OWED; this says whether it was actually sent.';
comment on column public.payments.cashfree_refund_id is
  'Our refund id at Cashfree. Unique — doubles as the idempotency key for retries.';
