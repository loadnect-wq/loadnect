-- ─────────────────────────────────────────────────────────────────────────────
-- 0114  Online booking with an advance is back — as each hall's own choice
--
-- WHY. 0112 switched direct booking off: halls_direct_booking_switched_off
-- (and its twin on admin_hall_drafts) forced every hall to LEAD_GENERATION,
-- and owners lost the UPDATE grant on halls.booking_mode. Its header names the
-- way back — drop those two constraints and restore the grant. This is that,
-- plus one guard the old system never had.
--
-- WHAT STAYS EXACTLY AS IT IS:
--   • halls_booking_mode_allowed: only the two modes exist.
--   • halls_direct_booking_needs_price (and the drafts twin): a hall that takes
--     an advance must have a price to take it from.
--   • The column default stays LEAD_GENERATION (0112). A hall takes online
--     payment only when its owner chooses it. THIS MIGRATION SWITCHES NO HALL.
--   • Every quote rule from 0112 — the quote columns, the contact_phone column
--     grant, booked-only-after-accepted.
--   • The booking money path, which 0112 never touched: the service-role-only
--     insert (0031), the coupon and fee-floor guards (0045/0077/0078/0085), the
--     standard commission (0097/0100), the overlap exclusion (0024).
--
-- THE NEW GUARD. A booking row takes a slot and, once paid, raises a commission
-- retained from an advance and a payout to the venue. Until now the only thing
-- stopping a booking against a hall that takes quotes was the mode check in
-- createBookingRequest. That check stays; this puts the same rule in the
-- database, on INSERT only, so a booking already in flight is unaffected if its
-- hall later changes mode. createBookingRequest is the only writer of bookings
-- (offline diary bookings live in their own table), so nothing legitimate is
-- refused.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Lift 0112's switch.
alter table public.halls drop constraint if exists halls_direct_booking_switched_off;
alter table public.admin_hall_drafts drop constraint if exists admin_hall_drafts_direct_booking_switched_off;

-- 2. The owner's choice, through the same named UPDATE grant as 0073 and 0088.
grant update (booking_mode) on public.halls to authenticated;

-- 3. A booking only for an approved hall that takes online bookings.
create or replace function public.guard_booking_hall_takes_online_booking()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from public.halls h
    where h.id = new.hall_id
      and h.booking_mode = 'DIRECT_BOOKING'
      and h.status = 'approved'
  ) then
    raise exception 'bookings: this hall does not take online bookings';
  end if;
  return new;
end; $function$;

-- Trigger functions are not API (0098).
revoke all on function public.guard_booking_hall_takes_online_booking() from public;
revoke all on function public.guard_booking_hall_takes_online_booking() from anon, authenticated;

drop trigger if exists trg_guard_booking_hall_takes_online_booking on public.bookings;
create trigger trg_guard_booking_hall_takes_online_booking
  before insert on public.bookings
  for each row execute function public.guard_booking_hall_takes_online_booking();

-- 4. Verify.
do $$
begin
  if exists (select 1 from pg_constraint
             where conname in ('halls_direct_booking_switched_off', 'admin_hall_drafts_direct_booking_switched_off')) then
    raise exception '0114: a switched-off constraint is still present';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'halls_direct_booking_needs_price')
     or not exists (select 1 from pg_constraint where conname = 'admin_hall_drafts_direct_booking_needs_price')
     or not exists (select 1 from pg_constraint where conname = 'halls_booking_mode_allowed') then
    raise exception '0114: a mode or price rule went missing';
  end if;
  if not has_column_privilege('authenticated', 'public.halls', 'booking_mode', 'UPDATE') then
    raise exception '0114: owners cannot choose their booking mode';
  end if;
  if has_column_privilege('anon', 'public.halls', 'booking_mode', 'UPDATE') then
    raise exception '0114: anon can change a booking mode';
  end if;
  if (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'halls' and column_name = 'booking_mode')
     not like '%LEAD_GENERATION%' then
    raise exception '0114: the default mode is no longer LEAD_GENERATION';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_booking_hall_takes_online_booking') then
    raise exception '0114: the booking mode guard is missing';
  end if;
end $$;
