-- ─────────────────────────────────────────────────────────────────────────────
-- 0088_a_listing_is_not_the_owners_to_unpublish.sql
--
-- Four holes around the LISTING ITSELF, found while auditing the platform's
-- first genuine third-party venue. They share a shape: the application is
-- careful and the database is not, so anything that skips the application — one
-- PostgREST PATCH with the anon key and a valid access token — walks through.
--
-- ═══ 1. AN OWNER COULD DELIST THEIR OWN APPROVED VENUE, PERMANENTLY ══════════
--
-- 0046 grants `update (status)` to `authenticated`, and
-- prevent_hall_self_approve only refuses a moderation decision as the NEW value
-- ('approved', 'rejected', 'suspended') plus any move OUT of 'suspended'. So
--
--     PATCH /rest/v1/halls?id=eq.<own hall>   {"status": "draft"}
--
-- was accepted. The venue leaves search, the sitemap, the city page and every
-- shared link. Then it is stuck: draft -> approved is admin-only, so the owner
-- cannot put it back, no audit row records what happened, and no alert fires.
-- You find out because the site is empty.
--
-- app/owner/(dashboard)/actions.ts already names this hole in its own comment
-- and guards it in application code, by reading the current status before
-- submitting for review. That guard is right and stays; it just cannot be the
-- only one, because it is not in the path a raw PATCH takes.
--
-- The fix mirrors the clause that already exists for 'suspended': a hall that
-- is APPROVED is published, and unpublishing it is a moderation decision like
-- any other. There is no owner-facing "pause my listing" feature today, so
-- nothing legitimate is being taken away — and when that feature is built it
-- becomes a real action with an audit row, rather than an undocumented PATCH.
--
-- ═══ 2. A SUSPENDED OWNER COULD STILL REWRITE A LIVE LISTING ═════════════════
--
-- 0081 put an is_active_user() gate on the seven tables it enumerated, and
-- hall_images / hall_amenities / hall_custom_amenities were not among them —
-- even though they hold the public content of the listing and their write
-- policies are plain `for all using (owns_hall(hall_id) or is_admin())`. So with
-- is_active = false: UPDATE halls correctly matched zero rows, while DELETE on
-- the amenities and UPDATE on all nine image rows were both accepted. A
-- suspended owner could blank the amenities and point every image URL somewhere
-- else on a page that is still being served to the public.
--
-- That is the worst possible half-measure: suspension that stops the owner
-- managing the venue but not defacing it.
--
-- ═══ 3. halls.slug WAS CLIENT-WRITABLE AND NOTHING WRITES IT ═════════════════
--
-- The slug is generated once at insert and never updated by any code path (the
-- owner's edit payload does not include it). It was nonetheless in 0046's named
-- UPDATE grant, so one PATCH would 404 every Google result, every WhatsApp
-- share, the sitemap entry and /enquiry/<old-slug> at once — with the new URL
-- known only to whoever made the change.
--
-- ═══ 4. hall_amenities WAS WORLD-READABLE REGARDLESS OF HALL STATUS ══════════
--
-- hall_images_select and hall_custom_amenities_select both require the hall to
-- be approved (or yours, or you an admin). hall_amenities_select's qual was
-- `true`, so the amenity list of a draft, pending or suspended hall was
-- readable by anon. Latent rather than exploitable today — the UUID of a
-- non-approved hall is not obtainable through halls_select — but it is the one
-- of three sibling tables that does not enforce what the other two do, and that
-- kind of asymmetry is what a future join turns into a leak.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Only Hallnect unpublishes a published listing ────────────────────────

create or replace function public.prevent_hall_self_approve()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return new;
  end if;

  -- Cannot move a hall INTO a moderation decision.
  if new.status is distinct from old.status
     and new.status in ('approved', 'rejected', 'suspended') then
    raise exception 'Not allowed: only an administrator can approve, reject or suspend a hall';
  end if;

  -- Cannot move a hall OUT of suspension either. Only Hallnect lifts it.
  if old.status = 'suspended' and new.status is distinct from old.status then
    raise exception 'Not allowed: this listing is suspended and only Hallnect can restore it';
  end if;

  -- ...nor OUT of 'approved'. An approved hall is PUBLISHED: it is in search,
  -- the sitemap, the city page and whatever links people have shared. Taking it
  -- down is a moderation decision, and it is also irreversible for the owner
  -- (draft -> approved is admin-only), so an accidental or malicious PATCH was
  -- a one-way door. There is no owner-facing unpublish feature to break.
  if old.status = 'approved' and new.status is distinct from old.status then
    raise exception 'Not allowed: this listing is live. Contact Hallnect to take it down or change its status';
  end if;

  return new;
end;
$function$;

-- ── 2. Suspension reaches the listing's own content ─────────────────────────

do $mig$
declare
  t text;
  tables text[] := array['hall_images', 'hall_amenities', 'hall_custom_amenities'];
begin
  foreach t in array tables loop
    -- Idempotent: this migration may be re-run against a database that already
    -- has part of it.
    execute format('drop policy if exists %I on public.%I', t || '_active_writer_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_active_writer_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_active_writer_del', t);

    -- RESTRICTIVE, exactly as 0081: Postgres ANDs these over whatever the
    -- table already decided, so not one existing policy body is rewritten and
    -- this cannot change who is allowed to do what — only add "and the account
    -- is active" on top. Writes only; a suspended owner reading their own
    -- listing is not a problem.
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated '
      'with check (public.is_active_user())', t || '_active_writer_ins', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated '
      'using (public.is_active_user()) with check (public.is_active_user())',
      t || '_active_writer_upd', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated '
      'using (public.is_active_user())', t || '_active_writer_del', t);
  end loop;
end
$mig$;

-- ── 3. The slug is ours ─────────────────────────────────────────────────────
--
-- A COLUMN-LEVEL REVOKE CANNOT NARROW A TABLE-LEVEL GRANT, and this schema has
-- failed three migrations' verify blocks on exactly that. Here it is safe: 0046
-- already replaced the table-wide UPDATE on halls with a named column list, so
-- there is no table-level UPDATE to fight with. The verify block below asserts
-- with has_column_privilege rather than trusting that.

revoke update (slug) on public.halls from anon, authenticated;

-- ── 4. Amenities follow the hall's visibility, like their two siblings ───────

drop policy if exists hall_amenities_select on public.hall_amenities;

create policy hall_amenities_select on public.hall_amenities
for select
using (
  exists (
    select 1 from public.halls h
    where h.id = hall_amenities.hall_id
      and (h.status = 'approved'::hall_status or public.owns_hall(h.id) or public.is_admin())
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify. BEHAVIOURAL, and it RAISES — a failed assertion fails the migration
-- and rolls back everything above it.
--
-- The tests run against a THROWAWAY hall created here and deleted at the end,
-- so no assertion is ever made by writing to a real listing. If anything
-- raises, the whole transaction unwinds and the throwaway goes with it.
-- ─────────────────────────────────────────────────────────────────────────────

do $verify$
declare
  v_owner       uuid;
  v_profile     uuid;
  v_hall        uuid;
  v_img         uuid;
  v_amenity     uuid;
  v_status      text;
  v_delisted    boolean := false;
  v_img_rows    integer;
  v_amen_rows   integer;
  v_anon_rows   integer;
begin
  -- ── 3. the grant, asserted per column ─────────────────────────────────────
  if has_column_privilege('authenticated', 'public.halls', 'slug', 'UPDATE') then
    raise exception '0088 FAILED: authenticated can still UPDATE halls.slug';
  end if;
  if has_column_privilege('anon', 'public.halls', 'slug', 'UPDATE') then
    raise exception '0088 FAILED: anon can still UPDATE halls.slug';
  end if;
  -- ...and the columns the owner edit form DOES write must survive, or every
  -- save on /owner/halls/<id>/edit turns into a 42501.
  if not has_column_privilege('authenticated', 'public.halls', 'name', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.halls', 'price_per_day', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.halls', 'booking_mode', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.halls', 'status', 'UPDATE') then
    raise exception '0088 FAILED: the owner edit form lost a column it needs';
  end if;

  -- ── 2. the restrictive gates exist on all three content tables ────────────
  if (select count(*) from pg_policies
      where schemaname = 'public'
        and tablename in ('hall_images', 'hall_amenities', 'hall_custom_amenities')
        and permissive = 'RESTRICTIVE') <> 9 then
    raise exception '0088 FAILED: expected 9 restrictive write policies across the three content tables, found %',
      (select count(*) from pg_policies
       where schemaname = 'public'
         and tablename in ('hall_images', 'hall_amenities', 'hall_custom_amenities')
         and permissive = 'RESTRICTIVE');
  end if;

  -- ── A throwaway owner + hall to test behaviour against ────────────────────
  select ho.id, ho.profile_id into v_owner, v_profile
  from public.hall_owners ho limit 1;

  if v_owner is null then
    raise notice '0088: no hall_owners row, behavioural tests skipped (grants and policies asserted above)';
    return;
  end if;

  insert into public.halls (owner_id, name, slug, city, capacity_max, status, booking_mode)
  values (v_owner, '0088 verify throwaway', '0088-verify-throwaway-' || gen_random_uuid(),
          'Madurai', 100, 'approved', 'LEAD_GENERATION')
  returning id into v_hall;

  insert into public.hall_images (hall_id, url, is_cover)
  values (v_hall, 'https://kvcrqhmgthixhqrjytay.supabase.co/storage/v1/object/public/hall-images/'
                  || v_hall || '/verify.jpg', true)
  returning id into v_img;

  select id into v_amenity from public.amenities limit 1;
  if v_amenity is not null then
    insert into public.hall_amenities (hall_id, amenity_id) values (v_hall, v_amenity);
  end if;

  -- ── 1. approved -> draft must be refused for a non-admin, non-backend ─────
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_profile, 'role', 'authenticated')::text, true);

    -- TWO WAYS THIS CAN BE REFUSED, and both count as refused: the trigger
    -- raises, or RLS filters the statement to zero rows without raising. Only
    -- an UPDATE that actually changed a row means the hole is still open, so
    -- the row count is the evidence and "no exception" on its own is not.
    begin
      declare
        v_rows integer;
      begin
        with u as (
          update public.halls set status = 'draft' where id = v_hall returning 1
        ) select count(*) into v_rows from u;
        v_delisted := (v_rows > 0);
      end;
    exception when others then
      v_delisted := false;         -- the trigger refused, which is the point
    end;

    reset role;
    perform set_config('request.jwt.claims', null, true);
  exception when others then
    reset role;
    perform set_config('request.jwt.claims', null, true);
    raise;
  end;

  -- ── 2. a SUSPENDED owner must not be able to touch images or amenities ────
  update public.profiles set is_active = false where id = v_profile;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_profile, 'role', 'authenticated')::text, true);

    -- RLS filters to zero rows WITHOUT raising, so the row COUNT is the
    -- evidence. "It didn't error" proves nothing here.
    with u as (
      -- CONFORMS to 0083's url CHECK on purpose. A non-conforming value would
      -- be rejected by the constraint, and the test would pass for the wrong
      -- reason — proving the constraint works, not that RLS stopped anyone.
      update public.hall_images
         set url = 'https://kvcrqhmgthixhqrjytay.supabase.co/storage/v1/object/public/hall-images/'
                   || v_hall || '/defaced.jpg'
      where id = v_img returning 1
    ) select count(*) into v_img_rows from u;

    with d as (
      delete from public.hall_amenities where hall_id = v_hall returning 1
    ) select count(*) into v_amen_rows from d;

    reset role;
    perform set_config('request.jwt.claims', null, true);
  exception when others then
    reset role;
    perform set_config('request.jwt.claims', null, true);
    update public.profiles set is_active = true where id = v_profile;
    raise;
  end;

  -- RESTORE the real account before any assertion can abort the block.
  update public.profiles set is_active = true where id = v_profile;

  -- ── 4. anon must not see a non-approved hall's amenities ──────────────────
  update public.halls set status = 'draft' where id = v_hall;   -- as postgres: allowed

  begin
    set local role anon;
    select count(*) into v_anon_rows from public.hall_amenities where hall_id = v_hall;
    reset role;
  exception when others then
    reset role;
    raise;
  end;

  -- ── Tear the throwaway down, then assert ──────────────────────────────────
  delete from public.availability    where hall_id = v_hall;
  delete from public.hall_amenities where hall_id = v_hall;
  delete from public.hall_images    where hall_id = v_hall;
  delete from public.halls          where id      = v_hall;

  select status::text into v_status from public.halls where id = v_hall;
  if v_status is not null then
    raise exception '0088 FAILED: the throwaway hall % was not cleaned up', v_hall;
  end if;

  if v_delisted then
    raise exception '0088 FAILED: an owner can still move their APPROVED hall to draft';
  end if;
  if v_img_rows <> 0 then
    raise exception '0088 FAILED: a suspended owner updated % hall_images row(s)', v_img_rows;
  end if;
  if v_amenity is null then
    raise notice '0088: the amenities catalogue is empty, so the amenity tests are vacuous';
  elsif v_amen_rows <> 0 then
    raise exception '0088 FAILED: a suspended owner deleted % hall_amenities row(s)', v_amen_rows;
  end if;
  if v_amenity is not null and v_anon_rows <> 0 then
    raise exception '0088 FAILED: anon read % hall_amenities row(s) of a draft hall', v_anon_rows;
  end if;

  raise notice '0088 OK: delist refused, suspended owner wrote 0 image and 0 amenity rows, anon saw % amenity rows of a draft hall, slug not client-writable',
    v_anon_rows;
end
$verify$;
