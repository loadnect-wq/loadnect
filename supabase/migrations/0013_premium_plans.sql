-- ─────────────────────────────────────────────────────────────────────────────
-- 0013_premium_plans.sql
-- Three-tier premium plans (Free / Premium / Pro) + automatic halls.premium_tier
-- sync from active premium_listings.
--
-- Design:
--   • `premium_plans` is the catalogue of admin-editable plan definitions.
--     Public-readable (the owner upgrade page needs to render pricing).
--     Admin-only writable (RLS).
--   • `premium_listings.plan_slug` records which plan was purchased for each
--     boost window.
--   • `halls.premium_tier` is the DERIVED current tier of a hall, kept in sync
--     by `recompute_hall_premium()` whenever premium_listings change.  This
--     gives public queries a single column to sort/filter by — they never need
--     to read premium_listings directly (which an anon caller can't see anyway
--     under RLS), and the badge can be shown without exposing the listing row.
--   • Expired or inactive listings are excluded by the recompute function, so
--     an expired premium listing CANNOT show as active to the public.
--   • RLS still bars customers and the public from reading premium_listings —
--     they only see the synced tier column on halls.  Owners continue to see
--     their own listings via the existing policy (0007).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. premium_plans (admin-editable catalogue) ─────────────────────────────
create table if not exists public.premium_plans (
  slug           text primary key
    check (slug in ('free', 'premium', 'pro')),
  name           text not null,
  description    text,
  monthly_price  numeric(12, 2) not null default 0
    check (monthly_price >= 0),
  duration_days  integer not null default 30
    check (duration_days > 0),
  is_purchasable boolean not null default true,
  sort_order     integer not null default 0,
  updated_at     timestamptz not null default now()
);

insert into public.premium_plans (slug, name, description, monthly_price, duration_days, is_purchasable, sort_order) values
  ('free',    'Free',
   'Basic listing with normal search ranking and limited visibility.',
   0,    30, false, 0),
  ('premium', 'Premium',
   'Featured badge, higher search ranking, more visibility, basic analytics.',
   999,  30, true,  1),
  ('pro',     'Pro',
   'Homepage promotion, top placement, advanced analytics, priority support.',
   2499, 30, true,  2)
on conflict (slug) do nothing;

drop trigger if exists trg_set_updated_at on public.premium_plans;
create trigger trg_set_updated_at
  before update on public.premium_plans
  for each row execute function public.set_updated_at();

alter table public.premium_plans enable row level security;

-- Anyone can read the plan catalogue (owners need it for the upgrade page,
-- customers may see it on the public premium marketing page).
drop policy if exists premium_plans_public_read on public.premium_plans;
create policy premium_plans_public_read on public.premium_plans
  for select using (true);

-- Only admins can edit the catalogue.
drop policy if exists premium_plans_admin_write on public.premium_plans;
create policy premium_plans_admin_write on public.premium_plans
  for all using (public.is_admin()) with check (public.is_admin());

-- ── 2. premium_listings.plan_slug ───────────────────────────────────────────
alter table public.premium_listings
  add column if not exists plan_slug text
    references public.premium_plans (slug) on update cascade
    default 'premium';

-- Backfill any historical rows.
update public.premium_listings set plan_slug = 'premium' where plan_slug is null;

-- Free plan must never appear on a listing — listings are paid windows.
alter table public.premium_listings
  drop constraint if exists premium_listings_plan_not_free;
alter table public.premium_listings
  add constraint premium_listings_plan_not_free
  check (plan_slug in ('premium', 'pro'));

create index if not exists idx_premium_listings_plan
  on public.premium_listings (plan_slug);

-- ── 3. halls.premium_tier (synced from active listings) ─────────────────────
alter table public.halls
  add column if not exists premium_tier text
    check (premium_tier is null or premium_tier in ('premium', 'pro'));

create index if not exists idx_halls_premium_tier on public.halls (premium_tier);

-- ── 4. Sync function + trigger ──────────────────────────────────────────────
-- Recomputes a hall's premium_tier (and the legacy is_premium boolean) from
-- the highest-priority ACTIVE listing for that hall.  Pro outranks Premium.
-- "Active" = is_active AND today is within [start_date, end_date].
create or replace function public.recompute_hall_premium(target_hall uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  new_tier text;
begin
  select case
    when exists (
      select 1 from public.premium_listings
       where hall_id = target_hall
         and is_active = true
         and start_date <= current_date
         and end_date   >= current_date
         and plan_slug  = 'pro'
    ) then 'pro'
    when exists (
      select 1 from public.premium_listings
       where hall_id = target_hall
         and is_active = true
         and start_date <= current_date
         and end_date   >= current_date
         and plan_slug  = 'premium'
    ) then 'premium'
    else null
  end into new_tier;

  update public.halls
     set premium_tier = new_tier,
         is_premium   = (new_tier is not null)
   where id = target_hall;
end;
$$;

create or replace function public.trg_recompute_hall_premium()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_hall_premium(old.hall_id);
    return old;
  end if;
  perform public.recompute_hall_premium(new.hall_id);
  if tg_op = 'UPDATE' and old.hall_id is distinct from new.hall_id then
    perform public.recompute_hall_premium(old.hall_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_premium_listings_sync on public.premium_listings;
create trigger trg_premium_listings_sync
  after insert or update or delete on public.premium_listings
  for each row execute function public.trg_recompute_hall_premium();

-- Backfill every hall so the tier column reflects current reality.
do $$
declare h record;
begin
  for h in select id from public.halls loop
    perform public.recompute_hall_premium(h.id);
  end loop;
end $$;

-- ── 5. Manual-activation safety: owners must not self-create listings ───────
-- premium_listings already has no client INSERT/UPDATE policy (only the
-- service-role + admin write it).  Belt-and-braces: a trigger that rejects
-- any write that doesn't come from a trusted backend or admin, so a future
-- RLS change cannot accidentally permit owners to activate their own premium.
create or replace function public.guard_premium_listing_writes()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return coalesce(new, old);
  end if;
  raise exception 'Not allowed: only an administrator (or the trusted backend after payment) can modify premium listings';
end;
$$;

drop trigger if exists trg_guard_premium_listing_writes on public.premium_listings;
create trigger trg_guard_premium_listing_writes
  before insert or update or delete on public.premium_listings
  for each row execute function public.guard_premium_listing_writes();
