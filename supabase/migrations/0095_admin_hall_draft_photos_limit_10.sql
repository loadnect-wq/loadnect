-- ─────────────────────────────────────────────────────────────────────────────
-- 0095_admin_hall_draft_photos_limit_10.sql — an admin-recorded listing may
-- carry up to 10 photos, not 20.
--
-- Only the number changes. The rest of admin_hall_draft_photo_urls_valid (0094)
-- is restated byte for byte: no repeats, and every url a public hall-images
-- object inside the draft's own folder named {uuid}.{jpg|png|webp}. The CHECK
-- constraint calls this function, so replacing the function is enough — the
-- constraint itself is not touched.
--
-- Checked before applying: no draft holds more than 10 photos (0 drafts exist).
-- The application limit (MAX_DRAFT_PHOTOS, the upload and save schemas) was
-- lowered in the same change.
--
-- ROLLBACK: re-run 0094's function definition (<= 20).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_hall_draft_photo_urls_valid(_urls text[], _draft_id uuid)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(cardinality(_urls), 0) <= 10
     and coalesce(cardinality(_urls), 0) = (select count(distinct u) from unnest(_urls) as u)
     and not exists (
       select 1 from unnest(_urls) as u
       where u !~ ('^https://[^/]+/storage/v1/object/public/hall-images/'
                   || _draft_id::text
                   || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
     );
$$;

comment on function public.admin_hall_draft_photo_urls_valid(text[], uuid) is
  'CHECK helper for admin_hall_drafts.photo_urls: <= 10, unique, each a public '
  'hall-images URL inside the draft''s own folder named {uuid}.{jpg|png|webp}. '
  'Pure; EXECUTE stays granted because a CHECK runs with the writer''s privileges.';

do $verify$
declare
  v_base  constant text := 'https://example.supabase.co/storage/v1/object/public/hall-images/';
  v_draft constant uuid := '11111111-1111-4111-8111-111111111111';
  v_many  text[] := '{}';
  i int;
begin
  for i in 1..11 loop
    v_many := v_many || (v_base || v_draft || '/' || lpad(i::text, 8, '0') || '-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg');
  end loop;
  if public.admin_hall_draft_photo_urls_valid(v_many, v_draft) then
    raise exception '0095: 11 photos were accepted';
  end if;
  if not public.admin_hall_draft_photo_urls_valid(v_many[1:10], v_draft) then
    raise exception '0095: 10 photos were refused';
  end if;
  if public.admin_hall_draft_photo_urls_valid(array['https://evil.example/x.jpg'], v_draft) then
    raise exception '0095: a foreign url was accepted';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'admin_hall_drafts_photo_urls_valid'
                    and conrelid = 'public.admin_hall_drafts'::regclass) then
    raise exception '0095: the photo CHECK constraint is missing';
  end if;
end
$verify$;
