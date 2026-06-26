-- ─────────────────────────────────────────────────────────────────────────────
-- 0005_monetization_tables.sql
-- Revenue + operations: premium_listings, advertisements, commissions, support_tickets.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 12. premium_listings ──────────────────────────────────────────────────────
-- A paid window during which a hall is boosted. Written by trusted server only.
create table if not exists public.premium_listings (
  id         uuid primary key default gen_random_uuid(),
  hall_id    uuid not null references public.halls (id) on delete cascade,
  payment_id uuid references public.payments (id) on delete set null,
  start_date date not null,
  end_date   date not null,
  amount     numeric(12, 2) not null check (amount >= 0),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint premium_dates_valid check (end_date >= start_date)
);

create index if not exists idx_premium_hall   on public.premium_listings (hall_id);
create index if not exists idx_premium_active  on public.premium_listings (is_active);

-- ── 13. advertisements ────────────────────────────────────────────────────────
-- Owner-purchased promo slots. status defaults to 'pending'; only admins may
-- move it to 'active'/'rejected' (enforced by trigger in 0006).
create table if not exists public.advertisements (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references public.hall_owners (id) on delete cascade,
  hall_id    uuid references public.halls (id) on delete cascade,
  payment_id uuid references public.payments (id) on delete set null,
  title      text not null,
  image_url  text,
  target_url text,
  placement  text,
  status     ad_status not null default 'pending',
  start_date date,
  end_date   date,
  amount     numeric(12, 2) check (amount is null or amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_dates_valid
    check (start_date is null or end_date is null or end_date >= start_date)
);

create index if not exists idx_ads_status    on public.advertisements (status);
create index if not exists idx_ads_placement on public.advertisements (placement);
create index if not exists idx_ads_owner     on public.advertisements (owner_id);

-- ── 14. commissions ───────────────────────────────────────────────────────────
-- Platform's cut per booking. One per booking. Written by trusted server only.
create table if not exists public.commissions (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null unique references public.bookings (id) on delete cascade,
  hall_owner_id       uuid references public.hall_owners (id) on delete set null,
  booking_amount      numeric(12, 2) not null check (booking_amount >= 0),
  commission_rate     numeric(5, 2)  not null check (commission_rate between 0 and 100),
  commission_amount   numeric(12, 2) not null check (commission_amount >= 0),
  owner_payout_amount numeric(12, 2) not null check (owner_payout_amount >= 0),
  status              commission_status not null default 'pending',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_commissions_owner  on public.commissions (hall_owner_id);
create index if not exists idx_commissions_status on public.commissions (status);

-- ── 15. support_tickets ───────────────────────────────────────────────────────
create table if not exists public.support_tickets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  subject        text not null,
  message        text not null,
  category       text,
  status         ticket_status not null default 'open',
  priority       text not null default 'normal'
                   check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_to    uuid references public.profiles (id) on delete set null,
  admin_response text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_tickets_user     on public.support_tickets (user_id);
create index if not exists idx_tickets_status   on public.support_tickets (status);
create index if not exists idx_tickets_assigned on public.support_tickets (assigned_to);
