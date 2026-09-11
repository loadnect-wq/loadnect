-- ─────────────────────────────────────────────────────────────────────────────
-- 0083_hall_image_url_must_be_ours.sql
--
-- hall_images.url WAS WHATEVER THE OWNER SAID IT WAS. addHallImage took `url`
-- and `storagePath` as two separate client fields and validated only the path
-- (it must start with `<hallId>/`). The url was stored verbatim, so an owner
-- could upload a real photo to their own folder and register any http(s)
-- address as the picture.
--
-- WHAT SAVED IT, and neither of these is in this codebase's control:
--   • the CSP's img-src names only self, data:, blob:, the Supabase origin and
--     Google Analytics — so a foreign URL does not render;
--   • next.config.ts allows remote images only from this project's Supabase
--     storage host.
-- A stored value being harmless because a header in another layer refuses to
-- display it is not the same as the value being right. hall_images.url is also
-- read by the sitemap and the structured-data feed, where no CSP applies.
--
-- FIXED PROPERLY IN THE APPLICATION: the url is now DERIVED from the storage
-- path (publicUrlForStoragePath), so there is one client-controlled field
-- instead of two that can disagree. A validator has to anticipate every way two
-- values can diverge; a derivation cannot diverge at all.
--
-- THIS MIGRATION IS THE SECOND LAYER, for the paths that do not go through that
-- function — lib/supabase/storage.ts uploads directly from the browser with the
-- session client, and any future writer. The constraint states the invariant
-- where the data lives rather than in whichever function happens to write it.
--
-- DELIBERATELY HOST-AGNOSTIC. It asserts the SHAPE of a Supabase public object
-- URL in the hall-images bucket, not a specific hostname, so local, preview and
-- production all satisfy it and restoring a production dump into a branch does
-- not fail. The hostname is pinned separately and in the right place — the
-- next.config.ts allow-list, which is what actually fetches these.
--
-- Existing rows checked before adding it: 1 row, conforming.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.hall_images
  drop constraint if exists hall_images_url_is_our_storage;

alter table public.hall_images
  add constraint hall_images_url_is_our_storage
  check (url like 'https://%/storage/v1/object/public/hall-images/%');

comment on constraint hall_images_url_is_our_storage on public.hall_images is
  'A hall image must live in our own storage bucket. The application derives '
  'this url from storage_path (publicUrlForStoragePath); this constraint is the '
  'second layer, for writers that do not. Shape, not hostname, so every '
  'environment satisfies it.';

-- ── Verify ──────────────────────────────────────────────────────────────────
do $mig$
declare
  v_hall uuid;
  ok boolean := false;
begin
  select id into v_hall from public.halls limit 1;
  if v_hall is null then
    raise notice 'no hall - skipping behavioural verify';
    return;
  end if;

  -- A foreign URL must now be refused.
  begin
    insert into public.hall_images (hall_id, url, storage_path, is_cover, sort_order)
    values (v_hall, 'https://evil.example/x.jpg', v_hall || '/zz.jpg', false, 0);
    raise exception 'GUARD FAILED: a foreign image url was accepted';
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'GUARD FAILED: refusal did not come from the check constraint';
  end if;

  -- And a legitimate one must still insert. If this constraint blocks real
  -- uploads it is worse than the hole it closes.
  insert into public.hall_images (hall_id, url, storage_path, is_cover, sort_order)
  values (v_hall,
          'https://kvcrqhmgthixhqrjytay.supabase.co/storage/v1/object/public/hall-images/'
            || v_hall || '/zz-verify.jpg',
          v_hall || '/zz-verify.jpg', false, 0);
  delete from public.hall_images where storage_path = v_hall || '/zz-verify.jpg';

  raise notice 'hall_images.url constrained to our storage bucket';
end
$mig$;
