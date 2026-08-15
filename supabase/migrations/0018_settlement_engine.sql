-- ─────────────────────────────────────────────────────────────────────────────
-- 0018_settlement_engine.sql
-- Cashfree Easy Split marketplace settlement engine — PAISE-INTEGER LEDGER.
--
-- This migration runs ALONGSIDE the existing rupee-`numeric` booking model. It
-- does NOT alter or migrate any existing money column. The new ledger tables
-- store every amount as an INTEGER number of paise (bigint, ₹1 = 100 paise) so
-- commission + owner_share reconcile to the gross with zero floating-point drift
-- (see lib/money.ts).
--
-- Additive + idempotent: only `create table if not exists` / `add column if not
-- exists` / `create ... if not exists`. Safe to re-run. No drops.
--
-- SCOPE THIS TURN (per the agreed "safe additive foundation"): schema + RLS +
-- guards + idempotency. The LIVE Cashfree Easy Split split/settlement API calls
-- are stubbed behind a feature flag in lib/settlement.ts until vendor
-- credentials exist — this migration provisions the tables they will write to.
--
-- CUSTOMER-SAFETY INVARIANT (unchanged): nothing here ever reduces a customer's
-- recorded advance. Commission/owner splits only divide money already collected;
-- settlement adjustments (0017) still only reduce the OWNER payout.
-- ─────────────────────────────────────────────────────────────────────────────

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. hall_owners — Cashfree vendor identity + KYC lifecycle                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.hall_owners
  add column if not exists cashfree_vendor_id text,
  add column if not exists vendor_kyc_status  text not null default 'NOT_CONNECTED'
    check (vendor_kyc_status in ('NOT_CONNECTED','PENDING','VERIFIED','SUSPENDED'));

create index if not exists idx_hall_owners_vendor on public.hall_owners (cashfree_vendor_id);

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. payment_transactions — one authoritative row per checkout (paise)         ║
-- ║    gross = commission + owner_share (+ optional platform-absorbed fees).     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.payment_transactions (
  id                     uuid primary key default gen_random_uuid(),
  booking_id             uuid references public.bookings (id)    on delete set null,
  customer_id            uuid references public.profiles (id)    on delete set null,
  owner_id               uuid references public.hall_owners (id) on delete set null,

  -- Money — INTEGER PAISE only. Never fractional, never float.
  gross_amount_paise      bigint not null check (gross_amount_paise      >= 0),
  commission_amount_paise bigint not null default 0 check (commission_amount_paise >= 0),
  owner_amount_paise      bigint not null default 0 check (owner_amount_paise      >= 0),
  commission_rate         numeric(5,2) not null default 0 check (commission_rate between 0 and 100),
  currency                text not null default 'INR',

  -- Cashfree references
  cashfree_order_id       text unique,
  cashfree_payment_id     text,
  cashfree_split_group_id text,

  -- Lifecycle state machines (text + CHECK; advanced only by trusted backend)
  payment_status    text not null default 'PENDING'
    check (payment_status    in ('PENDING','SUCCESS','FAILED','USER_DROPPED','CANCELLED','REFUNDED')),
  split_status      text not null default 'PENDING'
    check (split_status      in ('NOT_APPLICABLE','PENDING','PROCESSED','FAILED')),
  settlement_status text not null default 'PENDING'
    check (settlement_status in ('PENDING','PROCESSING','SETTLED','FAILED')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The split can never exceed the gross (fees may be absorbed by the platform,
  -- so we allow <= rather than strict = ). Non-negativity is on each column.
  constraint pt_split_within_gross
    check (commission_amount_paise + owner_amount_paise <= gross_amount_paise)
);

create index if not exists idx_pt_booking    on public.payment_transactions (booking_id);
create index if not exists idx_pt_customer   on public.payment_transactions (customer_id);
create index if not exists idx_pt_owner      on public.payment_transactions (owner_id);
create index if not exists idx_pt_pay_status on public.payment_transactions (payment_status);
create index if not exists idx_pt_settle     on public.payment_transactions (settlement_status);

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. payment_webhook_events — provider webhook idempotency + audit             ║
-- ║    UNIQUE(provider, event_id) is the idempotency backstop: a re-delivered    ║
-- ║    event hits the constraint and is skipped.                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.payment_webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null default 'cashfree',
  event_id           text not null,
  event_type         text,
  payload            jsonb,
  signature_verified boolean not null default false,
  processing_status  text not null default 'RECEIVED'
    check (processing_status in ('RECEIVED','PROCESSED','FAILED','IGNORED')),
  error_note         text,
  created_at         timestamptz not null default now(),
  processed_at       timestamptz,
  constraint uq_webhook_provider_event unique (provider, event_id)
);

create index if not exists idx_wh_status on public.payment_webhook_events (processing_status);

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. commission_transactions — platform earnings ledger (paise)                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.commission_transactions (
  id                     uuid primary key default gen_random_uuid(),
  payment_transaction_id uuid references public.payment_transactions (id) on delete cascade,
  booking_id             uuid references public.bookings (id)    on delete set null,
  owner_id               uuid references public.hall_owners (id) on delete set null,
  amount_paise           bigint not null check (amount_paise >= 0),
  status                 text not null default 'EARNED'
    check (status in ('EARNED','REVERSED')),
  note                   text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- One commission ledger row per payment transaction (idempotency).
  constraint uq_ct_payment unique (payment_transaction_id)
);

create index if not exists idx_ct_owner on public.commission_transactions (owner_id);

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. settlement_transactions — vendor payout lifecycle (paise)                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.settlement_transactions (
  id                     uuid primary key default gen_random_uuid(),
  payment_transaction_id uuid references public.payment_transactions (id) on delete cascade,
  owner_id               uuid references public.hall_owners (id) on delete set null,
  amount_paise           bigint not null check (amount_paise >= 0),
  cashfree_settlement_id text,
  status                 text not null default 'PENDING'
    check (status in ('PENDING','PROCESSING','SETTLED','FAILED')),
  settled_at             timestamptz,
  note                   text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- One settlement ledger row per payment transaction (idempotency).
  constraint uq_st_payment unique (payment_transaction_id)
);

create index if not exists idx_st_owner  on public.settlement_transactions (owner_id);
create index if not exists idx_st_status on public.settlement_transactions (status);

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 6. updated_at automation                                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
declare t text;
begin
  foreach t in array array[
    'payment_transactions','commission_transactions','settlement_transactions'
  ]
  loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I;', t);
    execute format(
      'create trigger trg_set_updated_at before update on public.%I
         for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 7. Row-Level Security                                                         ║
-- ║   Financial ledger tables:                                                   ║
-- ║     • customer: reads only their own payment_transactions.                   ║
-- ║     • owner: reads only their own payment/commission/settlement rows.        ║
-- ║     • admin: full access.                                                    ║
-- ║     • writes: admin only (client); the trusted backend (service-role) writes ║
-- ║       the engine rows and bypasses RLS.                                      ║
-- ║   Webhook events: admin-only; never exposed to customers/owners.             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.payment_transactions    enable row level security;
alter table public.commission_transactions enable row level security;
alter table public.settlement_transactions enable row level security;
alter table public.payment_webhook_events  enable row level security;

-- payment_transactions
drop policy if exists pt_select on public.payment_transactions;
create policy pt_select on public.payment_transactions
  for select using (
    public.is_admin()
    or customer_id = auth.uid()
    or public.owns_owner_row(owner_id)
  );
drop policy if exists pt_admin_write on public.payment_transactions;
create policy pt_admin_write on public.payment_transactions
  for all using (public.is_admin()) with check (public.is_admin());

-- commission_transactions (owner reads own; NO customer access → default-deny)
drop policy if exists ct_select on public.commission_transactions;
create policy ct_select on public.commission_transactions
  for select using (public.is_admin() or public.owns_owner_row(owner_id));
drop policy if exists ct_admin_write on public.commission_transactions;
create policy ct_admin_write on public.commission_transactions
  for all using (public.is_admin()) with check (public.is_admin());

-- settlement_transactions (owner reads own; NO customer access)
drop policy if exists st_select on public.settlement_transactions;
create policy st_select on public.settlement_transactions
  for select using (public.is_admin() or public.owns_owner_row(owner_id));
drop policy if exists st_admin_write on public.settlement_transactions;
create policy st_admin_write on public.settlement_transactions
  for all using (public.is_admin()) with check (public.is_admin());

-- payment_webhook_events (admin only)
drop policy if exists wh_admin_all on public.payment_webhook_events;
create policy wh_admin_all on public.payment_webhook_events
  for all using (public.is_admin()) with check (public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 8. Guard triggers — defense-in-depth on the financial ledger                 ║
-- ║   Even if a future RLS change slips, only admin / trusted-backend may write  ║
-- ║   the ledger tables. Customers/owners can never mutate money rows.           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.guard_ledger_writes()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return coalesce(new, old);
  end if;
  raise exception 'Not allowed: only an administrator or the settlement backend may write financial ledger rows';
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'payment_transactions','commission_transactions','settlement_transactions','payment_webhook_events'
  ]
  loop
    execute format('drop trigger if exists trg_guard_ledger_writes on public.%I;', t);
    execute format(
      'create trigger trg_guard_ledger_writes
         before insert or update or delete on public.%I
         for each row execute function public.guard_ledger_writes();', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- End 0018. Paise ledger provisioned; live Easy Split calls are feature-flagged
-- in lib/settlement.ts until Cashfree vendor credentials are configured.
-- ─────────────────────────────────────────────────────────────────────────────
