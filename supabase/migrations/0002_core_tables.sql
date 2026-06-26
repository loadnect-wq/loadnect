-- ─────────────────────────────────────────────────────────────────────────────
-- 0002_core_tables.sql
-- Core identity + catalogue tables:
--   profiles, hall_owners, halls, hall_images, amenities, hall_amenities
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. profiles ───────────────────────────────────────────────────────────────
-- One row per auth.users row. Created automatically by handle_new_user (0006).
-- The `role` column is the single source of truth for authorization.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  email       text,
  phone       text,
  avatar_url  text,
  role        user_role   not null default 'customer',
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_profiles_role  on public.profiles (role);
create index if not exists idx_profiles_email on public.profiles (email);

-- ── 2. hall_owners ────────────────────────────────────────────────────────────
-- Business/KYC details for a user who lists halls. One per profile.
-- is_verified / verified_* are ADMIN-ONLY (enforced by trigger in 0006).
create table if not exists public.hall_owners (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null unique references public.profiles (id) on delete cascade,
  business_name  text not null,
  business_email text,
  business_phone text,
  gst_number     text,
  pan_number     text,
  address        text,
  city           text,
  state          text,
  payout_upi     text,
  is_verified    boolean     not null default false,
  verified_at    timestamptz,
  verified_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_hall_owners_verified on public.hall_owners (is_verified);

-- ── 3. halls ──────────────────────────────────────────────────────────────────
-- A listable venue. status is ADMIN-controlled for approval transitions (0006).
-- rating_average / rating_count are maintained by trigger from reviews (0006).
create table if not exists public.halls (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.hall_owners (id) on delete cascade,
  name           text not null,
  slug           text not null unique,
  description    text,
  city           text not null,
  state          text,
  address        text,
  pincode        text,
  latitude       numeric(9, 6),
  longitude      numeric(9, 6),
  capacity_min   integer check (capacity_min is null or capacity_min >= 0),
  capacity_max   integer not null check (capacity_max > 0),
  price_per_day  numeric(12, 2) not null check (price_per_day >= 0),
  price_morning  numeric(12, 2) check (price_morning is null or price_morning >= 0),
  price_evening  numeric(12, 2) check (price_evening is null or price_evening >= 0),
  status         hall_status   not null default 'draft',
  is_premium     boolean       not null default false,
  rating_average numeric(2, 1) not null default 0 check (rating_average between 0 and 5),
  rating_count   integer       not null default 0 check (rating_count >= 0),
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now(),
  constraint capacity_range_valid
    check (capacity_min is null or capacity_min <= capacity_max),
  constraint slug_format_valid
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists idx_halls_owner   on public.halls (owner_id);
create index if not exists idx_halls_status  on public.halls (status);
create index if not exists idx_halls_city    on public.halls (city);
create index if not exists idx_halls_premium on public.halls (is_premium);
create index if not exists idx_halls_rating  on public.halls (rating_average desc);

-- ── 4. hall_images ────────────────────────────────────────────────────────────
create table if not exists public.hall_images (
  id           uuid primary key default gen_random_uuid(),
  hall_id      uuid not null references public.halls (id) on delete cascade,
  url          text not null,
  storage_path text,
  alt_text     text,
  is_cover     boolean     not null default false,
  sort_order   integer     not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists idx_hall_images_hall on public.hall_images (hall_id);
-- At most one cover image per hall.
create unique index if not exists uq_hall_images_one_cover
  on public.hall_images (hall_id) where is_cover;

-- ── 5. amenities ──────────────────────────────────────────────────────────────
-- Global catalogue, admin-managed.
create table if not exists public.amenities (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  slug       text not null unique,
  icon       text,
  category   text,
  created_at timestamptz not null default now()
);

-- ── 6. hall_amenities (junction) ──────────────────────────────────────────────
create table if not exists public.hall_amenities (
  hall_id    uuid not null references public.halls (id) on delete cascade,
  amenity_id uuid not null references public.amenities (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (hall_id, amenity_id)
);

create index if not exists idx_hall_amenities_amenity on public.hall_amenities (amenity_id);
