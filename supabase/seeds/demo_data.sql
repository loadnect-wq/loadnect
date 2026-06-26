-- ═════════════════════════════════════════════════════════════════════════════
-- demo_data.sql — Hallnect demo seed (12 halls across 6 South Indian cities)
-- ─────────────────────────────────────────────────────────────────────────────
-- Run inside Supabase → SQL editor (which executes as `postgres`, so all
-- privilege-escalation triggers will accept this script via is_trusted_backend()).
-- Idempotent: re-running this file is safe; existing rows are skipped or updated.
-- All demo UUIDs use a deterministic 0xDE…/0xAA…/0x11… prefix so reset is easy.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ 1. DEMO USERS (1 owner + 3 customers — used for hall_owners and reviews) ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
-- NOTE: The auth.users insert triggers handle_new_user(), which auto-creates
-- the public.profiles row with role 'customer'. We then promote the owner.
-- Passwords are unusable random bcrypt hashes — these accounts are not login-able.

do $$
declare
  v_inst uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, raw_user_meta_data,
    created_at, updated_at, is_super_admin
  )
  values
    ('de100000-0000-0000-0000-000000000001'::uuid, v_inst, 'authenticated', 'authenticated',
     'demo-owner@hallnect.local',
     crypt('seed-' || gen_random_uuid()::text, gen_salt('bf')),
     now(), '{"name":"Demo Hall Owner","role":"owner"}'::jsonb, now(), now(), false),

    ('de100000-0000-0000-0000-000000000002'::uuid, v_inst, 'authenticated', 'authenticated',
     'demo-priya@hallnect.local',
     crypt('seed-' || gen_random_uuid()::text, gen_salt('bf')),
     now(), '{"name":"Priya Ramanathan"}'::jsonb, now(), now(), false),

    ('de100000-0000-0000-0000-000000000003'::uuid, v_inst, 'authenticated', 'authenticated',
     'demo-karthik@hallnect.local',
     crypt('seed-' || gen_random_uuid()::text, gen_salt('bf')),
     now(), '{"name":"Karthik Iyer"}'::jsonb, now(), now(), false),

    ('de100000-0000-0000-0000-000000000004'::uuid, v_inst, 'authenticated', 'authenticated',
     'demo-meera@hallnect.local',
     crypt('seed-' || gen_random_uuid()::text, gen_salt('bf')),
     now(), '{"name":"Meera Nair"}'::jsonb, now(), now(), false)
  on conflict (id) do nothing;
end $$;

-- Backfill profile names + promote demo-owner to owner_approved.
-- (prevent_role_change trigger accepts this because the SQL editor runs as `postgres`.)
update public.profiles set full_name = 'Demo Hall Owner',  role = 'owner_approved'
  where id = 'de100000-0000-0000-0000-000000000001';
update public.profiles set full_name = 'Priya Ramanathan' where id = 'de100000-0000-0000-0000-000000000002';
update public.profiles set full_name = 'Karthik Iyer'     where id = 'de100000-0000-0000-0000-000000000003';
update public.profiles set full_name = 'Meera Nair'       where id = 'de100000-0000-0000-0000-000000000004';

-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ 2. HALL OWNER (business record the 12 halls attach to)                   ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
insert into public.hall_owners (
  id, profile_id, business_name, business_email, business_phone,
  gst_number, pan_number, address, city, state, payout_upi,
  is_verified, verified_at
)
values (
  '11111111-1111-1111-1111-111111111111'::uuid,
  'de100000-0000-0000-0000-000000000001'::uuid,
  'Hallnect Demo Venues Pvt. Ltd.',
  'demo-owner@hallnect.local', '+91 90000 00000',
  '33ABCDE1234F1Z5', 'ABCDE1234F',
  '1st Floor, T. Nagar, Chennai',
  'Chennai', 'Tamil Nadu',
  'demoowner@upi',
  true, now()
)
on conflict (profile_id) do update
  set business_name = excluded.business_name,
      is_verified  = true,
      verified_at  = now();

-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ 3. THE 12 HALLS — 2 in each of Chennai, Coimbatore, Madurai,             ║
-- ║                   Bangalore, Hyderabad, Kochi                           ║
-- ║ Status set to 'approved' so they appear on the public site.             ║
-- ║ rating_average / rating_count are recomputed by trigger from reviews.   ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
insert into public.halls (
  id, owner_id, name, slug, description,
  city, state, address, pincode, latitude, longitude,
  capacity_min, capacity_max,
  price_per_day, price_morning, price_evening,
  status, is_premium
)
values
  -- ── CHENNAI ─────────────────────────────────────────────────────────────
  ('aaaa0001-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid,
   'Annai Pearl Mahal',  'annai-pearl-mahal-chennai',
   'Traditional Tamil Brahmin wedding hall in the cultural heart of Mylapore. Spacious AC main hall, separate bridal suite, in-house Chettinad & Brahmin catering, and an experienced events team for South Indian rituals. Hall type: Traditional Wedding Mahal.',
   'Chennai', 'Tamil Nadu',
   '14, Kapaleeshwarar Sannidhi Street, Mylapore, Chennai',
   '600004', 13.0337, 80.2697,
   200, 800,  250000, 140000, 160000,
   'approved', true),

  ('aaaa0001-0000-0000-0000-000000000002'::uuid, '11111111-1111-1111-1111-111111111111'::uuid,
   'Marina Grand Convention', 'marina-grand-convention-chennai',
   'Modern banquet venue near T. Nagar with floor-to-ceiling windows and crystal chandeliers. Two pillar-less halls and a rooftop terrace for cocktail receptions. Hall type: Premium Banquet Hall.',
   'Chennai', 'Tamil Nadu',
   '210, Usman Road, T. Nagar, Chennai',
   '600017', 13.0418, 80.2341,
   300, 1500, 380000, 210000, 240000,
   'approved', true),

  -- ── COIMBATORE ──────────────────────────────────────────────────────────
  ('aaaa0002-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid,
   'Kovai Kalyana Mandapam', 'kovai-kalyana-mandapam-coimbatore',
   'Long-standing community wedding hall on Avinashi Road. Pillar-free 600-guest hall, traditional South Indian decor, in-house cook team and ample parking for two-wheelers and cars. Hall type: Community Kalyana Mandapam.',
   'Coimbatore', 'Tamil Nadu',
   '88, Avinashi Road, Peelamedu, Coimbatore',
   '641004', 11.0298, 76.9794,
   150, 600,  120000, 70000, 80000,
   'approved', false),

  ('aaaa0002-0000-0000-0000-000000000002'::uuid, '11111111-1111-1111-1111-111111111111'::uuid,
   'Saravana Banquet Centre', 'saravana-banquet-centre-coimbatore',
   'Boutique banquet venue in RS Puram. Intimate 400-guest setting ideal for receptions and engagements. In-house decor team and tie-ups with the cities top photographers. Hall type: Reception Hall.',
   'Coimbatore', 'Tamil Nadu',
   '5, Race Course Road, RS Puram, Coimbatore',
   '641002', 11.0064, 76.9550,
   100, 400,  95000, 55000, 60000,
   'approved', false),

  -- ── MADURAI ─────────────────────────────────────────────────────────────
  ('aaaa0003-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid,
   'Meenakshi Heritage Mahal', 'meenakshi-heritage-mahal-madurai',
   'Heritage-style wedding mahal moments from the Meenakshi temple. Hand-painted ceilings, brass lamps, and a 1000-guest pillar-less hall. Traditional thali-meal catering and in-house nadaswaram orchestra. Hall type: Heritage Wedding Mahal.',
   'Madurai', 'Tamil Nadu',
   '32, East Veli Street, Madurai',
   '625001', 9.9195, 78.1196,
   200, 1000, 180000, 100000, 115000,
   'approved', true),

  ('aaaa0003-0000-0000-0000-000000000002'::uuid, '11111111-1111-1111-1111-111111111111'::uuid,
   'Vaigai Sangam Convention', 'vaigai-sangam-convention-madurai',
   'Modern convention centre on Alagar Kovil Road. Two AC halls, modular stage, dedicated 200-car parking and adjoining guest rooms for outstation families. Hall type: Modern Convention Centre.',
   'Madurai', 'Tamil Nadu',
   'KK Nagar, Alagar Kovil Road, Madurai',
   '625020', 9.9379, 78.1410,
   150, 500,  110000, 65000, 70000,
   'approved', false),

  -- ── BANGALORE ───────────────────────────────────────────────────────────
  ('aaaa0004-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid,
   'Sapphire Garden Hall', 'sapphire-garden-hall-bangalore',
   'Centrally located venue in Jayanagar with a lush outdoor garden lawn and an indoor AC hall. Popular for Kannadiga and Tamil weddings. Hall type: Indoor + Garden Wedding Hall.',
   'Bangalore', 'Karnataka',
   '12, 4th Block, Jayanagar, Bangalore',
   '560011', 12.9250, 77.5938,
   150, 700,  165000, 95000, 105000,
   'approved', false),

  ('aaaa0004-0000-0000-0000-000000000002'::uuid, '11111111-1111-1111-1111-111111111111'::uuid,
   'Whitefield Royale Convention', 'whitefield-royale-convention-bangalore',
   'Premium convention centre in Whitefield with a resort-style outdoor setting. Pool-side cocktail area, valet parking and full bar service. Hall type: Premium Resort Convention.',
   'Bangalore', 'Karnataka',
   'ITPL Main Road, Whitefield, Bangalore',
   '560066', 12.9852, 77.7261,
   100, 350,  295000, 165000, 185000,
   'approved', true),

  -- ── HYDERABAD ───────────────────────────────────────────────────────────
  ('aaaa0005-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid,
   'Nizami Mehfil Banquet', 'nizami-mehfil-banquet-hyderabad',
   'Elegant nikah and walima venue in Banjara Hills. Separate ladies enclosure, Hyderabadi dum biryani catering team, and a fully wired AV mehfil stage. Hall type: Muslim Wedding Banquet.',
   'Hyderabad', 'Telangana',
   'Road No. 12, Banjara Hills, Hyderabad',
   '500034', 17.4145, 78.4456,
   250, 900,  175000, 100000, 115000,
   'approved', false),

  ('aaaa0005-0000-0000-0000-000000000002'::uuid, '11111111-1111-1111-1111-111111111111'::uuid,
   'Charminar Grand Convention', 'charminar-grand-convention-hyderabad',
   'Premium convention centre in Jubilee Hills with a domed central hall and gold-leaf accents. Ideal for grand Telugu and Marwari weddings. Hall type: Grand Wedding Convention.',
   'Hyderabad', 'Telangana',
   'Road No. 36, Jubilee Hills, Hyderabad',
   '500033', 17.4317, 78.4078,
   400, 1200, 320000, 180000, 205000,
   'approved', true),

  -- ── KOCHI ───────────────────────────────────────────────────────────────
  ('aaaa0006-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid,
   'Backwater Pearl Convention', 'backwater-pearl-convention-kochi',
   'Waterfront convention venue on Marine Drive with backwater views. AC pillar-less hall, separate Christian and Hindu wedding setups, and Kerala sadya catering team. Hall type: Waterfront Convention.',
   'Kochi', 'Kerala',
   'Marine Drive, Ernakulam, Kochi',
   '682031', 9.9745, 76.2823,
   150, 600,  185000, 105000, 120000,
   'approved', true),

  ('aaaa0006-0000-0000-0000-000000000002'::uuid, '11111111-1111-1111-1111-111111111111'::uuid,
   'Periyar Banquet Palace', 'periyar-banquet-palace-kochi',
   'Traditional Malayalee wedding hall in Edappally with a 800-guest main hall, kalyana mandapam stage, and authentic sadya catering on banana leaves. Hall type: Traditional Kerala Mahal.',
   'Kochi', 'Kerala',
   'NH Bypass, Edappally, Kochi',
   '682024', 10.0240, 76.3080,
   200, 800,  140000, 80000, 90000,
   'approved', false)
on conflict (slug) do nothing;

-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ 4. AMENITIES — link each hall to 6 common amenities                      ║
-- ║ (slugs come from migration 0008_seed_amenities.sql)                      ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
insert into public.hall_amenities (hall_id, amenity_id)
select h.id, a.id
from public.halls h
cross join lateral (
  select id from public.amenities
  where slug in (
    'air-conditioning', 'valet-parking', 'in-house-catering',
    'in-house-decor', 'av-stage-setup', 'generator-backup'
  )
) a
where h.slug in (
  'annai-pearl-mahal-chennai',           'marina-grand-convention-chennai',
  'kovai-kalyana-mandapam-coimbatore',   'saravana-banquet-centre-coimbatore',
  'meenakshi-heritage-mahal-madurai',    'vaigai-sangam-convention-madurai',
  'sapphire-garden-hall-bangalore',      'whitefield-royale-convention-bangalore',
  'nizami-mehfil-banquet-hyderabad',     'charminar-grand-convention-hyderabad',
  'backwater-pearl-convention-kochi',    'periyar-banquet-palace-kochi'
)
on conflict do nothing;

-- Premium-only extras: bridal suite + outdoor garden + DJ
insert into public.hall_amenities (hall_id, amenity_id)
select h.id, a.id
from public.halls h
cross join lateral (
  select id from public.amenities
  where slug in ('bridal-suite', 'outdoor-garden', 'dj-music')
) a
where h.is_premium = true
on conflict do nothing;

-- Whitefield Royale: pool
insert into public.hall_amenities (hall_id, amenity_id)
select h.id, a.id
from public.halls h, public.amenities a
where h.slug = 'whitefield-royale-convention-bangalore'
  and a.slug = 'swimming-pool'
on conflict do nothing;

-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ 5. HALL IMAGES — 4 per hall, 1 cover                                     ║
-- ║ Uses picsum.photos with a deterministic per-hall seed. CC0-equivalent    ║
-- ║ Unsplash-backed photos — safe to use as demo placeholders. Replace with  ║
-- ║ your own Supabase Storage URLs once you upload real photos.              ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
insert into public.hall_images (hall_id, url, alt_text, is_cover, sort_order)
select
  h.id,
  format('https://picsum.photos/seed/%s-%s/1200/800', h.slug, n) as url,
  format('%s — photo %s', h.name, n) as alt_text,
  (n = 1) as is_cover,
  n as sort_order
from public.halls h
cross join generate_series(1, 4) as n
where h.slug like '%-chennai'
   or h.slug like '%-coimbatore'
   or h.slug like '%-madurai'
   or h.slug like '%-bangalore'
   or h.slug like '%-hyderabad'
   or h.slug like '%-kochi'
on conflict do nothing;

-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ 6. AVAILABILITY EXAMPLES                                                 ║
-- ║ For every demo hall: mark a handful of upcoming dates as blocked/booked  ║
-- ║ so the calendar UI on the detail page shows real-looking gaps.          ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
insert into public.availability (hall_id, date, slot, status, note)
select h.id, current_date + d::int, slot::booking_slot, status::availability_status, note
from public.halls h
cross join lateral (
  values
    (3,  'full_day', 'booked',          'Demo: pre-booked wedding'),
    (7,  'morning',  'morning_booked',  'Demo: morning reception'),
    (12, 'evening',  'evening_booked',  'Demo: evening sangeet'),
    (18, 'full_day', 'booked',          'Demo: full-day wedding'),
    (25, 'full_day', 'blocked',         'Demo: owner maintenance')
) as v(d, slot, status, note)
where h.slug like any (array[
  '%-chennai','%-coimbatore','%-madurai','%-bangalore','%-hyderabad','%-kochi'
])
on conflict (hall_id, date, slot) do nothing;

-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ 7. REVIEWS — 3 per hall from the 3 demo customers                        ║
-- ║ The recalc_hall_rating trigger will set halls.rating_average and         ║
-- ║ halls.rating_count automatically from these rows.                        ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
-- A small comment library, indexed by rating
with comments(rating, comment) as (values
  (5, 'Absolutely magical venue. The team handled every detail — our families couldn''t stop praising the food and decor.'),
  (5, 'Spacious, spotless and great value. The bridal suite was a lifesaver during the long ritual day.'),
  (5, 'Booked through Hallnect in under 10 minutes. Owner confirmed within an hour. Truly stress-free.'),
  (4, 'Beautiful hall and very helpful staff. Parking was a bit tight on the wedding day, but overall lovely.'),
  (4, 'Great venue, AC could be stronger during the afternoon muhurtham, but the catering more than made up for it.')
),
customer_comments as (
  select customer_id, rating, comment, row_number() over (partition by customer_id order by random()) as rn
  from (values
    ('de100000-0000-0000-0000-000000000002'::uuid),
    ('de100000-0000-0000-0000-000000000003'::uuid),
    ('de100000-0000-0000-0000-000000000004'::uuid)
  ) c(customer_id)
  cross join comments
)
insert into public.reviews (hall_id, customer_id, rating, comment, is_visible)
select h.id, cc.customer_id, cc.rating, cc.comment, true
from public.halls h
join customer_comments cc on cc.rn <= 1   -- 1 review per customer per hall = 3 reviews per hall
where h.slug like any (array[
  '%-chennai','%-coimbatore','%-madurai','%-bangalore','%-hyderabad','%-kochi'
])
on conflict (customer_id, hall_id) do nothing;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- DONE.  Verify with:
--   select count(*) from public.halls       where status = 'approved';   -- 12
--   select count(*) from public.hall_images;                              -- 48
--   select count(*) from public.hall_amenities;                           -- ~84
--   select count(*) from public.availability;                             -- 60
--   select count(*) from public.reviews;                                  -- 36
--   select name, city, rating_average, rating_count from public.halls
--      order by city, name;
-- ─────────────────────────────────────────────────────────────────────────────
