-- ═════════════════════════════════════════════════════════════════════════════
-- seed_clean_hallnect_demo.sql
-- Tamil Nadu demo cleanup + single example hall.
--
-- WHAT THIS DOES (run intentionally in the Supabase SQL Editor — runs as
-- `postgres`, so trigger guards accept it):
--   1. DELETES the old multi-city demo halls (Chennai/Coimbatore/Madurai +
--      out-of-Tamil-Nadu Bangalore/Hyderabad/Kochi) seeded by demo_data.sql.
--      Cascades to their images/amenities/availability/reviews.
--   2. Ensures the amenity catalogue has the example hall's amenities.
--   3. Upserts ONE example hall: "Grand Lotus Mahal" (Madurai · Thirunagar),
--      status approved.
--   4. Attaches its amenities, one cover image, and a few availability rows.
--
-- SAFETY: only deletes the KNOWN demo slugs below — it never touches real
-- owner-created halls. Idempotent: safe to re-run.
--
-- RESET: delete from public.halls where slug = 'grand-lotus-mahal';
-- ═════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Remove old demo halls (out-of-TN + the original 12-city demo set) ──────
delete from public.halls
where slug in (
  'annai-pearl-mahal-chennai',           'marina-grand-convention-chennai',
  'kovai-kalyana-mandapam-coimbatore',   'saravana-banquet-centre-coimbatore',
  'meenakshi-heritage-mahal-madurai',    'vaigai-sangam-convention-madurai',
  'sapphire-garden-hall-bangalore',      'whitefield-royale-convention-bangalore',
  'nizami-mehfil-banquet-hyderabad',     'charminar-grand-convention-hyderabad',
  'backwater-pearl-convention-kochi',    'periyar-banquet-palace-kochi'
);

-- ── 2. Ensure amenity catalogue covers the example hall's amenities ───────────
insert into public.amenities (name, slug, icon, category) values
  ('Dining Hall',  'dining-hall',  'utensils', 'space'),
  ('Bride Room',   'bride-room',   'bed',      'space'),
  ('Groom Room',   'groom-room',   'bed',      'space'),
  ('CCTV',         'cctv',         'shield',   'safety'),
  ('Sound System', 'sound-system', 'music',    'entertainment'),
  ('Kitchen',      'kitchen',      'utensils', 'food')
on conflict (slug) do nothing;

-- ── 3. Upsert the single example hall ─────────────────────────────────────────
do $$
declare
  v_owner_id uuid;
  v_hall_id  uuid;
begin
  select id into v_owner_id from public.hall_owners order by created_at limit 1;
  if v_owner_id is null then
    raise notice 'No hall_owners row — register + approve an owner first, then re-run.';
    return;
  end if;

  insert into public.halls (
    owner_id, name, slug, description, city, state, address, pincode,
    capacity_min, capacity_max, price_per_day, price_morning, price_evening,
    status, is_premium
  ) values (
    v_owner_id,
    'Grand Lotus Mahal',
    'grand-lotus-mahal',
    'Grand Lotus Mahal is a premium example wedding hall listing in Thirunagar, '
      || 'Madurai, used for testing Hallnect features such as search, image '
      || 'gallery, amenities, availability, booking, and payment flow. This is '
      || 'sample/test data, not a real venue.',
    'Madurai', 'Tamil Nadu', 'Thirunagar, Madurai, Tamil Nadu, India', '625006',
    300, 800, 85000, 45000, 50000,
    'approved', true
  )
  on conflict (slug) do update set
    owner_id      = excluded.owner_id,
    name          = excluded.name,
    description   = excluded.description,
    city          = excluded.city,
    state         = excluded.state,
    address       = excluded.address,
    pincode       = excluded.pincode,
    capacity_min  = excluded.capacity_min,
    capacity_max  = excluded.capacity_max,
    price_per_day = excluded.price_per_day,
    price_morning = excluded.price_morning,
    price_evening = excluded.price_evening,
    status        = excluded.status,
    is_premium    = excluded.is_premium
  returning id into v_hall_id;

  -- 3a. Amenities (AC, Parking, Dining Hall, Stage, Bride/Groom Room,
  --     Generator Backup, CCTV, Sound System, Kitchen).
  insert into public.hall_amenities (hall_id, amenity_id)
  select v_hall_id, a.id from public.amenities a
  where a.slug in (
    'air-conditioning','free-parking','dining-hall','av-stage-setup',
    'bride-room','groom-room','generator-backup','cctv','sound-system','kitchen'
  )
  on conflict (hall_id, amenity_id) do nothing;

  -- 3b. Cover image (local placeholder under public/images; replace with a real
  --     uploaded photo later).
  delete from public.hall_images where hall_id = v_hall_id;
  insert into public.hall_images (hall_id, url, alt_text, is_cover, sort_order)
  values (
    v_hall_id, '/images/example-hall.svg',
    'Grand Lotus Mahal wedding hall in Thirunagar, Madurai', true, 1
  );

  -- 3c. A few availability rows so the calendar + booking flow have data.
  --     Upcoming dates: some blocked, rest implicitly available.
  insert into public.availability (hall_id, date, slot, status, note)
  select v_hall_id, current_date + d, slot::booking_slot, status::availability_status, note
  from (values
    (5,  'full_day', 'booked',         'Example: pre-booked wedding'),
    (12, 'morning',  'morning_booked', 'Example: morning reception'),
    (20, 'evening',  'evening_booked', 'Example: evening sangeet')
  ) as v(d, slot, status, note)
  on conflict (hall_id, date, slot) do nothing;

  raise notice 'Example hall ready: grand-lotus-mahal (id=%)', v_hall_id;
end $$;

commit;

-- Verify:
--   select slug, name, city, status, capacity_min, capacity_max, price_per_day
--   from public.halls where slug = 'grand-lotus-mahal';
--   select count(*) from public.halls where status = 'approved';   -- should be 1
