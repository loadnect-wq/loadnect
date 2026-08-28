-- ─────────────────────────────────────────────────────────────────────────────
-- 0044 — Premium / Pro become auto-renewing MONTHLY SUBSCRIPTIONS.
--
-- Until now a plan was a one-off: pay Rs4,999, get 30 days, and the boost went
-- dark unless the owner remembered to buy again. Cashfree Subscriptions charges
-- the owner's mandate every month on its own, so the listing renews without
-- anyone doing anything.
--
-- HOW THE TWO TABLES RELATE, AND WHY plan_purchases IS REUSED:
--   plan_subscriptions  = the standing agreement (one row per owner+hall+plan).
--   plan_purchases      = one row per ACTUAL CHARGE, exactly as before.
--
-- Every monthly charge lands as a plan_purchases row linked back to the
-- subscription. That is deliberate: it means each renewal goes through the
-- machinery already built and tested for one-off purchases — the price guard
-- (guard_plan_purchase_integrity), and above all the exactly-once activation
-- via premium_listings.plan_purchase_id (migration 0043). A redelivered renewal
-- webhook can no more grant two months than a redelivered one-off could.
-- ─────────────────────────────────────────────────────────────────────────────

-- Which Cashfree plan each of our plans maps to. Created in the Cashfree
-- dashboard; the app never creates plans at runtime.
alter table public.premium_plans
  add column if not exists cf_plan_id text;

update public.premium_plans set cf_plan_id = 'hallnect_premium_monthly' where slug = 'premium';
update public.premium_plans set cf_plan_id = 'hallnect_pro_monthly'     where slug = 'pro';

comment on column public.premium_plans.cf_plan_id is
  'The Cashfree Subscriptions plan_id this plan maps to. NULL means the plan '
  'cannot be subscribed to. Plans are created in the Cashfree dashboard, never '
  'by the app.';

create table if not exists public.plan_subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references public.hall_owners(id) on delete cascade,
  hall_id              uuid not null references public.halls(id)       on delete cascade,
  plan_slug            text not null references public.premium_plans(slug),

  -- The id WE generate and send to Cashfree, and the one THEY return.
  cf_subscription_id   text not null unique,
  cf_subscription_ref  text,
  cf_plan_id           text not null,

  -- Snapshot of the monthly charge at the time the mandate was authorised.
  amount               numeric(12,2) not null check (amount > 0),

  status               text not null default 'created'
                         check (status in ('created','active','cancelled','failed','completed','paused','on_hold')),

  authorized_at        timestamptz,
  cancelled_at         timestamptz,
  next_charge_at       timestamptz,
  last_synced_at       timestamptz,
  raw_response         jsonb,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_plan_subscriptions_owner  on public.plan_subscriptions (owner_id);
create index if not exists idx_plan_subscriptions_hall   on public.plan_subscriptions (hall_id);
create index if not exists idx_plan_subscriptions_status on public.plan_subscriptions (status);

-- At most ONE live subscription per hall+plan. Without this a double-click
-- during mandate authorisation could leave an owner paying twice a month for
-- the same boost, forever, which is far worse than a duplicate one-off.
create unique index if not exists uq_plan_subscriptions_live
  on public.plan_subscriptions (hall_id, plan_slug)
  where status in ('created', 'active', 'on_hold', 'paused');

alter table public.plan_subscriptions enable row level security;

drop policy if exists plan_subscriptions_owner_select on public.plan_subscriptions;
create policy plan_subscriptions_owner_select on public.plan_subscriptions
  for select using (public.owns_owner_row(owner_id));

drop policy if exists plan_subscriptions_admin_write on public.plan_subscriptions;
create policy plan_subscriptions_admin_write on public.plan_subscriptions
  for all using (public.is_admin()) with check (public.is_admin());

drop trigger if exists trg_plan_subscriptions_updated_at on public.plan_subscriptions;
create trigger trg_plan_subscriptions_updated_at
  before update on public.plan_subscriptions
  for each row execute function public.set_updated_at();

-- ── Each charge, linked back to the agreement that produced it ───────────────

alter table public.plan_purchases
  add column if not exists subscription_id uuid references public.plan_subscriptions(id) on delete set null,
  add column if not exists cf_payment_ref  text,
  add column if not exists cycle           integer;

-- A subscription charge has no order id — it has a PAYMENT id. This is the
-- idempotency key for renewals, exactly as cashfree_order_id is for one-offs:
-- a redelivered renewal webhook cannot create a second charge row, and
-- therefore cannot grant a second month.
create unique index if not exists uq_plan_purchases_cf_payment
  on public.plan_purchases (cf_payment_ref)
  where cf_payment_ref is not null;

create index if not exists idx_plan_purchases_subscription
  on public.plan_purchases (subscription_id);

comment on column public.plan_purchases.subscription_id is
  'The standing subscription that produced this charge. NULL for the historical '
  'one-off purchases that predate migration 0044.';
comment on column public.plan_purchases.cf_payment_ref is
  'Cashfree payment id for a SUBSCRIPTION charge. UNIQUE where present — this is '
  'what makes a redelivered renewal webhook idempotent, the way '
  'cashfree_order_id is for a one-off purchase.';

comment on table public.plan_subscriptions is
  'Auto-renewing monthly Premium/Pro subscriptions (Cashfree Subscriptions + '
  'mandate). One row per standing agreement; each individual monthly charge is a '
  'plan_purchases row pointing back here, so renewals reuse the same exactly-once '
  'activation path as one-off purchases.';
