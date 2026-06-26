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
