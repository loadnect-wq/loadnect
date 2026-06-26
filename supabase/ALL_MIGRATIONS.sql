-- ============================================================================
-- Hallnect — ALL MIGRATIONS (0001–0016), combined in order.
-- Paste this entire file into the Supabase SQL Editor and click RUN.
-- Idempotent: safe to re-run (uses IF NOT EXISTS / DROP IF EXISTS / ON CONFLICT).
-- ============================================================================


-- ============================================================================
-- FILE: 0001_extensions_and_enums.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0001_extensions_and_enums.sql
-- Extensions + all ENUM types for Hallnect.
-- Run this FIRST.
-- ─────────────────────────────────────────────────────────────────────────────

-- gen_random_uuid() lives in pgcrypto (bundled with Supabase).
create extension if not exists pgcrypto;

-- ── User roles ────────────────────────────────────────────────────────────────
-- NOTE: 'admin' is intentionally part of this enum but is NEVER assignable by a
-- normal user. Role escalation is blocked by RLS + the prevent_role_change trigger
-- (see 0006). New signups can only become 'customer' or 'owner_pending'.
do $$ begin
  create type user_role as enum (
    'customer',
    'owner_pending',
    'owner_approved',
    'admin'
  );
exception when duplicate_object then null; end $$;

-- ── Hall lifecycle ────────────────────────────────────────────────────────────
do $$ begin
  create type hall_status as enum (
    'draft',
    'pending_approval',
    'approved',
    'rejected',
    'suspended'
  );
exception when duplicate_object then null; end $$;

-- ── Booking lifecycle ─────────────────────────────────────────────────────────
do $$ begin
  create type booking_status as enum (
    'pending_payment',
    'payment_success',
    'booking_requested',
    'owner_confirmed',
    'owner_rejected',
    'cancelled',
    'completed',
    'refunded'
  );
exception when duplicate_object then null; end $$;

-- ── Availability calendar ─────────────────────────────────────────────────────
do $$ begin
  create type availability_status as enum (
    'available',
    'booked',
    'partially_booked',
    'blocked',
    'morning_booked',
    'evening_booked',
    'full_day_booked',
    'maintenance'
  );
exception when duplicate_object then null; end $$;

-- ── Payment lifecycle (Cashfree) ──────────────────────────────────────────────
do $$ begin
  create type payment_status as enum (
    'pending',
    'created',
    'payment_success',
    'payment_failed',
    'user_dropped',
    'cancelled',
    'refunded'
  );
exception when duplicate_object then null; end $$;

-- ── Booking slot (used for double-booking prevention) ─────────────────────────
do $$ begin
  create type booking_slot as enum ('morning', 'evening', 'full_day');
exception when duplicate_object then null; end $$;

-- ── Support ticket lifecycle ──────────────────────────────────────────────────
do $$ begin
  create type ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');
exception when duplicate_object then null; end $$;

-- ── Advertisement lifecycle ───────────────────────────────────────────────────
do $$ begin
  create type ad_status as enum ('pending', 'active', 'paused', 'expired', 'rejected');
exception when duplicate_object then null; end $$;

-- ── Commission lifecycle ──────────────────────────────────────────────────────
do $$ begin
  create type commission_status as enum ('pending', 'collected', 'paid_out', 'refunded');
exception when duplicate_object then null; end $$;


-- ============================================================================
-- FILE: 0002_core_tables.sql
-- ============================================================================

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


-- ============================================================================
-- FILE: 0003_booking_tables.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0003_booking_tables.sql
-- Transactional tables: bookings, payments, availability.
-- bookings is created before availability/payments because they reference it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 8. bookings ───────────────────────────────────────────────────────────────
-- NOTE: financial amounts are stored on the booking at creation time so that
-- later price changes on the hall never retroactively alter past bookings.
create table if not exists public.bookings (
  id            uuid primary key default gen_random_uuid(),
  hall_id       uuid not null references public.halls (id)    on delete restrict,
  customer_id   uuid not null references public.profiles (id) on delete restrict,
  event_date    date not null,
  slot          booking_slot   not null default 'full_day',
  guest_count   integer check (guest_count is null or guest_count > 0),
  base_amount   numeric(12, 2) not null check (base_amount  >= 0),
  platform_fee  numeric(12, 2) not null default 0 check (platform_fee >= 0),
  total_amount  numeric(12, 2) not null check (total_amount >= 0),
  status        booking_status not null default 'pending_payment',
  customer_notes text,
  owner_notes    text,
  cancel_reason  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint event_date_not_past check (event_date >= '2024-01-01')
);

create index if not exists idx_bookings_hall     on public.bookings (hall_id);
create index if not exists idx_bookings_customer on public.bookings (customer_id);
create index if not exists idx_bookings_date     on public.bookings (event_date);
create index if not exists idx_bookings_status   on public.bookings (status);

-- DOUBLE-BOOKING PREVENTION (hard constraint):
-- Only one ACTIVE booking may hold a given (hall, date, slot). Pending-payment,
-- cancelled, rejected and refunded bookings do NOT reserve the slot, so the
-- index is partial. Full-day vs half-day overlap is additionally enforced by the
-- prevent_overlapping_booking trigger in 0006.
create unique index if not exists uq_booking_active_slot
  on public.bookings (hall_id, event_date, slot)
  where status in ('payment_success', 'booking_requested', 'owner_confirmed', 'completed');

-- ── 9. payments (Cashfree) ────────────────────────────────────────────────────
-- Written ONLY by the trusted server (service-role). No client write policy exists,
-- so RLS denies all client inserts/updates by default.
create table if not exists public.payments (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references public.bookings (id) on delete restrict,
  customer_id        uuid not null references public.profiles (id) on delete restrict,
  amount             numeric(12, 2) not null check (amount >= 0),
  currency           text not null default 'INR',
  status             payment_status not null default 'pending',
  -- Cashfree integration fields
  cashfree_order_id   text unique,
  cashfree_payment_id text,
  payment_session_id  text,
  payment_method      text,
  payment_message     text,
  raw_response        jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_payments_booking  on public.payments (booking_id);
create index if not exists idx_payments_customer on public.payments (customer_id);
create index if not exists idx_payments_status   on public.payments (status);

-- ── 7. availability ───────────────────────────────────────────────────────────
-- Per-hall calendar. Unique on (hall, date, slot) prevents duplicate rows.
create table if not exists public.availability (
  id         uuid primary key default gen_random_uuid(),
  hall_id    uuid not null references public.halls (id) on delete cascade,
  date       date not null,
  slot       booking_slot        not null default 'full_day',
  status     availability_status not null default 'available',
  booking_id uuid references public.bookings (id) on delete set null,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_availability_hall_date_slot unique (hall_id, date, slot)
);

create index if not exists idx_availability_hall_date on public.availability (hall_id, date);
create index if not exists idx_availability_status    on public.availability (status);


-- ============================================================================
-- FILE: 0004_engagement_tables.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0004_engagement_tables.sql
-- Customer engagement: reviews, saved_halls.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 10. reviews ───────────────────────────────────────────────────────────────
-- One review per customer per hall. A completed booking is required to post one
-- (enforced by RLS in 0007). hall rating fields are recomputed by trigger (0006).
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  hall_id     uuid not null references public.halls (id)    on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  booking_id  uuid references public.bookings (id) on delete set null,
  rating      integer not null check (rating between 1 and 5),
  comment     text,
  is_visible  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_review_customer_hall unique (customer_id, hall_id)
);

create index if not exists idx_reviews_hall     on public.reviews (hall_id);
create index if not exists idx_reviews_customer on public.reviews (customer_id);

-- ── 11. saved_halls (wishlist) ────────────────────────────────────────────────
create table if not exists public.saved_halls (
  customer_id uuid not null references public.profiles (id) on delete cascade,
  hall_id     uuid not null references public.halls (id)    on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (customer_id, hall_id)
);

create index if not exists idx_saved_halls_hall on public.saved_halls (hall_id);


-- ============================================================================
-- FILE: 0005_monetization_tables.sql
-- ============================================================================

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


-- ============================================================================
-- FILE: 0006_functions_and_triggers.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0006_functions_and_triggers.sql
-- Security helpers, updated_at automation, auto-profile creation,
-- privilege-escalation guards, rating recompute, double-booking guard.
-- ─────────────────────────────────────────────────────────────────────────────

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ AUTHORIZATION HELPERS                                                       ║
-- ║ All SECURITY DEFINER + STABLE so they bypass RLS when read inside policies  ║
-- ║ (prevents infinite RLS recursion on the profiles table).                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_owner_approved()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner_approved'
  );
$$;

-- True if the current user owns the hall_owners row identified by _owner_id.
create or replace function public.owns_owner_row(_owner_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.hall_owners
    where id = _owner_id and profile_id = auth.uid()
  );
$$;

-- True if the current user is the owner of the given hall.
create or replace function public.is_hall_owner(_hall_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.halls h
    join public.hall_owners ho on ho.id = h.owner_id
    where h.id = _hall_id and ho.profile_id = auth.uid()
  );
$$;

-- True when the current DB role is a trusted backend (service-role / superuser).
-- Used to let the server (admin client) perform privileged writes that the
-- escalation guards below would otherwise block for normal users.
create or replace function public.is_trusted_backend()
returns boolean
language sql stable
as $$
  select current_user in ('service_role', 'supabase_admin', 'postgres');
$$;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ updated_at AUTOMATION                                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','hall_owners','halls','bookings','payments','availability',
    'reviews','premium_listings','advertisements','commissions','support_tickets'
  ]
  loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I;', t);
    execute format(
      'create trigger trg_set_updated_at before update on public.%I
         for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ AUTO-CREATE PROFILE ON SIGNUP                                               ║
-- ║ Maps signup metadata to a SAFE role. A client can request 'owner' (which   ║
-- ║ becomes owner_pending, still requiring admin approval) — but can NEVER      ║
-- ║ self-assign 'admin' or 'owner_approved'.                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  requested text := lower(coalesce(new.raw_user_meta_data ->> 'role', 'customer'));
  safe_role user_role;
begin
  safe_role := case
    when requested = 'owner' then 'owner_pending'::user_role
    else 'customer'::user_role
  end;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'name',
    safe_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ PRIVILEGE-ESCALATION GUARD — profiles.role                                  ║
-- ║ Any role change requires an admin or the trusted backend. This is the       ║
-- ║ primary defense against "user makes themselves admin".                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- IMPORTANT: this is SECURITY INVOKER (the default). It must NOT be SECURITY
-- DEFINER, because is_trusted_backend() reads current_user — under a DEFINER
-- function current_user becomes the owner ('postgres'), which would make every
-- caller look "trusted" and silently disable this guard. is_admin() below is
-- itself SECURITY DEFINER and uses auth.uid(), so it still works correctly here.
create or replace function public.prevent_role_change()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if not (public.is_trusted_backend() or public.is_admin()) then
      raise exception 'Not allowed: only an administrator can change a user role';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_role_change on public.profiles;
create trigger trg_prevent_role_change
  before update on public.profiles
  for each row execute function public.prevent_role_change();

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ADMIN-ONLY GUARD — hall_owners verification fields                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- SECURITY INVOKER (see note on prevent_role_change for why).
create or replace function public.prevent_owner_self_verify()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if (new.is_verified is distinct from old.is_verified
      or new.verified_at is distinct from old.verified_at
      or new.verified_by is distinct from old.verified_by)
     and not (public.is_trusted_backend() or public.is_admin()) then
    raise exception 'Not allowed: only an administrator can verify a hall owner';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_owner_self_verify on public.hall_owners;
create trigger trg_prevent_owner_self_verify
  before update on public.hall_owners
  for each row execute function public.prevent_owner_self_verify();

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ADMIN-ONLY GUARD — hall approval transitions                                ║
-- ║ Owners may move draft <-> pending_approval, but only admins may set         ║
-- ║ approved / rejected / suspended.                                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- SECURITY INVOKER (see note on prevent_role_change for why).
create or replace function public.prevent_hall_self_approve()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('approved', 'rejected', 'suspended')
     and not (public.is_trusted_backend() or public.is_admin()) then
    raise exception 'Not allowed: only an administrator can approve, reject or suspend a hall';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_hall_self_approve on public.halls;
create trigger trg_prevent_hall_self_approve
  before update on public.halls
  for each row execute function public.prevent_hall_self_approve();

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ DOUBLE-BOOKING GUARD (incl. full-day vs half-day overlap)                   ║
-- ║ Complements the partial unique index in 0003.                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.prevent_overlapping_booking()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status in ('payment_success','booking_requested','owner_confirmed','completed') then
    if exists (
      select 1 from public.bookings b
      where b.hall_id    = new.hall_id
        and b.event_date = new.event_date
        and b.id        <> new.id
        and b.status in ('payment_success','booking_requested','owner_confirmed','completed')
        and (new.slot = 'full_day' or b.slot = 'full_day' or b.slot = new.slot)
    ) then
      raise exception 'This hall is already booked on % for the % slot', new.event_date, new.slot;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_overlapping_booking on public.bookings;
create trigger trg_prevent_overlapping_booking
  before insert or update on public.bookings
  for each row execute function public.prevent_overlapping_booking();

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ HALL RATING RECOMPUTE                                                       ║
-- ║ Keeps halls.rating_average / rating_count in sync with visible reviews.    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.recalc_hall_rating()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  target_hall uuid := coalesce(new.hall_id, old.hall_id);
begin
  update public.halls h
  set
    rating_count   = sub.cnt,
    rating_average = sub.avg_rating
  from (
    select
      count(*)::int                                  as cnt,
      coalesce(round(avg(rating)::numeric, 1), 0)    as avg_rating
    from public.reviews
    where hall_id = target_hall and is_visible
  ) sub
  where h.id = target_hall;

  return null;
end;
$$;

drop trigger if exists trg_recalc_hall_rating on public.reviews;
create trigger trg_recalc_hall_rating
  after insert or update or delete on public.reviews
  for each row execute function public.recalc_hall_rating();


-- ============================================================================
-- FILE: 0007_rls_policies.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0007_rls_policies.sql  (authoritative — replaces any earlier version)
--
-- Row Level Security for every table.
--
-- Principles:
--   • RLS is enabled (default-deny) on EVERY table.
--   • The service-role key (used only by lib/supabase/admin.ts) BYPASSES RLS,
--     so payments / commissions / premium_listings / advertisements have
--     NO client write policy — the trusted backend writes them.
--   • Privilege escalation is blocked here AND by triggers in 0006
--     (defense in depth: a hole in one layer can't grant admin).
--   • profiles.role can NEVER be changed by a non-admin (the policy WITH CHECK
--     compares new.role to the current stored role; trigger 0006 also blocks it).
-- ─────────────────────────────────────────────────────────────────────────────

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Helper alias requested by the spec: owns_hall(hall_id)                      ║
-- ║ Functionally identical to is_hall_owner() from 0006.                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.owns_hall(_hall_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_hall_owner(_hall_id);
$$;

-- ── Enable RLS on every table ─────────────────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.hall_owners      enable row level security;
alter table public.halls            enable row level security;
alter table public.hall_images      enable row level security;
alter table public.amenities        enable row level security;
alter table public.hall_amenities   enable row level security;
alter table public.availability     enable row level security;
alter table public.bookings         enable row level security;
alter table public.payments         enable row level security;
alter table public.reviews          enable row level security;
alter table public.saved_halls      enable row level security;
alter table public.premium_listings enable row level security;
alter table public.advertisements   enable row level security;
alter table public.commissions      enable row level security;
alter table public.support_tickets  enable row level security;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ profiles                                                                    ║
-- ║   • User reads own profile                                                  ║
-- ║   • User updates own profile EXCEPT role                                    ║
-- ║   • Role escalation blocked at the policy level AND by trigger 0006         ║
-- ║   • Admin reads / updates all profiles                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check (
    auth.uid() = id
    -- A self-insert may not pick a privileged role.
    and (role in ('customer', 'owner_pending') or public.is_admin())
  );

-- WITH CHECK compares the proposed new row's role against the user's
-- CURRENT stored role. A non-admin may only keep its existing role.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  using (auth.uid() = id or public.is_admin())
  with check (
    public.is_admin()
    or (
      auth.uid() = id
      and role = (select p.role from public.profiles p where p.id = auth.uid())
    )
  );

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete using (public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ hall_owners                                                                 ║
-- ║   • Owner reads/updates only their own owner row                            ║
-- ║   • Admin reads/updates all                                                 ║
-- ║   • Only admin can flip is_verified (also enforced by trigger 0006)         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists hall_owners_select on public.hall_owners;
create policy hall_owners_select on public.hall_owners
  for select using (profile_id = auth.uid() or public.is_admin());

drop policy if exists hall_owners_insert on public.hall_owners;
create policy hall_owners_insert on public.hall_owners
  for insert with check (
    profile_id = auth.uid()
    -- Self-insert may not pre-mark itself verified.
    and is_verified = false
    and verified_at is null
    and verified_by is null
  );

drop policy if exists hall_owners_update on public.hall_owners;
create policy hall_owners_update on public.hall_owners
  for update using (profile_id = auth.uid() or public.is_admin())
             with check (profile_id = auth.uid() or public.is_admin());

drop policy if exists hall_owners_delete on public.hall_owners;
create policy hall_owners_delete on public.hall_owners
  for delete using (public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ halls                                                                       ║
-- ║   • Public reads APPROVED halls only                                        ║
-- ║   • Approved owner inserts only with status='pending_approval'              ║
-- ║   • Owner updates own halls but cannot approve them (trigger 0006 enforces) ║
-- ║   • Admin moves status to approved/rejected/suspended                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists halls_select on public.halls;
create policy halls_select on public.halls
  for select using (
    status = 'approved'
    or public.owns_hall(id)
    or public.is_admin()
  );

drop policy if exists halls_insert on public.halls;
create policy halls_insert on public.halls
  for insert with check (
    public.is_owner_approved()
    and public.owns_owner_row(owner_id)
    -- Owner-created halls must start in pending_approval. Admin may set any.
    and (status = 'pending_approval' or public.is_admin())
  );

drop policy if exists halls_update on public.halls;
create policy halls_update on public.halls
  for update using (public.owns_hall(id) or public.is_admin())
             with check (public.owns_hall(id) or public.is_admin());

drop policy if exists halls_delete on public.halls;
create policy halls_delete on public.halls
  for delete using (public.owns_hall(id) or public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ hall_images — public reads images for approved halls only                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists hall_images_select on public.hall_images;
create policy hall_images_select on public.hall_images
  for select using (
    exists (
      select 1 from public.halls h
      where h.id = hall_images.hall_id
        and (h.status = 'approved' or public.owns_hall(h.id) or public.is_admin())
    )
  );

drop policy if exists hall_images_write on public.hall_images;
create policy hall_images_write on public.hall_images
  for all using (public.owns_hall(hall_id) or public.is_admin())
          with check (public.owns_hall(hall_id) or public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ amenities — public read, admin write                                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists amenities_select on public.amenities;
create policy amenities_select on public.amenities for select using (true);

drop policy if exists amenities_write on public.amenities;
create policy amenities_write on public.amenities
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists hall_amenities_select on public.hall_amenities;
create policy hall_amenities_select on public.hall_amenities for select using (true);

drop policy if exists hall_amenities_write on public.hall_amenities;
create policy hall_amenities_write on public.hall_amenities
  for all using (public.owns_hall(hall_id) or public.is_admin())
          with check (public.owns_hall(hall_id) or public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ availability — public read for APPROVED halls only                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists availability_select on public.availability;
create policy availability_select on public.availability
  for select using (
    exists (
      select 1 from public.halls h
      where h.id = availability.hall_id
        and (h.status = 'approved' or public.owns_hall(h.id) or public.is_admin())
    )
  );

drop policy if exists availability_write on public.availability;
create policy availability_write on public.availability
  for all using (public.owns_hall(hall_id) or public.is_admin())
          with check (public.owns_hall(hall_id) or public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ bookings                                                                    ║
-- ║   • Customer creates own booking (must be on an approved hall, must start   ║
-- ║     in 'pending_payment')                                                   ║
-- ║   • Customer reads own; owner reads bookings for own halls; admin all       ║
-- ║   • UPDATE allowed by customer/owner/admin; the LEGAL STATE TRANSITIONS     ║
-- ║     are enforced by validate_booking_transition() in migration 0009         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select using (
    customer_id = auth.uid()
    or public.owns_hall(hall_id)
    or public.is_admin()
  );

drop policy if exists bookings_insert on public.bookings;
create policy bookings_insert on public.bookings
  for insert with check (
    customer_id = auth.uid()
    and status = 'pending_payment'
    and exists (
      select 1 from public.halls h
      where h.id = bookings.hall_id and h.status = 'approved'
    )
  );

drop policy if exists bookings_update on public.bookings;
create policy bookings_update on public.bookings
  for update using (
    customer_id = auth.uid() or public.owns_hall(hall_id) or public.is_admin()
  ) with check (
    customer_id = auth.uid() or public.owns_hall(hall_id) or public.is_admin()
  );

drop policy if exists bookings_delete on public.bookings;
create policy bookings_delete on public.bookings
  for delete using (public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ payments                                                                    ║
-- ║   • Customer reads own                                                      ║
-- ║   • Owner reads payments for bookings on their own halls                    ║
-- ║   • Writes: NONE (service-role only — bypasses RLS)                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select using (
    customer_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id and public.owns_hall(b.hall_id)
    )
  );
-- No insert/update/delete policy → all client writes denied.

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ reviews                                                                     ║
-- ║   • Public reads VISIBLE reviews                                            ║
-- ║   • Customer reviews are allowed only for a hall they have a 'completed'    ║
-- ║     booking on                                                              ║
-- ║   • Admin moderates (toggle is_visible, delete)                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews
  for select using (is_visible or customer_id = auth.uid() or public.is_admin());

drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert with check (
    customer_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      where b.hall_id = reviews.hall_id   -- qualify, avoid shadowing
        and b.customer_id = auth.uid()
        and b.status = 'completed'
    )
  );

drop policy if exists reviews_update on public.reviews;
create policy reviews_update on public.reviews
  for update using (customer_id = auth.uid() or public.is_admin())
             with check (customer_id = auth.uid() or public.is_admin());

drop policy if exists reviews_delete on public.reviews;
create policy reviews_delete on public.reviews
  for delete using (customer_id = auth.uid() or public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ saved_halls — fully private to the customer                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists saved_halls_select on public.saved_halls;
create policy saved_halls_select on public.saved_halls
  for select using (customer_id = auth.uid());

drop policy if exists saved_halls_insert on public.saved_halls;
create policy saved_halls_insert on public.saved_halls
  for insert with check (customer_id = auth.uid());

drop policy if exists saved_halls_delete on public.saved_halls;
create policy saved_halls_delete on public.saved_halls
  for delete using (customer_id = auth.uid());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ premium_listings — owner reads own, admin manages                           ║
-- ║ Writes are server-only (paid via Cashfree, recorded by trusted backend).    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists premium_select on public.premium_listings;
create policy premium_select on public.premium_listings
  for select using (public.owns_hall(hall_id) or public.is_admin());
-- No client write policies.

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ advertisements — public reads active ads, ADMIN manages                     ║
-- ║ Per spec, owners DO NOT self-create ads. The trusted backend may insert     ║
-- ║ on behalf of an owner after payment (bypasses RLS).                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists ads_select on public.advertisements;
create policy ads_select on public.advertisements
  for select using (
    (status = 'active' and start_date <= current_date and (end_date is null or end_date >= current_date))
    or public.is_admin()
    or (owner_id is not null and public.owns_owner_row(owner_id))
  );

drop policy if exists ads_write on public.advertisements;
create policy ads_write on public.advertisements
  for all using (public.is_admin()) with check (public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ commissions — owner reads commissions for own halls, admin manages          ║
-- ║ Writes are server-only (computed at payment-success time).                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists commissions_select on public.commissions;
create policy commissions_select on public.commissions
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = commissions.booking_id and public.owns_hall(b.hall_id)
    )
  );

drop policy if exists commissions_admin_write on public.commissions;
create policy commissions_admin_write on public.commissions
  for all using (public.is_admin()) with check (public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ support_tickets                                                             ║
-- ║   • User creates / reads own tickets                                        ║
-- ║   • Admin reads / updates / deletes all                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists tickets_select on public.support_tickets;
create policy tickets_select on public.support_tickets
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists tickets_insert on public.support_tickets;
create policy tickets_insert on public.support_tickets
  for insert with check (user_id = auth.uid());

drop policy if exists tickets_update on public.support_tickets;
create policy tickets_update on public.support_tickets
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists tickets_delete on public.support_tickets;
create policy tickets_delete on public.support_tickets
  for delete using (public.is_admin());


-- ============================================================================
-- FILE: 0008_seed_amenities.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0008_seed_amenities.sql
-- Optional: seed the global amenities catalogue. Safe to re-run (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.amenities (name, slug, icon, category) values
  ('Air Conditioning', 'air-conditioning', 'snowflake',   'comfort'),
  ('Valet Parking',    'valet-parking',    'car',         'parking'),
  ('Free Parking',     'free-parking',     'parking',     'parking'),
  ('In-house Catering','in-house-catering','utensils',    'food'),
  ('DJ & Music',       'dj-music',         'music',       'entertainment'),
  ('Outdoor Garden',   'outdoor-garden',   'trees',       'space'),
  ('Bridal Suite',     'bridal-suite',     'bed',         'space'),
  ('Swimming Pool',    'swimming-pool',    'waves',       'space'),
  ('Generator Backup', 'generator-backup', 'zap',         'utility'),
  ('In-house Decor',   'in-house-decor',   'sparkles',    'services'),
  ('AV / Stage Setup', 'av-stage-setup',   'projector',   'entertainment'),
  ('Wheelchair Access','wheelchair-access','accessibility','accessibility')
on conflict (slug) do nothing;


-- ============================================================================
-- FILE: 0009_security_extensions.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0009_security_extensions.sql
-- Schema patches that complete the security spec:
--   1. halls.status default → 'pending_approval' (was 'draft')
--   2. Booking state-machine trigger — enforces which role can perform which
--      status transition. RLS controls who can SEE/TOUCH a row; this trigger
--      controls which (old_status → new_status) edges are legal per role.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Owner-created halls default to pending_approval ────────────────────────
alter table public.halls alter column status set default 'pending_approval';

-- ── 2. Booking state-machine trigger ──────────────────────────────────────────
-- Allowed transitions:
--   Customer (own booking):
--     pending_payment    → cancelled
--     payment_success    → cancelled
--     booking_requested  → cancelled
--     owner_confirmed    → cancelled         (subject to cancellation policy)
--   Owner (booking on their hall):
--     booking_requested  → owner_confirmed
--     booking_requested  → owner_rejected
--     owner_confirmed    → completed
--   Trusted backend / admin: any transition.
--
-- The trigger ALSO blocks customers and owners from rewriting financial fields
-- (amounts, customer_id, hall_id) — only the trusted backend or an admin may.
create or replace function public.validate_booking_transition()
returns trigger
language plpgsql set search_path = public
as $$
declare
  is_owner    boolean := public.owns_hall(new.hall_id);
  is_customer boolean := (new.customer_id = auth.uid());
  trusted     boolean := public.is_trusted_backend() or public.is_admin();
begin
  -- Trusted backends / admins bypass the state machine.
  if trusted then
    return new;
  end if;

  -- Lock financial + identity fields against tampering by customer/owner.
  if new.customer_id  is distinct from old.customer_id
     or new.hall_id   is distinct from old.hall_id
     or new.base_amount   is distinct from old.base_amount
     or new.platform_fee  is distinct from old.platform_fee
     or new.total_amount  is distinct from old.total_amount then
    raise exception 'Booking financial and identity fields are immutable';
  end if;

  -- If status didn't change, allow the (non-financial) update.
  if new.status = old.status then
    return new;
  end if;

  -- Customer-driven transitions.
  if is_customer and not is_owner then
    if not (
      (old.status = 'pending_payment'    and new.status = 'cancelled')
      or (old.status = 'payment_success' and new.status = 'cancelled')
      or (old.status = 'booking_requested' and new.status = 'cancelled')
      or (old.status = 'owner_confirmed' and new.status = 'cancelled')
    ) then
      raise exception
        'Customer cannot transition booking from % to %', old.status, new.status;
    end if;
    return new;
  end if;

  -- Owner-driven transitions.
  if is_owner then
    if not (
      (old.status = 'booking_requested' and new.status = 'owner_confirmed')
      or (old.status = 'booking_requested' and new.status = 'owner_rejected')
      or (old.status = 'owner_confirmed'  and new.status = 'completed')
    ) then
      raise exception
        'Owner cannot transition booking from % to %', old.status, new.status;
    end if;
    return new;
  end if;

  raise exception 'Not allowed: only customer, owner, or admin may transition this booking';
end;
$$;

drop trigger if exists trg_validate_booking_transition on public.bookings;
create trigger trg_validate_booking_transition
  before update on public.bookings
  for each row execute function public.validate_booking_transition();


-- ============================================================================
-- FILE: 0010_storage.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0010_storage.sql
-- Supabase Storage: hall-images bucket + RLS policies.
--
-- Bucket is PUBLIC (files served via CDN-friendly public URL). Discovery of
-- non-approved hall images is prevented by the hall_images TABLE RLS (0007):
-- clients never learn the storage path of a non-approved hall's images.
-- The storage policies below add a second layer: even if a path were guessed,
-- only owners/admins can write, and reads still require the hall to be
-- approved (or the caller to be the owner/admin).
--
-- File path convention:  {hall_id}/{uuid}.{ext}
-- Allowed types:         image/jpeg, image/png, image/webp
-- Max file size:         5 MB
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Create the bucket ──────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hall-images',
  'hall-images',
  true,                                              -- public read via CDN URL
  5242880,                                           -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── 2. Storage RLS policies ──────────────────────────────────────────────────
-- Supabase Storage uses the `storage.objects` table. Policies filter on
-- bucket_id and extract the hall_id from the first folder segment of `name`.
--
-- Example: name = 'a1b2c3d4-…/img.jpg'
--   → (storage.foldername(name))[1] = 'a1b2c3d4-…' (the hall UUID)

-- ── SELECT: approved hall → anyone; own hall or admin → always ───────────────
drop policy if exists "hall_images_storage_select" on storage.objects;
create policy "hall_images_storage_select" on storage.objects
  for select using (
    bucket_id = 'hall-images'
    and (
      exists (
        select 1 from public.halls h
        where h.id = ((storage.foldername(name))[1])::uuid
          and h.status = 'approved'
      )
      or public.owns_hall(((storage.foldername(name))[1])::uuid)
      or public.is_admin()
    )
  );

-- ── INSERT: owner of the hall, or admin ─────────────────────────────────────
drop policy if exists "hall_images_storage_insert" on storage.objects;
create policy "hall_images_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'hall-images'
    and (
      public.owns_hall(((storage.foldername(name))[1])::uuid)
      or public.is_admin()
    )
  );

-- ── UPDATE (replace): owner of the hall, or admin ───────────────────────────
drop policy if exists "hall_images_storage_update" on storage.objects;
create policy "hall_images_storage_update" on storage.objects
  for update using (
    bucket_id = 'hall-images'
    and (
      public.owns_hall(((storage.foldername(name))[1])::uuid)
      or public.is_admin()
    )
  ) with check (
    bucket_id = 'hall-images'
    and (
      public.owns_hall(((storage.foldername(name))[1])::uuid)
      or public.is_admin()
    )
  );

-- ── DELETE: owner of the hall, or admin ─────────────────────────────────────
drop policy if exists "hall_images_storage_delete" on storage.objects;
create policy "hall_images_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'hall-images'
    and (
      public.owns_hall(((storage.foldername(name))[1])::uuid)
      or public.is_admin()
    )
  );


-- ============================================================================
-- FILE: 0011_booking_cleanup.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0011_booking_cleanup.sql
-- Timeout + cleanup strategy for unpaid pending bookings.
--
-- Design:
--   • New `expires_at` column on bookings. For a freshly-created
--     pending_payment booking, this defaults to now() + 15 minutes.
--   • pending_payment bookings DO NOT match the partial unique index
--     `uq_booking_active_slot` (which is restricted to ACTIVE statuses), so
--     they never permanently block a slot. The slot remains visible/bookable
--     to anyone else while one customer is paying.
--   • Once the customer's payment webhook flips the booking to
--     `payment_success`, the unique index activates and the slot is reserved
--     for real. The `expires_at` becomes irrelevant.
--   • If the customer never pays, `cleanup_expired_pending_bookings()` flips
--     the row to `cancelled` and stamps `cancel_reason`. Cancelled bookings
--     also don't match the unique index, so this is safe to do repeatedly.
--
-- Operations:
--   • Recommended: schedule the cleanup function via pg_cron (see bottom).
--   • Fallback: the admin dashboard exposes a "Run cleanup now" action that
--     calls the same function on demand.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. expires_at column ─────────────────────────────────────────────────────
alter table public.bookings
  add column if not exists expires_at timestamptz;

-- Backfill any existing pending_payment rows with a sensible expiry.
update public.bookings
   set expires_at = created_at + interval '15 minutes'
 where status = 'pending_payment'
   and expires_at is null;

-- Partial index — only pending rows are interesting to the cleanup job.
create index if not exists idx_bookings_pending_expires
  on public.bookings (expires_at)
  where status = 'pending_payment';

-- ── 2. Cleanup function ──────────────────────────────────────────────────────
-- Marks expired pending_payment bookings as 'cancelled' with a reason.
-- Returns the number of rows cleaned up so the caller can log / display it.
--
-- SECURITY DEFINER + is_trusted_backend() exemption built into the existing
-- triggers: this function runs as the table owner ('postgres'), so:
--   - prevent_role_change → not relevant (we don't touch role)
--   - validate_booking_transition → bypassed (is_trusted_backend = true under
--     SECURITY DEFINER + postgres role), so we can move pending → cancelled
--     directly even without a normal user session.
create or replace function public.cleanup_expired_pending_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  with expired as (
    update public.bookings
       set status        = 'cancelled',
           cancel_reason = coalesce(cancel_reason, 'Payment window expired')
     where status = 'pending_payment'
       and expires_at is not null
       and expires_at < now()
    returning id
  )
  select count(*)::int into affected from expired;
  return coalesce(affected, 0);
end;
$$;

-- Only the trusted backend / admin should call this directly. RLS doesn't
-- apply to function execution itself, so we restrict EXECUTE.
revoke all on function public.cleanup_expired_pending_bookings() from public;
grant execute on function public.cleanup_expired_pending_bookings() to service_role;

-- ── 3. Stamp expires_at automatically when a pending_payment row is inserted ─
create or replace function public.stamp_pending_expiry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'pending_payment' and new.expires_at is null then
    new.expires_at := now() + interval '15 minutes';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_pending_expiry on public.bookings;
create trigger trg_stamp_pending_expiry
  before insert on public.bookings
  for each row execute function public.stamp_pending_expiry();

-- ── 4. (Optional) schedule with pg_cron ─────────────────────────────────────
-- Run this in the Supabase SQL editor AFTER applying this migration if your
-- project has the pg_cron extension enabled (it is in Supabase by default).
--
--   select cron.schedule(
--     'hallnect-cleanup-pending-bookings',
--     '* * * * *',                          -- every minute
--     $$ select public.cleanup_expired_pending_bookings(); $$
--   );
--
-- To remove:
--   select cron.unschedule('hallnect-cleanup-pending-bookings');


-- ============================================================================
-- FILE: 0012_commission_settings.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0012_commission_settings.sql
-- Global platform commission % (admin-editable) + hall_id on commissions.
--
-- Design:
--   • `platform_settings` is a single-row config table (constrained by
--     `id = true`).  Only admins can read or write it.
--   • `get_commission_percent()` is a SECURITY DEFINER helper that returns the
--     active rate to ANY logged-in role without exposing the row itself.  The
--     customer booking action needs the rate to compute the platform fee at
--     booking time; without this helper they'd be blocked by RLS.
--   • `commissions.hall_id` is denormalised so the admin can filter/aggregate
--     commission by hall directly.  Backfilled from `bookings.hall_id`.
--   • Existing RLS on `commissions` (0007) already enforces:
--       - admin: full access
--       - owner: read only commissions for halls they own (via owns_hall)
--       - customer: NO select policy → fully blocked (default-deny)
--       - client writes: only admin; service-role bypasses RLS (the trusted
--         backend records the commission)
--     and the partial unique `commissions_booking_id_key` (booking_id UNIQUE
--     in 0005) prevents duplicate commission rows for the same booking.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. platform_settings (single-row) ────────────────────────────────────────
create table if not exists public.platform_settings (
  id                 boolean primary key default true,
  commission_percent numeric(5, 2) not null default 5
    check (commission_percent between 0 and 100),
  updated_at         timestamptz   not null default now(),
  updated_by         uuid references public.profiles (id) on delete set null,
  constraint platform_settings_single_row check (id = true)
);

insert into public.platform_settings (id, commission_percent) values (true, 5)
on conflict (id) do nothing;

drop trigger if exists trg_set_updated_at on public.platform_settings;
create trigger trg_set_updated_at
  before update on public.platform_settings
  for each row execute function public.set_updated_at();

-- RLS — admin reads + writes; everyone else blocked at row level.
alter table public.platform_settings enable row level security;

drop policy if exists platform_settings_admin_read on public.platform_settings;
create policy platform_settings_admin_read on public.platform_settings
  for select using (public.is_admin());

drop policy if exists platform_settings_admin_write on public.platform_settings;
create policy platform_settings_admin_write on public.platform_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- ── 2. Helper — read the active rate without exposing the row ────────────────
-- Returns a single number, runs as table owner (postgres), so RLS doesn't
-- block it. Customers calling this never see the platform_settings row itself.
create or replace function public.get_commission_percent()
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select commission_percent from public.platform_settings where id = true),
    5
  );
$$;

grant execute on function public.get_commission_percent() to anon, authenticated, service_role;

-- ── 3. commissions.hall_id ───────────────────────────────────────────────────
alter table public.commissions
  add column if not exists hall_id uuid references public.halls (id) on delete set null;

-- Backfill from existing bookings (one statement, idempotent).
update public.commissions c
   set hall_id = b.hall_id
  from public.bookings b
 where c.booking_id = b.id
   and c.hall_id is null;

create index if not exists idx_commissions_hall on public.commissions (hall_id);

-- ── 4. Guard — owners/customers cannot mutate commissions ────────────────────
-- Defense-in-depth on top of RLS: if a future RLS change accidentally permits
-- writes, this trigger still blocks any non-trusted/non-admin update or delete.
create or replace function public.guard_commission_writes()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return coalesce(new, old);
  end if;
  raise exception 'Not allowed: only an administrator can modify commissions';
end;
$$;

drop trigger if exists trg_guard_commission_writes on public.commissions;
create trigger trg_guard_commission_writes
  before insert or update or delete on public.commissions
  for each row execute function public.guard_commission_writes();


-- ============================================================================
-- FILE: 0013_premium_plans.sql
-- ============================================================================

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


-- ============================================================================
-- FILE: 0014_advertisements_admin.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0014  Advertisement management (admin)
--
-- WHAT THIS MIGRATION DOES
--   1. Adds `advertiser_name` text column to advertisements (free-form display
--      name shown to viewers; independent of owner FK).
--   2. Adds a CHECK constraint pinning placement to a known set:
--        homepage_banner | search_page_banner | hall_detail_sidebar
--        | booking_confirmation
--      (NULL still allowed for legacy rows.)
--   3. Adds a CHECK constraint on target_url that disallows javascript: /
--      data: / file: / vbscript: schemes at the DB level. The app validates
--      first; this is defense-in-depth so a buggy/abused server insert can
--      never store an unsafe URL.
--   4. Adds an `expire_ads()` SECURITY DEFINER helper that flips status to
--      'expired' for any active ad whose end_date is in the past. Safe for
--      any role to call (admin schedulers / cron); only touches the status
--      transition active→expired.
--
-- RLS is unchanged — existing ads_select hides inactive/expired rows from
-- public reads already, and ads_write keeps writes admin-only. Trusted backend
-- can still insert via service-role key (bypasses RLS).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. advertiser_name column
alter table public.advertisements
  add column if not exists advertiser_name text;

-- 2. Placement allow-list (drop first so re-runs are safe)
alter table public.advertisements
  drop constraint if exists ad_placement_valid;

alter table public.advertisements
  add constraint ad_placement_valid
  check (
    placement is null
    or placement in (
      'homepage_banner',
      'search_page_banner',
      'hall_detail_sidebar',
      'booking_confirmation'
    )
  );

-- 3. Target URL scheme guard (defense-in-depth; app validates first)
alter table public.advertisements
  drop constraint if exists ad_target_url_safe;

alter table public.advertisements
  add constraint ad_target_url_safe
  check (
    target_url is null
    or (
      lower(target_url) !~ '^\s*(javascript|data|vbscript|file):'
      and target_url ~* '^https?://'
      and length(target_url) <= 2048
    )
  );

-- 4. Expire ads helper. Admin or scheduled call.
create or replace function public.expire_ads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rows_affected integer;
begin
  -- Only admins may invoke; the function is SECURITY DEFINER so it can run
  -- with elevated rights, but we still gate on the caller's role.
  if not public.is_admin() then
    raise exception 'expire_ads: admin only';
  end if;

  update public.advertisements
     set status = 'expired',
         updated_at = now()
   where status = 'active'
     and end_date is not null
     and end_date < current_date;

  get diagnostics rows_affected = row_count;
  return rows_affected;
end;
$$;

grant execute on function public.expire_ads() to authenticated;

create index if not exists idx_ads_end_date on public.advertisements (end_date)
  where status = 'active';


-- ============================================================================
-- FILE: 0015_review_enhancements.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0015  Review enhancements
--
-- WHAT THIS MIGRATION DOES
--   1. Adds `title` text column (optional short headline for the review).
--   2. Adds four sub-rating columns: cleanliness_rating, value_rating,
--      location_rating, service_rating — each nullable integer 1–5.
--   3. Replaces the UNIQUE constraint from (customer_id, hall_id) to
--      (booking_id) — one review per completed booking, not one per hall.
--      A customer who books the same hall twice can leave two reviews.
--   4. Updates recalc_hall_rating() to include sub-rating averages as a
--      JSON column on halls for future display (optional; halls.rating_*
--      scalars remain the primary source of truth).
--
-- RLS is unchanged — existing policies already enforce:
--   • Public reads visible reviews
--   • Customer inserts only for halls with a completed booking
--   • Admin moderates
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. title
alter table public.reviews
  add column if not exists title text;

-- 2. Sub-ratings
alter table public.reviews
  add column if not exists cleanliness_rating integer;
alter table public.reviews
  add column if not exists value_rating integer;
alter table public.reviews
  add column if not exists location_rating integer;
alter table public.reviews
  add column if not exists service_rating integer;

-- CHECKs (drop-if-exists then add for idempotency)
alter table public.reviews drop constraint if exists chk_cleanliness_rating;
alter table public.reviews add constraint chk_cleanliness_rating
  check (cleanliness_rating is null or cleanliness_rating between 1 and 5);

alter table public.reviews drop constraint if exists chk_value_rating;
alter table public.reviews add constraint chk_value_rating
  check (value_rating is null or value_rating between 1 and 5);

alter table public.reviews drop constraint if exists chk_location_rating;
alter table public.reviews add constraint chk_location_rating
  check (location_rating is null or location_rating between 1 and 5);

alter table public.reviews drop constraint if exists chk_service_rating;
alter table public.reviews add constraint chk_service_rating
  check (service_rating is null or service_rating between 1 and 5);

-- 3. Replace unique constraint: per-hall → per-booking
-- Drop old unique (customer_id, hall_id). Ignore error if it doesn't exist.
alter table public.reviews drop constraint if exists uq_review_customer_hall;

-- Add per-booking unique (only non-null booking_ids; NULL booking_id is legacy)
create unique index if not exists uq_review_per_booking
  on public.reviews (booking_id)
  where booking_id is not null;


-- ============================================================================
-- FILE: 0016_support_ticket_enhancements.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0016  Support ticket enhancements
--
-- 1. Replaces the priority CHECK to use low/medium/high/urgent
--    (was low/normal/high/urgent). Migrates any existing 'normal' rows
--    to 'medium'.
-- 2. Adds internal_notes — admin-only field NEVER shown to the user.
--    RLS table policy already restricts UPDATE to admin, so non-admin users
--    cannot write to this column. SELECT-level filtering of this column for
--    non-admin readers is handled at the app layer (the user reader/view does
--    not select internal_notes).
-- 3. Index on priority for filter performance.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Migrate existing data first, then swap the CHECK
update public.support_tickets set priority = 'medium' where priority = 'normal';

alter table public.support_tickets drop constraint if exists support_tickets_priority_check;
alter table public.support_tickets add constraint support_tickets_priority_check
  check (priority in ('low', 'medium', 'high', 'urgent'));

alter table public.support_tickets alter column priority set default 'medium';

-- 2. internal_notes
alter table public.support_tickets
  add column if not exists internal_notes text;

-- 3. priority index
create index if not exists idx_tickets_priority on public.support_tickets (priority);

