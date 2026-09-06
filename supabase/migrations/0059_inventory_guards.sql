-- 0059 — both sides of the inventory now go through the same lock.

-- Booking side. Fires only when a booking BECOMES active: a pending_payment row
-- holds no inventory (that is what the 20-minute hold and the slot index are
-- for), and checking on every UPDATE would reject an owner confirming a booking
-- that already legitimately owns its dates.
create or replace function public.guard_booking_against_blocks()
returns trigger language plpgsql set search_path to 'public' as $function$
declare became_active boolean;
begin
  became_active :=
    new.status in ('payment_success','booking_requested','owner_confirmed','completed')
    and (tg_op = 'INSERT' or old.status is distinct from new.status);
  if not became_active then return new; end if;

  -- Excludes this booking's own availability rows: applyPaidSideEffects writes
  -- them stamped with booking_id, and a later status change must not trip over
  -- the marks it made itself.
  perform public.assert_inventory_free(
    new.hall_id, new.event_date, new.end_date, new.slot, new.id, null);
  return new;
end;
$function$;

drop trigger if exists trg_guard_booking_against_blocks on public.bookings;
create trigger trg_guard_booking_against_blocks
  before insert or update on public.bookings
  for each row execute function public.guard_booking_against_blocks();

-- Availability side. Covers the offline-booking RPC AND a direct owner write
-- through setAvailability, which reaches the table via PostgREST and would
-- otherwise bypass every check.
create or replace function public.guard_block_against_bookings()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  -- Rows the payment flow owns are the RESULT of a booking, not a competing
  -- claim on it. Skipping them is what lets applyPaidSideEffects mark the
  -- calendar for the booking it just confirmed.
  if new.booking_id is not null then return new; end if;

  if new.status not in
     ('booked','blocked','full_day_booked','maintenance','offline_booked',
      'morning_booked','evening_booked','partially_booked') then
    return new;  -- 'available' frees inventory; nothing to prove.
  end if;

  perform public.assert_inventory_free(
    new.hall_id, new.date, new.date, new.slot, null, new.id);
  return new;
end;
$function$;

drop trigger if exists trg_guard_block_against_bookings on public.availability;
create trigger trg_guard_block_against_bookings
  before insert or update on public.availability
  for each row execute function public.guard_block_against_bookings();
