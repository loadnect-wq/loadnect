-- ─────────────────────────────────────────────────────────────────────────────
-- 0020_hall_custom_amenities.sql
-- Owner-defined amenities, scoped to a single hall.
--
-- WHY A SEPARATE TABLE (and not the existing `amenities` catalogue):
--   `amenities` is a GLOBAL, admin-seeded catalogue joined to halls through
--   `hall_amenities`. Inserting owner text there would make one owner's
--   "Private Temple Area" selectable by every other owner. Custom amenities are
--   per-hall free text, so they get their own table and the standard system is
--   left completely untouched.
--
-- Additive + idempotent. Nothing existing is modified or dropped.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.hall_custom_amenities (
  id         uuid primary key default gen_random_uuid(),
  hall_id    uuid not null references public.halls (id) on delete cascade,
  name       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Length is enforced in the DB too, not just in Zod — the DB is the last line
  -- of defence against a malformed direct write.
  constraint hall_custom_amenity_name_len
    check (char_length(btrim(name)) between 2 and 60)
);

create index if not exists idx_hca_hall on public.hall_custom_amenities (hall_id);

-- Case/whitespace-insensitive uniqueness per hall: "Parking", " parking " and
-- "PARKING" collapse to one amenity instead of four.
create unique index if not exists uq_hca_hall_name
  on public.hall_custom_amenities (hall_id, lower(btrim(name)));

drop trigger if exists trg_set_updated_at on public.hall_custom_amenities;
create trigger trg_set_updated_at
  before update on public.hall_custom_amenities
  for each row execute function public.set_updated_at();

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ RLS                                                                        ║
-- ║  SELECT — visible to the public ONLY when the hall itself is approved.     ║
-- ║           Owners/admins always see their own. This is deliberately         ║
-- ║           STRICTER than hall_amenities (which is `using (true)`): custom   ║
-- ║           amenities are user-generated text, so a draft/pending/rejected   ║
-- ║           hall must not leak its wording before review (see §14).          ║
-- ║  WRITE  — the hall's owner, or an admin. Mirrors hall_amenities_write.     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.hall_custom_amenities enable row level security;

drop policy if exists hall_custom_amenities_select on public.hall_custom_amenities;
create policy hall_custom_amenities_select on public.hall_custom_amenities
  for select using (
    exists (
      select 1 from public.halls h
      where h.id = hall_custom_amenities.hall_id
        and (h.status = 'approved' or public.owns_hall(h.id) or public.is_admin())
    )
  );

drop policy if exists hall_custom_amenities_write on public.hall_custom_amenities;
create policy hall_custom_amenities_write on public.hall_custom_amenities
  for all using (public.owns_hall(hall_id) or public.is_admin())
          with check (public.owns_hall(hall_id) or public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- End 0020. Standard amenities (`amenities` / `hall_amenities`) are unchanged.
-- ─────────────────────────────────────────────────────────────────────────────
