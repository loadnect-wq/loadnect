-- ─────────────────────────────────────────────────────────────────────────────
-- 0027 — Owner-paid commission via Cashfree + owner booking-approval upgrade
--
-- PRICING MODEL CHANGE (decided with the operator):
--   Before: customer paid base + 5%, AND the owner was billed the same 5%.
--           Hallnect collected the commission TWICE.
--   After:  customer pays the hall price only; the owner owes 5% of the hall
--           price and settles it through Cashfree. Hallnect earns it once.
--   bookings.platform_fee keeps recording that 5% (it is the owner's commission
--   snapshot at booking time) but is NO LONGER added into total_amount.
--
-- Additive only: no drops, no data loss, no RLS weakening.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Commission settlement through the payment gateway ────────────────────
-- owner_commission_payments already models a manual UPI submission awaiting
-- admin verification. A gateway payment is the same lifecycle with the
-- verification performed by Cashfree instead of a human, so it extends that
-- table rather than introducing a parallel one.
alter table public.owner_commission_payments
  add column if not exists cashfree_order_id   text,
  add column if not exists cashfree_payment_id text,
  add column if not exists payment_session_id  text,
  add column if not exists raw_response        jsonb;

-- One gateway order maps to exactly one settlement row. This UNIQUE index is
-- the idempotency backbone: a webhook redelivery cannot create a second row.
create unique index if not exists uq_ocp_cashfree_order
  on public.owner_commission_payments (cashfree_order_id)
  where cashfree_order_id is not null;

create index if not exists idx_ocp_commission on public.owner_commission_payments (commission_id);
create index if not exists idx_ocp_status     on public.owner_commission_payments (status);

-- Gateway flow needs two states the manual flow never had: 'created' (order
-- opened, customer not yet paid) and 'failed' (gateway reported failure).
do $mig$
begin
  alter table public.owner_commission_payments
    drop constraint if exists owner_commission_payments_status_check;
  alter table public.owner_commission_payments
    add constraint owner_commission_payments_status_check
    check (status = any (array[
      'created', 'payment_submitted', 'payment_under_review',
      'verified', 'rejected', 'failed'
    ]));
end
$mig$;

-- ── 2. Guard: a settlement row must match its commission ────────────────────
-- The RLS INSERT policy validates only owner_id and status, leaving
-- commission_id and amount attacker-controlled — an owner could settle a full
-- commission with a ₹1 claim, or file against a rival owner's commission.
-- Enforce both at the database level, where a crafted request cannot reach.
create or replace function public.guard_commission_payment_integrity()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  c record;
begin
  select id, hall_owner_id, commission_amount, status
    into c
  from public.commissions
  where id = new.commission_id;

  if c.id is null then
    raise exception 'Commission not found';
  end if;

  -- The settlement must belong to the owner who owes the commission.
  if c.hall_owner_id is distinct from new.owner_id then
    raise exception 'This commission belongs to a different owner';
  end if;

  -- And it must settle the full amount owed — no partial or token payments.
  if new.amount is distinct from c.commission_amount then
    raise exception 'Payment amount must equal the commission amount owed';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_ocp_integrity on public.owner_commission_payments;
create trigger trg_ocp_integrity
  before insert or update of commission_id, owner_id, amount
  on public.owner_commission_payments
  for each row execute function public.guard_commission_payment_integrity();

-- ── 3. Owner booking-approval response deadline ─────────────────────────────
-- A booking request the owner never answers silently blocks the calendar
-- forever. Stamp a deadline so it can be swept and the dates released.
alter table public.bookings
  add column if not exists owner_response_due_at timestamptz;

create index if not exists idx_bookings_owner_due
  on public.bookings (owner_response_due_at)
  where status = 'booking_requested';

-- Existing open requests get a deadline from now so none are stranded.
update public.bookings
   set owner_response_due_at = now() + interval '48 hours'
 where status = 'booking_requested' and owner_response_due_at is null;

-- Stamp the deadline automatically whenever a booking enters booking_requested.
create or replace function public.stamp_owner_response_deadline()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if new.status = 'booking_requested'
     and (old.status is distinct from 'booking_requested')
     and new.owner_response_due_at is null then
    new.owner_response_due_at := now() + interval '48 hours';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_stamp_owner_response_deadline on public.bookings;
create trigger trg_stamp_owner_response_deadline
  before insert or update of status on public.bookings
  for each row execute function public.stamp_owner_response_deadline();
