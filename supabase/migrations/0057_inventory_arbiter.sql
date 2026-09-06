-- 0057 — one arbiter for "is this inventory free?", and the lock that makes it
-- safe under concurrency.
--
-- THE GAP THIS CLOSES. The database enforced booking-vs-booking
-- (uq_booking_active_slot, prevent_overlapping_booking) and NOTHING enforced
-- booking-vs-availability-block. checkSlotAvailability (lib/availability.ts) is
-- an application-level check-then-insert, so an owner blocking a date and a
-- customer paying for it in the same moment both succeeded.
--
-- Two triggers that merely check each other would NOT fix that: uncommitted
-- rows are invisible across transactions, so both would pass and both commit.
-- The only fix is a shared serialisation point, and since the two claims live in
-- different tables no unique index can be it. An advisory transaction lock can.
--
-- Keyed on (hall, DAY), not (hall, day, slot): a full_day claim conflicts with a
-- morning one, so slot-level locks would let those two run concurrently and both
-- pass. The day is the smallest unit that contains every conflict.
create or replace function public.inventory_lock_key(_hall_id uuid, _day date)
returns bigint language sql immutable as $function$
  select hashtextextended(_hall_id::text || '|' || _day::text, 0);
$function$;

create or replace function public.assert_inventory_free(
  _hall_id uuid, _from date, _to date, _slot booking_slot,
  _ignore_booking_id uuid default null, _ignore_avail_id uuid default null
) returns void language plpgsql security definer set search_path to 'public' as $function$
declare d date := _from; clash text;
begin
  if _hall_id is null or _from is null or _to is null or _slot is null then
    raise exception 'assert_inventory_free: hall, dates and slot are required';
  end if;

  -- Ascending order is what makes two overlapping ranges deadlock-free. Held
  -- until commit, so a concurrent claimer blocks here instead of reading stale
  -- state — which is the entire point.
  while d <= _to loop
    perform pg_advisory_xact_lock(public.inventory_lock_key(_hall_id, d));
    d := d + 1;
  end loop;

  select 'a confirmed booking' into clash
  from public.bookings b
  where b.hall_id = _hall_id
    and (_ignore_booking_id is null or b.id <> _ignore_booking_id)
    and b.status in ('payment_success','booking_requested','owner_confirmed','completed')
    and daterange(b.event_date, b.end_date, '[]') && daterange(_from, _to, '[]')
    and (_slot = 'full_day' or b.slot = 'full_day' or b.slot = _slot)
  limit 1;
  if clash is not null then
    raise exception 'INVENTORY_TAKEN: % already holds one or more of these dates', clash
      using errcode = 'exclusion_violation';
  end if;

  -- Slot semantics mirror lib/availability.ts exactly: the hard statuses block
  -- any slot; the half-day ones block their own slot and any full-day claim.
  select case a.status
           when 'offline_booked' then 'an offline booking'
           when 'maintenance'    then 'a maintenance block'
           when 'blocked'        then 'a block set by the venue'
           else 'an existing reservation' end into clash
  from public.availability a
  where a.hall_id = _hall_id
    and a.date between _from and _to
    and (_ignore_avail_id is null or a.id <> _ignore_avail_id)
    and (_ignore_booking_id is null or a.booking_id is null or a.booking_id <> _ignore_booking_id)
    and (
      a.status in ('booked','blocked','full_day_booked','maintenance','offline_booked')
      or (_slot in ('full_day','morning') and a.status in ('morning_booked','partially_booked'))
      or (_slot in ('full_day','evening') and a.status in ('evening_booked','partially_booked'))
    )
  limit 1;
  if clash is not null then
    raise exception 'INVENTORY_TAKEN: % already holds one or more of these dates', clash
      using errcode = 'exclusion_violation';
  end if;
end;
$function$;

revoke all on function public.assert_inventory_free(uuid, date, date, booking_slot, uuid, uuid) from public, anon, authenticated;
revoke all on function public.inventory_lock_key(uuid, date) from public, anon, authenticated;
