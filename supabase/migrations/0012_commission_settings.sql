-- ─────────────────────────────────────────────────────────────────────────────
-- 0012_commission_settings.sql
-- Global platform commission % (admin-editable) + hall_id on commissions.
--
-- Design:
--   • `platform_settings` is a single-row config table (constrained by
--     `id = true`).  Only admins can read or write it.
--   • `get_commission_percent()` is a SECURITY DEFINER helper that returns the
--     active rate to ANY logged-in role without exposing the row itself.  The
--     customer booking action needs the rate to compute the platform fee at
--     booking time; without this helper they'd be blocked by RLS.
--   • `commissions.hall_id` is denormalised so the admin can filter/aggregate
--     commission by hall directly.  Backfilled from `bookings.hall_id`.
--   • Existing RLS on `commissions` (0007) already enforces:
--       - admin: full access
--       - owner: read only commissions for halls they own (via owns_hall)
--       - customer: NO select policy → fully blocked (default-deny)
--       - client writes: only admin; service-role bypasses RLS (the trusted
--         backend records the commission)
--     and the partial unique `commissions_booking_id_key` (booking_id UNIQUE
--     in 0005) prevents duplicate commission rows for the same booking.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. platform_settings (single-row) ────────────────────────────────────────
create table if not exists public.platform_settings (
  id                 boolean primary key default true,
  commission_percent numeric(5, 2) not null default 5
    check (commission_percent between 0 and 100),
  updated_at         timestamptz   not null default now(),
  updated_by         uuid references public.profiles (id) on delete set null,
  constraint platform_settings_single_row check (id = true)
);

insert into public.platform_settings (id, commission_percent) values (true, 5)
on conflict (id) do nothing;

drop trigger if exists trg_set_updated_at on public.platform_settings;
create trigger trg_set_updated_at
  before update on public.platform_settings
  for each row execute function public.set_updated_at();

-- RLS — admin reads + writes; everyone else blocked at row level.
alter table public.platform_settings enable row level security;

drop policy if exists platform_settings_admin_read on public.platform_settings;
create policy platform_settings_admin_read on public.platform_settings
  for select using (public.is_admin());

drop policy if exists platform_settings_admin_write on public.platform_settings;
create policy platform_settings_admin_write on public.platform_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- ── 2. Helper — read the active rate without exposing the row ────────────────
-- Returns a single number, runs as table owner (postgres), so RLS doesn't
-- block it. Customers calling this never see the platform_settings row itself.
create or replace function public.get_commission_percent()
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select commission_percent from public.platform_settings where id = true),
    5
  );
$$;

grant execute on function public.get_commission_percent() to anon, authenticated, service_role;

-- ── 3. commissions.hall_id ───────────────────────────────────────────────────
alter table public.commissions
  add column if not exists hall_id uuid references public.halls (id) on delete set null;

-- Backfill from existing bookings (one statement, idempotent).
update public.commissions c
   set hall_id = b.hall_id
  from public.bookings b
 where c.booking_id = b.id
   and c.hall_id is null;

create index if not exists idx_commissions_hall on public.commissions (hall_id);

-- ── 4. Guard — owners/customers cannot mutate commissions ────────────────────
-- Defense-in-depth on top of RLS: if a future RLS change accidentally permits
-- writes, this trigger still blocks any non-trusted/non-admin update or delete.
create or replace function public.guard_commission_writes()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return coalesce(new, old);
  end if;
  raise exception 'Not allowed: only an administrator can modify commissions';
end;
$$;

drop trigger if exists trg_guard_commission_writes on public.commissions;
create trigger trg_guard_commission_writes
  before insert or update or delete on public.commissions
  for each row execute function public.guard_commission_writes();
