-- ─────────────────────────────────────────────────────────────────────────────
-- 0040 — Premium / Pro plan purchases through Cashfree.
--
-- Until now a listing became premium only when an admin typed an amount into a
-- free-text field at /admin/premium-listings. There was no payment step
-- anywhere in the product: the owner upgrade page linked to "Contact us to
-- activate" and money was collected out of band.
--
-- WHY A SEPARATE TABLE AND NOT `payments`:
--   public.payments.booking_id is `uuid NOT NULL references bookings(id)` and
--   customer_id is NOT NULL (migration 0003). A plan purchase has no booking
--   and no customer — it is an OWNER buying visibility — so it cannot be
--   recorded there. Same reason owner commission settlements got their own
--   table.
--
-- The row is written server-side only: there is no owner INSERT policy, because
-- the amount must come from the premium_plans catalogue and never from the
-- browser. Owners may read their own purchases; admins may do anything.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.plan_purchases (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.hall_owners(id)   on delete cascade,
  hall_id             uuid not null references public.halls(id)         on delete cascade,
  plan_slug           text not null references public.premium_plans(slug),

  -- Snapshot of what was charged, taken from premium_plans at creation. Never
  -- recomputed afterwards: a later price change must not rewrite what an owner
  -- actually paid.
  amount              numeric(12,2) not null check (amount > 0),
  duration_days       integer       not null check (duration_days between 1 and 365),

  status              text not null default 'created'
                        check (status in ('created', 'paid', 'failed')),

  cashfree_order_id   text,
  payment_session_id  text,
  cashfree_payment_id text,
  raw_response        jsonb,

  -- Set once the payment is verified and the listing is activated. The link is
  -- what makes activation idempotent: a redelivered webhook finds it already
  -- populated and does nothing.
  premium_listing_id  uuid references public.premium_listings(id) on delete set null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  paid_at             timestamptz
);

-- A redelivered webhook must never create a second purchase for one order.
create unique index if not exists uq_plan_purchases_cashfree_order
  on public.plan_purchases (cashfree_order_id)
  where cashfree_order_id is not null;

create index if not exists idx_plan_purchases_owner  on public.plan_purchases (owner_id);
create index if not exists idx_plan_purchases_hall   on public.plan_purchases (hall_id);
create index if not exists idx_plan_purchases_status on public.plan_purchases (status);

alter table public.plan_purchases enable row level security;

-- Owner reads their own purchases (for the receipt / status page).
drop policy if exists plan_purchases_owner_select on public.plan_purchases;
create policy plan_purchases_owner_select on public.plan_purchases
  for select
  using (
    exists (
      select 1 from public.hall_owners o
       where o.id = plan_purchases.owner_id
         and o.profile_id = auth.uid()
    )
  );

drop policy if exists plan_purchases_admin_write on public.plan_purchases;
create policy plan_purchases_admin_write on public.plan_purchases
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop trigger if exists trg_plan_purchases_updated_at on public.plan_purchases;
create trigger trg_plan_purchases_updated_at
  before update on public.plan_purchases
  for each row execute function public.set_updated_at();

-- ── Integrity guard ─────────────────────────────────────────────────────────
-- Independent of the application: what is recorded at creation must match the
-- published catalogue, and the hall must belong to the owner being charged. So
-- even a direct service-role insert cannot record a plan at the wrong price or
-- against someone else's hall.
create or replace function public.guard_plan_purchase_integrity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  plan_price numeric(12,2);
  plan_days  integer;
  plan_buyable boolean;
  hall_owner uuid;
begin
  select monthly_price, duration_days, is_purchasable
    into plan_price, plan_days, plan_buyable
    from public.premium_plans where slug = new.plan_slug;

  if plan_price is null then
    raise exception 'plan_purchases: unknown plan %', new.plan_slug;
  end if;

  if not plan_buyable then
    raise exception 'plan_purchases: plan % is not purchasable', new.plan_slug;
  end if;

  if new.amount is distinct from plan_price then
    raise exception 'plan_purchases: amount % does not match the % plan price %',
      new.amount, new.plan_slug, plan_price;
  end if;

  if new.duration_days is distinct from plan_days then
    raise exception 'plan_purchases: duration % does not match the % plan duration %',
      new.duration_days, new.plan_slug, plan_days;
  end if;

  select owner_id into hall_owner from public.halls where id = new.hall_id;
  if hall_owner is null or hall_owner is distinct from new.owner_id then
    raise exception 'plan_purchases: hall % does not belong to owner %',
      new.hall_id, new.owner_id;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_plan_purchase_integrity() from public, anon, authenticated;

-- INSERT only. An in-flight purchase must survive a later catalogue price
-- change: the snapshot is what the owner agreed to pay.
drop trigger if exists trg_guard_plan_purchase on public.plan_purchases;
create trigger trg_guard_plan_purchase
  before insert on public.plan_purchases
  for each row execute function public.guard_plan_purchase_integrity();

comment on table public.plan_purchases is
  'Owner purchases of a Premium/Pro listing plan through Cashfree. Amount and '
  'duration are snapshotted from premium_plans at creation and guarded by '
  'trg_guard_plan_purchase. Written server-side only — there is no owner INSERT '
  'policy. On verified payment the row links to the premium_listings row it '
  'activated, which is what makes webhook redelivery idempotent.';
