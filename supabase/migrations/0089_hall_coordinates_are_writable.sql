-- ─────────────────────────────────────────────────────────────────────────────
-- 0089_hall_coordinates_are_writable.sql — let an owner set their venue's map
-- pin.
--
-- WHY THIS IS A GRANT AND NOT A SCHEMA CHANGE. halls.latitude and
-- halls.longitude have existed as numeric(9,6) since 0002_core_tables.sql:62-63,
-- and the whole READ path is already wired end to end: lib/halls.ts selects and
-- numifies them, app/halls/[slug]/page.tsx hands them to venueJsonLd, and
-- lib/seo/jsonld.ts emits a GeoCoordinates node when both are present. The only
-- thing missing was the ability to ever put a value there.
--
-- 0046_lock_privileged_columns.sql revoked the table-wide UPDATE on halls and
-- re-granted it COLUMN BY NAME (0046:185-190), with the stated rule that an
-- owner "creates and edits their listing's descriptive fields. Money,
-- placement, rating, moderation and ownership are absent by design." That list
-- already carries address, city, state and pincode — every other way of saying
-- where the venue is — and simply never mentioned the two coordinate columns,
-- because at the time nothing in the product wrote them. Verified before
-- writing this: has_column_privilege('authenticated','public.halls','latitude',
-- 'UPDATE') returns false while the same call for 'description' and
-- 'venue_types' returns true.
--
-- So this is the same category as those four, not a widening of the policy.
-- 0073_lead_generation.sql:88-93 is the precedent: it granted booking_mode by
-- name for exactly this reason. RLS still decides WHICH rows — halls_update is
-- (owns_hall(id) OR is_admin()) — so this grants the ability to write a column,
-- never the ability to write someone else's venue.
--
-- ORDERING. This migration must land BEFORE the application code that writes
-- the columns. On its own it is a no-op: granting UPDATE on a column nothing
-- writes changes nothing. Deployed the other way round, every owner hall edit
-- returns 42501 and hall editing is dead until this runs.
--
-- ROLLBACK:
--   revoke update (latitude, longitude) on public.halls from authenticated;
-- ─────────────────────────────────────────────────────────────────────────────

grant update (latitude, longitude) on public.halls to authenticated;

-- PostgREST caches the privilege map; without this the grant is invisible to
-- the API until the next schema reload.
notify pgrst, 'reload schema';

-- ── Self-verification ───────────────────────────────────────────────────────
-- Asserts what this migration was meant to do, and — just as importantly —
-- that it widened nothing else. A future reader can see the blast radius was
-- checked rather than assumed.
do $verify$
begin
  if not has_column_privilege('authenticated', 'public.halls', 'latitude', 'UPDATE') then
    raise exception '0089: authenticated still cannot UPDATE halls.latitude';
  end if;
  if not has_column_privilege('authenticated', 'public.halls', 'longitude', 'UPDATE') then
    raise exception '0089: authenticated still cannot UPDATE halls.longitude';
  end if;

  -- The public read path must be untouched: 0072 granted anon SELECT on these
  -- columns, and the venue page's JSON-LD depends on it.
  if not has_column_privilege('anon', 'public.halls', 'latitude', 'SELECT') then
    raise exception '0089: anon lost SELECT on halls.latitude';
  end if;

  -- The money column 0046 deliberately withholds must STILL be unwritable. If
  -- this ever fires, something in this migration was far broader than intended.
  if has_column_privilege('authenticated', 'public.halls', 'commission_rate', 'UPDATE') then
    raise exception '0089: authenticated can now UPDATE halls.commission_rate — grant was too broad';
  end if;
end
$verify$;
