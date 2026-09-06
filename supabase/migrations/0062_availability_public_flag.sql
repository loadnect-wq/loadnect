-- 0062 — make the read policy something Realtime can actually evaluate,
--        and stop publishing the owner's reference to the world.
--
-- ── 1. THE PRIVACY BUG ───────────────────────────────────────────────────────
-- create_offline_booking copied _reference into availability.note, and
-- availability is PUBLICLY readable. The field is labelled "your reference" in
-- the UI, but an owner will eventually type a customer's name into it — and then
-- it is published to every visitor. The public row needs nothing beyond "this
-- slot is taken"; the reference belongs in offline_bookings, where only the
-- venue and an admin can read it.
--
-- ── 2. THE REALTIME BUG ──────────────────────────────────────────────────────
-- Measured from a real browser against production: an anonymous subscriber
-- received DELETEs but NOT INSERTs, even with no filter. Supabase evaluates the
-- SELECT policy against the candidate row before delivering an insert, and the
-- old availability_select was
--
--   EXISTS (SELECT 1 FROM halls h WHERE h.id = availability.hall_id
--           AND (h.status='approved' OR owns_hall(h.id) OR is_admin()))
--
-- — a correlated subquery into another table plus two SECURITY DEFINER calls.
-- That does not survive Realtime's evaluation context, so the row is dropped and
-- a date going OFF sale never reaches the customer's calendar. That is the half
-- that matters: a released date being missed is a lost sale, a taken date being
-- missed is a customer paying for something that is gone.
--
-- is_public is denormalised from halls.status by trigger so the policy can
-- short-circuit on a row-local boolean before reaching any function call.
--
-- This is NOT a widening. The policy admits exactly the rows it did before —
-- public halls, plus the owner's own and an admin's. Only the shape changes.
-- The privacy argument is unchanged too: this table is (hall_id, date, slot,
-- status) plus opaque uuids, and after (1) it carries no free text at all.

update public.availability set note = null where offline_booking_id is not null;

alter table public.availability
  add column if not exists is_public boolean not null default false;

comment on column public.availability.is_public is
  'Denormalised from halls.status = approved, maintained by trigger. Exists so the read policy has a row-local predicate Realtime can evaluate — a correlated subquery cannot be. Never set by hand.';

update public.availability a
   set is_public = (select h.status = 'approved' from public.halls h where h.id = a.hall_id);

create index if not exists idx_availability_public_hall_date
  on public.availability (hall_id, date) where is_public;

create or replace function public.sync_availability_is_public()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  new.is_public := exists (
    select 1 from public.halls h where h.id = new.hall_id and h.status = 'approved'
  );
  return new;
end;
$function$;

drop trigger if exists trg_availability_is_public on public.availability;
create trigger trg_availability_is_public
  before insert or update of hall_id on public.availability
  for each row execute function public.sync_availability_is_public();

-- A hall being approved or withdrawn has to move its rows with it, or a
-- withdrawn hall keeps publishing its calendar to anonymous subscribers.
create or replace function public.sync_availability_on_hall_status()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.status is distinct from old.status then
    update public.availability
       set is_public = (new.status = 'approved')
     where hall_id = new.id
       and is_public is distinct from (new.status = 'approved');
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_hall_status_syncs_availability on public.halls;
create trigger trg_hall_status_syncs_availability
  after update of status on public.halls
  for each row execute function public.sync_availability_on_hall_status();

drop policy if exists availability_select on public.availability;
create policy availability_select on public.availability
  for select
  using (is_public or public.owns_hall(hall_id) or public.is_admin());

grant select (is_public) on public.availability to anon, authenticated;
