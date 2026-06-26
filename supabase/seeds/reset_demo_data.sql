-- ═════════════════════════════════════════════════════════════════════════════
-- reset_demo_data.sql — Remove all rows created by demo_data.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Run inside Supabase → SQL editor. This wipes ONLY the deterministic
-- demo records (UUIDs prefixed with 0xDE.../0xAA.../0x11...). Real user data
-- and any other halls are untouched.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

-- All halls cascade-delete their images, amenities, availability and reviews,
-- so we just need to delete the halls + the demo hall_owner + the auth.users
-- (deleting auth.users cascade-deletes its profile via the FK on public.profiles).

-- 1) Delete the 12 demo halls — cascades to hall_images, hall_amenities,
--    availability, reviews. Note: deleting halls with active bookings is
--    blocked by the on-delete restrict on bookings.hall_id, so we delete
--    any demo bookings first (there are none by default — this is a safety net).
delete from public.bookings
  where customer_id in (
    'de100000-0000-0000-0000-000000000002'::uuid,
    'de100000-0000-0000-0000-000000000003'::uuid,
    'de100000-0000-0000-0000-000000000004'::uuid
  );

delete from public.halls
  where owner_id = '11111111-1111-1111-1111-111111111111'::uuid;

-- 2) Delete the hall_owners record
delete from public.hall_owners
  where id = '11111111-1111-1111-1111-111111111111'::uuid;

-- 3) Delete the 4 demo auth.users. The FK on public.profiles.id has
--    `on delete cascade`, so profile rows go with them.
delete from auth.users
  where id in (
    'de100000-0000-0000-0000-000000000001'::uuid,
    'de100000-0000-0000-0000-000000000002'::uuid,
    'de100000-0000-0000-0000-000000000003'::uuid,
    'de100000-0000-0000-0000-000000000004'::uuid
  );

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- DONE.  Verify with:
--   select count(*) from public.halls       where owner_id = '11111111-1111-1111-1111-111111111111';   -- 0
--   select count(*) from public.profiles    where id like 'de100000-%';                                 -- 0
--   select count(*) from public.hall_owners where id = '11111111-1111-1111-1111-111111111111';          -- 0
-- ─────────────────────────────────────────────────────────────────────────────
