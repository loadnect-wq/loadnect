-- 0068 — Cashfree PAYOUTS. One row per transfer ATTEMPT, plus the interlocks.
--
-- Replaces Easy Split as the mechanism that moves an owner's advance. See
-- docs/CASHFREE_PAYOUTS_SCOPE.md; the reasoning for every choice here is there.
--
-- WHY A TABLE AND NOT MORE COLUMNS ON payments. Three reasons, all concrete:
--   1. SUCCESS IS NOT FINAL. REVERSED is a documented post-success state — the
--      beneficiary bank sends the money back. So one booking can legitimately
--      have attempt #1 reversed and attempt #2 succeed, and a single status
--      column cannot hold that history.
--   2. Cashfree's status model is two-level (status + status_code +
--      status_description). Collapsing ~90 codes into five legacy values
--      destroys the only information an operator has when money does not land.
--   3. transfer_id must be unique AT CASHFREE and is the only idempotency
--      mechanism available — no idempotency header is documented, and their own
--      Node SDK sends none. It needs a durable home with a unique constraint,
--      written BEFORE the HTTP call.

create table if not exists public.owner_payouts (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references public.bookings(id),
  payment_id          uuid not null references public.payments(id),
  hall_owner_id       uuid not null references public.hall_owners(id),

  attempt             int  not null check (attempt > 0),
  -- What we send. Cashfree contradicts itself on the charset between the
  -- Standard and Batch transfer pages, so we take the intersection: [A-Za-z0-9].
  transfer_id         text not null unique,
  cf_transfer_id      text,
  transfer_utr        text,

  amount_paise        bigint not null check (amount_paise > 0),
  transfer_mode       text   not null default 'banktransfer',
  beneficiary_id      text   not null,
  -- Hash of the destination AT DISPATCH TIME, so a later change to the owner's
  -- bank details is detectable rather than assumed away.
  destination_digest  text   not null,

  -- Stored RAW and unmapped. Classify at the read, never at the write.
  status              text not null,
  status_code         text,
  status_description  text,
  is_terminal         boolean not null default false,

  service_charge_paise bigint,
  service_tax_paise    bigint,

  requested_by        uuid references public.profiles(id),
  dispatched_at       timestamptz,
  last_checked_at     timestamptz,
  settled_at          timestamptz,
  reversed_at         timestamptz,

  request_snapshot    jsonb not null,
  last_response       jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- THE DOUBLE-SPEND GUARD. Easy Split got this free from the gateway (one split
-- per order); under Payouts we build it ourselves. At most one non-terminal
-- transfer per booking, enforced by Postgres rather than by application order.
create unique index if not exists owner_payouts_one_live_per_booking
  on public.owner_payouts (booking_id) where is_terminal = false;
create unique index if not exists owner_payouts_booking_attempt
  on public.owner_payouts (booking_id, attempt);
create index if not exists owner_payouts_open
  on public.owner_payouts (is_terminal, created_at) where is_terminal = false;

-- NO CLIENT ACCESS AT ALL — not even SELECT. Owners see their payout state
-- through mapAdvancePayout, never through this table. Column grants are checked
-- BEFORE row security and RLS alone has already burned this codebase twice, so
-- the grants are the real control and RLS is the second layer.
alter table public.owner_payouts enable row level security;
revoke all on public.owner_payouts from anon, authenticated;
grant all on public.owner_payouts to service_role;

-- ── payments: summary + interlock, NOT the authority ────────────────────────
-- in_flight: dispatched, not terminal — money may or may not have left.
-- reversed:  sent, then returned by the beneficiary bank.
-- 'pending' keeps its meaning (claimed, not yet dispatched) and 'done' keeps
-- its job as issueRefund's double-spend guard. Do not weaken 'done'.
alter table public.payments drop constraint if exists payments_split_status_check;
alter table public.payments add constraint payments_split_status_check
  check (split_status = any (array[
    'none','pending','done','failed','not_applicable','in_flight','reversed'
  ]));

alter table public.payments
  add column if not exists split_payout_id uuid references public.owner_payouts(id);

drop index if exists idx_payments_split_status;
create index idx_payments_split_status on public.payments (split_status)
  where split_status in ('pending','failed','in_flight','reversed');

-- ── hall_owners: the beneficiary, and locking the destination ───────────────
alter table public.hall_owners
  add column if not exists payout_beneficiary_id         text,
  add column if not exists payout_beneficiary_status     text,
  add column if not exists payout_beneficiary_synced_at  timestamptz,
  add column if not exists payout_beneficiary_last_error text,
  add column if not exists payout_details_changed_at     timestamptz;

-- THE MOST IMPORTANT LINE IN THIS MIGRATION. `authenticated` held UPDATE on the
-- bank destination with no re-verification and no notification. While a human
-- eyeballed it that was untidy; under Payouts it is the machine-readable
-- destination of real money, and an account takeover becomes a cash-out.
-- savePayoutDetails now performs the write with the service role, AFTER
-- resolving the owner row from profile_id = auth.uid().
revoke update (payout_account_number, payout_ifsc, payout_upi, payout_account_holder, pan_number)
  on public.hall_owners from authenticated;

-- Stamps when the destination actually changed, which §5.6 compares against a
-- payout's destination_digest before dispatching.
create or replace function public.stamp_payout_details_changed()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.payout_account_number is distinct from old.payout_account_number
     or new.payout_ifsc is distinct from old.payout_ifsc
     or new.payout_upi  is distinct from old.payout_upi
     or new.payout_account_holder is distinct from old.payout_account_holder then
    new.payout_details_changed_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_stamp_payout_details_changed on public.hall_owners;
create trigger trg_stamp_payout_details_changed
  before update on public.hall_owners
  for each row execute function public.stamp_payout_details_changed();

-- ── The comment that stops the next reader paying four times too much ───────
comment on column public.commissions.owner_payout_amount is
  'NOT A TRANSFER AMOUNT. This is base_amount - commission: the owner''s share '
  'across the advance AND the balance they collect at the venue. On a 25% '
  'advance it is roughly FOUR TIMES what Hallnect owes. The payable figure is '
  'payments.split_owner_amount / bookings.owner_net_advance. See scope doc 5.2.';

comment on table public.owner_payouts is
  'One row per Cashfree Payouts transfer ATTEMPT. Authority for payout state; '
  'payments.split_* is the derived summary. Status values are stored raw.';
