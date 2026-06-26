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
