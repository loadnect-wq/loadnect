-- ─────────────────────────────────────────────────────────────────────────────
-- seed_example_hall.sql — ONE clean example hall for testing.
--
-- "Grand Lotus Mahal" (slug: grand-lotus-mahal). Use it to exercise search,
-- the hall detail page, availability, image gallery, amenities, and booking.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and Run. Idempotent
-- (ON CONFLICT) — safe to re-run. It does NOT touch real user-created halls.
--
-- HOW TO RESET DEMO DATA:
--   delete from public.halls where slug = 'grand-lotus-mahal';
--   (cascades to hall_images / hall_amenities / availability via FKs)
--
-- NOTE: requires an existing hall_owners row to attach to. This script picks
-- the first hall_owners row. If you have none yet, create an owner first
-- (register an owner + admin-approve), then run this.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_owner_id uuid;
  v_hall_id  uuid;
begin
  -- Attach to an existing owner (first available). Bail out cleanly if none.
  select id into v_owner_id from public.hall_owners order by created_at limit 1;
  if v_owner_id is null then
    raise notice 'No hall_owners row found — create + approve an owner first, then re-run.';
    return;
  end if;

  -- Upsert the example hall (status approved so it's publicly visible).
  insert into public.halls (
    owner_id, name, slug, description, city, state, address, pincode,
    capacity_min, capacity_max, price_per_day, price_morning, price_evening,
    status, is_premium
  ) values (
    v_owner_id,
    'Grand Lotus Mahal',
    'grand-lotus-mahal',
    'A premium EXAMPLE wedding hall listing used for testing Hallnect features '
      || 'such as search, availability, booking, image gallery, and amenities. '
      || 'This is sample/test data, not a real venue.',
    'Chennai', 'Tamil Nadu', 'Example Address, T. Nagar, Chennai, Tamil Nadu', '600017',
    300, 800, 85000, 45000, 50000,
    'approved', false
  )
  on conflict (slug) do update set
    name          = excluded.name,
    description   = excluded.description,
    city          = excluded.city,
    state         = excluded.state,
    address       = excluded.address,
    pincode       = excluded.pincode,
    capacity_min  = excluded.capacity_min,
    capacity_max  = excluded.capacity_max,
    price_per_day = excluded.price_per_day,
    status        = excluded.status
  returning id into v_hall_id;

  -- Attach amenities (match by slug; ignore any not present in the catalogue).
  insert into public.hall_amenities (hall_id, amenity_id)
  select v_hall_id, a.id
  from public.amenities a
  where a.slug in (
    'air-conditioning','free-parking','in-house-catering','av-stage-setup',
    'bridal-suite','generator-backup','dj-music'
  )
  on conflict (hall_id, amenity_id) do nothing;

  raise notice 'Example hall ready: grand-lotus-mahal (id=%)', v_hall_id;
end $$;

-- Verify:
--   select slug, name, status, city, capacity_max, price_per_day
--   from public.halls where slug = 'grand-lotus-mahal';
