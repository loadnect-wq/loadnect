-- ─────────────────────────────────────────────────────────────────────────────
-- 0010_storage.sql
-- Supabase Storage: hall-images bucket + RLS policies.
--
-- Bucket is PUBLIC (files served via CDN-friendly public URL). Discovery of
-- non-approved hall images is prevented by the hall_images TABLE RLS (0007):
-- clients never learn the storage path of a non-approved hall's images.
-- The storage policies below add a second layer: even if a path were guessed,
-- only owners/admins can write, and reads still require the hall to be
-- approved (or the caller to be the owner/admin).
--
-- File path convention:  {hall_id}/{uuid}.{ext}
-- Allowed types:         image/jpeg, image/png, image/webp
-- Max file size:         5 MB
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Create the bucket ──────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hall-images',
  'hall-images',
  true,                                              -- public read via CDN URL
  5242880,                                           -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── 2. Storage RLS policies ──────────────────────────────────────────────────
-- Supabase Storage uses the `storage.objects` table. Policies filter on
-- bucket_id and extract the hall_id from the first folder segment of `name`.
--
-- Example: name = 'a1b2c3d4-…/img.jpg'
--   → (storage.foldername(name))[1] = 'a1b2c3d4-…' (the hall UUID)

-- ── SELECT: approved hall → anyone; own hall or admin → always ───────────────
drop policy if exists "hall_images_storage_select" on storage.objects;
create policy "hall_images_storage_select" on storage.objects
  for select using (
    bucket_id = 'hall-images'
    and (
      exists (
        select 1 from public.halls h
        where h.id = ((storage.foldername(name))[1])::uuid
          and h.status = 'approved'
      )
      or public.owns_hall(((storage.foldername(name))[1])::uuid)
      or public.is_admin()
    )
  );

-- ── INSERT: owner of the hall, or admin ─────────────────────────────────────
drop policy if exists "hall_images_storage_insert" on storage.objects;
create policy "hall_images_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'hall-images'
    and (
      public.owns_hall(((storage.foldername(name))[1])::uuid)
      or public.is_admin()
    )
  );

-- ── UPDATE (replace): owner of the hall, or admin ───────────────────────────
drop policy if exists "hall_images_storage_update" on storage.objects;
create policy "hall_images_storage_update" on storage.objects
  for update using (
    bucket_id = 'hall-images'
    and (
      public.owns_hall(((storage.foldername(name))[1])::uuid)
      or public.is_admin()
    )
  ) with check (
    bucket_id = 'hall-images'
    and (
      public.owns_hall(((storage.foldername(name))[1])::uuid)
      or public.is_admin()
    )
  );

-- ── DELETE: owner of the hall, or admin ─────────────────────────────────────
drop policy if exists "hall_images_storage_delete" on storage.objects;
create policy "hall_images_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'hall-images'
    and (
      public.owns_hall(((storage.foldername(name))[1])::uuid)
      or public.is_admin()
    )
  );
