-- ─────────────────────────────────────────────────────────────────────────────
-- 0094_admin_hall_draft_photos.sql — photos on admin-recorded halls.
--
-- ADDITIVE. No table, column or row is dropped or rewritten. Three changes:
--
--   1. A CHECK on admin_hall_drafts.photo_urls.
--   2. claim_admin_hall_draft() records storage_path for the photos it copies.
--   3. One NEW storage DELETE policy, so an owner who claimed a listing can
--      remove the photos the admin uploaded for it.
--
-- ════════════════════════════════════════════════════════════════════════════
-- NO NEW TABLE, NO NEW BUCKET — BOTH ALREADY EXIST
-- ════════════════════════════════════════════════════════════════════════════
-- • Bucket: `hall-images` (0010) — public, 5 MB, JPEG/PNG/WebP only, enforced
--   by Storage itself. Admin photos go in it under the DRAFT's id:
--       hall-images/{draft_id}/{random uuid}.{jpg|png|webp}
--   The existing storage policies cast the first folder to uuid and allow
--   is_admin() to insert and delete, so they already cover this path — a draft
--   id is a uuid, and only admins can write it.
-- • Metadata: admin_hall_drafts.photo_urls (0090) — an ORDERED text[]. Index 0
--   is the cover. claim_admin_hall_draft() already fans it out into
--   hall_images with is_cover = (position 0) and sort_order = position, which
--   is exactly the shape every hall card, gallery and search result reads. A
--   second image table for drafts would be a duplicate system that the claim
--   would then have to reconcile.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE CHECK — FAIL AT SAVE, NOT AT THE HANDOVER
-- ════════════════════════════════════════════════════════════════════════════
-- photo_urls was an unconstrained text[], but the claim copies each entry into
-- hall_images, where hall_images_url_is_our_storage (0083) demands our own
-- bucket. Any other value would save here and then abort the OWNER's claim
-- weeks later with an error about someone else's data. The check requires:
--   • at most 20 photos;
--   • no repeats;
--   • every url is a public object URL in hall-images, inside THIS draft's
--     folder, named {uuid}.{jpg|png|webp} — the exact shape the server action
--     generates. A url pointing into another draft's or another hall's folder
--     is refused, so two listings can never share (and delete) one file.
-- Verified before adding: the table holds 0 rows.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 2. storage_path ON CLAIM
-- ════════════════════════════════════════════════════════════════════════════
-- The claim inserted hall_images(url, is_cover, sort_order) with storage_path
-- NULL. The owner's photo manager deletes the storage object by storage_path,
-- so with NULL it removed the row and left the file behind forever. The path is
-- now derived from the url, which the server built from the path in the first
-- place (publicUrlForStoragePath) and the CHECK above pins to that shape.
--
-- PATCHED IN PLACE, NOT RETYPED. The live function is NOT byte-identical to
-- 0090: it also writes a 'hall_draft.claim' audit row that no migration in
-- this repository contains. Re-declaring the function from 0090 would silently
-- delete that audit write. So this reads the LIVE definition, replaces exactly
-- the one INSERT statement, asserts the replacement happened exactly once, and
-- re-creates it. Everything else — identity check, locking, slug, amenities,
-- the audit row — is untouched by construction.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 3. THE OWNER CAN DELETE WHAT THEY CLAIMED
-- ════════════════════════════════════════════════════════════════════════════
-- hall_images_storage_delete allows owns_hall(first folder) or is_admin(). For
-- a claimed draft's photos the first folder is the DRAFT id, not the hall id,
-- so owns_hall() is false and the owner's delete was refused (logged as an
-- orphan, file kept). A new, separate policy — policies are OR'd, the existing
-- four are unchanged — allows DELETE when the folder is a draft that produced a
-- hall the caller owns. SECURITY DEFINER helper so the check does not depend on
-- the caller being able to read admin_hall_drafts through its own RLS.
-- Only DELETE: the owner's own uploads go to their hall's folder as before.
--
-- ROLLBACK:
--   drop policy if exists hall_images_storage_delete_claimed_draft on storage.objects;
--   drop function if exists public.owns_claimed_draft_folder(text);
--   alter table public.admin_hall_drafts drop constraint if exists admin_hall_drafts_photo_urls_valid;
--   drop function if exists public.admin_hall_draft_photo_urls_valid(text[], uuid);
--   (the claim function change is a one-statement revert of the INSERT column list)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. CHECK ────────────────────────────────────────────────────────────────
create or replace function public.admin_hall_draft_photo_urls_valid(_urls text[], _draft_id uuid)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(cardinality(_urls), 0) <= 20
     and coalesce(cardinality(_urls), 0) = (select count(distinct u) from unnest(_urls) as u)
     and not exists (
       select 1 from unnest(_urls) as u
       where u !~ ('^https://[^/]+/storage/v1/object/public/hall-images/'
                   || _draft_id::text
                   || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
     );
$$;

comment on function public.admin_hall_draft_photo_urls_valid(text[], uuid) is
  'CHECK helper for admin_hall_drafts.photo_urls: <= 20, unique, each a public '
  'hall-images URL inside the draft''s own folder named {uuid}.{jpg|png|webp}. '
  'Pure; EXECUTE stays granted because a CHECK runs with the writer''s privileges.';

alter table public.admin_hall_drafts
  drop constraint if exists admin_hall_drafts_photo_urls_valid;
alter table public.admin_hall_drafts
  add constraint admin_hall_drafts_photo_urls_valid
  check (public.admin_hall_draft_photo_urls_valid(photo_urls, id));

-- ── 2. storage_path on claim (patch the LIVE definition) ────────────────────
do $patch$
declare
  v_def  text := pg_get_functiondef('public.claim_admin_hall_draft(uuid)'::regprocedure);
  v_old1 constant text := 'insert into public.hall_images (hall_id, url, is_cover, sort_order)';
  v_new1 constant text := 'insert into public.hall_images (hall_id, url, storage_path, is_cover, sort_order)';
  v_old2 constant text := 'values (v_hall_id, trim(v_photo), v_idx = 0, v_idx);';
  v_new2 constant text := 'values (v_hall_id, trim(v_photo), substring(trim(v_photo) from ''/storage/v1/object/public/hall-images/(.+)$''), v_idx = 0, v_idx);';
begin
  if position(v_new1 in v_def) > 0 then
    raise notice '0094: claim function already records storage_path — skipping';
    return;
  end if;
  -- Exactly one occurrence of each, or refuse: a patch that matched twice, or
  -- not at all, is not the function this migration was written against.
  if (length(v_def) - length(replace(v_def, v_old1, ''))) / length(v_old1) <> 1
     or (length(v_def) - length(replace(v_def, v_old2, ''))) / length(v_old2) <> 1 then
    raise exception '0094: claim_admin_hall_draft does not contain the expected photo INSERT exactly once — not patching';
  end if;
  execute replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
  -- Nothing else moved: the new definition is the old one plus exactly the two
  -- inserted fragments' worth of characters.
  if length(pg_get_functiondef('public.claim_admin_hall_draft(uuid)'::regprocedure))
     <> length(v_def) + (length(v_new1) - length(v_old1)) + (length(v_new2) - length(v_old2)) then
    raise exception '0094: claim function changed by more than the photo INSERT';
  end if;
end
$patch$;

-- CREATE OR REPLACE keeps existing grants, but restate them so this file alone
-- describes the intended surface.
revoke all on function public.claim_admin_hall_draft(uuid) from public, anon;
grant execute on function public.claim_admin_hall_draft(uuid) to authenticated;

-- ── 3. Owner may delete a claimed draft's photos ────────────────────────────
create or replace function public.owns_claimed_draft_folder(_folder text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.admin_hall_drafts d
    where d.id::text = _folder          -- text compare: never a failed uuid cast
      and d.claim_status = 'claimed'
      and d.claimed_hall_id is not null
      and public.owns_hall(d.claimed_hall_id)
  );
$$;

comment on function public.owns_claimed_draft_folder(text) is
  'RLS helper: true when the storage folder is an admin draft that was claimed '
  'into a hall the CALLER owns. Answers only about the caller''s own session.';

-- Same reasoning as the RLS helpers in 0092: evaluated inside a policy with the
-- querying user's privileges, so authenticated keeps EXECUTE. anon never owns.
revoke all on function public.owns_claimed_draft_folder(text) from public, anon;
grant execute on function public.owns_claimed_draft_folder(text) to authenticated;

drop policy if exists hall_images_storage_delete_claimed_draft on storage.objects;
create policy hall_images_storage_delete_claimed_draft on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'hall-images'
    and public.owns_claimed_draft_folder((storage.foldername(objects.name))[1])
  );

notify pgrst, 'reload schema';

-- ── Self-verification ───────────────────────────────────────────────────────
do $verify$
declare
  v_base  constant text := 'https://example.supabase.co/storage/v1/object/public/hall-images/';
  v_draft constant uuid := '11111111-1111-4111-8111-111111111111';
  v_other constant uuid := '22222222-2222-4222-8222-222222222222';
  v_file  constant text := 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg';
  v_many  text[] := '{}';
  i int;
begin
  if not public.admin_hall_draft_photo_urls_valid('{}', v_draft) then
    raise exception '0094: an empty photo list must be valid';
  end if;
  if not public.admin_hall_draft_photo_urls_valid(array[v_base || v_draft || '/' || v_file], v_draft) then
    raise exception '0094: a correct photo url was refused';
  end if;
  if public.admin_hall_draft_photo_urls_valid(array[v_base || v_other || '/' || v_file], v_draft) then
    raise exception '0094: a url in ANOTHER draft''s folder was accepted';
  end if;
  if public.admin_hall_draft_photo_urls_valid(array['https://evil.example/x.jpg'], v_draft) then
    raise exception '0094: a foreign url was accepted';
  end if;
  if public.admin_hall_draft_photo_urls_valid(array[v_base || v_draft || '/../x.jpg'], v_draft) then
    raise exception '0094: a traversal-shaped name was accepted';
  end if;
  if public.admin_hall_draft_photo_urls_valid(
       array[v_base || v_draft || '/' || v_file, v_base || v_draft || '/' || v_file], v_draft) then
    raise exception '0094: a repeated photo was accepted';
  end if;
  for i in 1..21 loop
    v_many := v_many || (v_base || v_draft || '/' || lpad(i::text, 8, '0') || '-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg');
  end loop;
  if public.admin_hall_draft_photo_urls_valid(v_many, v_draft) then
    raise exception '0094: 21 photos were accepted';
  end if;
  if not public.admin_hall_draft_photo_urls_valid(v_many[1:20], v_draft) then
    raise exception '0094: 20 photos were refused';
  end if;

  if position('storage_path' in pg_get_functiondef('public.claim_admin_hall_draft(uuid)'::regprocedure)) = 0 then
    raise exception '0094: claim function does not record storage_path';
  end if;
  if (select substring(v_base || v_draft || '/' || v_file from '/storage/v1/object/public/hall-images/(.+)$'))
     <> v_draft::text || '/' || v_file then
    raise exception '0094: storage_path derivation is wrong';
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'hall_images_storage_delete_claimed_draft' and cmd = 'DELETE') then
    raise exception '0094: claimed-draft delete policy missing';
  end if;
  -- The four existing policies must still be there, unchanged in number.
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('hall_images_storage_select', 'hall_images_storage_insert',
                           'hall_images_storage_update', 'hall_images_storage_delete')) <> 4 then
    raise exception '0094: an existing hall-images storage policy is missing';
  end if;
end
$verify$;
