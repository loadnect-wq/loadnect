-- 0060 — the two operations an owner performs, done atomically under the lock.

-- Links an availability row to the offline booking that created it, so release
-- deletes exactly what it wrote. availability.booking_id cannot serve: it is a
-- FK to bookings and an offline booking is not one. Deleting by
-- (hall, date, slot) instead would silently destroy a manual 'blocked' the owner
-- had set for their own reasons on the same day.
alter table public.availability
  add column if not exists offline_booking_id uuid
    references public.offline_bookings(id) on delete cascade;

create index if not exists idx_availability_offline_booking
  on public.availability (offline_booking_id) where offline_booking_id is not null;

-- Public, but opaque: the identifying detail is in offline_bookings, which is not.
grant select (offline_booking_id) on public.availability to anon, authenticated;

-- SECURITY DEFINER because offline_bookings has no client write policy on
-- purpose. The authorisation that replaces is performed explicitly, first.
create or replace function public.create_offline_booking(
  _hall_id uuid, _event_date date, _end_date date, _slot booking_slot,
  _customer_name text default null, _customer_phone text default null,
  _notes text default null, _reference text default null
) returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid; d date;
begin
  if not (public.owns_hall(_hall_id) or public.is_admin()) then
    raise exception 'Not allowed: you can only manage inventory for your own venue'
      using errcode = 'insufficient_privilege';
  end if;
  if _end_date < _event_date then
    raise exception 'The end date cannot be before the start date';
  end if;
  if _end_date - _event_date > 30 then
    raise exception 'An offline booking cannot span more than 31 days';
  end if;

  -- Locks every day in the range and refuses if ANY is claimed, by a Hallnect
  -- booking or another block. Up front, so the caller gets one clear refusal
  -- rather than a partial write that fails on day three.
  perform public.assert_inventory_free(_hall_id, _event_date, _end_date, _slot, null, null);

  insert into public.offline_bookings
    (hall_id, event_date, end_date, slot, customer_name, customer_phone, notes, reference, created_by)
  values (_hall_id, _event_date, _end_date, _slot,
          nullif(btrim(_customer_name), ''), nullif(btrim(_customer_phone), ''),
          nullif(btrim(_notes), ''), nullif(btrim(_reference), ''), auth.uid())
  returning id into v_id;

  d := _event_date;
  while d <= _end_date loop
    insert into public.availability (hall_id, date, slot, status, offline_booking_id, note)
    values (_hall_id, d, _slot, 'offline_booked', v_id, nullif(btrim(_reference), ''))
    on conflict (hall_id, date, slot) do update
      set status = 'offline_booked', offline_booking_id = excluded.offline_booking_id,
          note = excluded.note, updated_at = now();
    d := d + 1;
  end loop;

  -- AUDITED FROM IN HERE, not from the server action. admin_audit_log's INSERT
  -- policy is (is_admin() OR is_trusted_backend()), so recordAdminAction() from
  -- an owner's session is refused — and that helper swallows its errors, so it
  -- would have looked fine while recording nothing for the exact role it exists
  -- to watch. Being inside the RPC also makes it atomic: if the booking
  -- commits, so does its trail.
  --
  -- Records the DATES, never the offline customer's name or phone. It answers
  -- "who took this date out of circulation, and when"; copying a third party's
  -- contact details into a table every admin can read would be gratuitous.
  insert into public.admin_audit_log
    (actor_id, action, entity_type, entity_id, new_status, reason, metadata)
  values (auth.uid(), 'offline_booking.created', 'hall', _hall_id, 'offline_booked',
          'Dates taken out of circulation by an offline booking',
          jsonb_build_object('offline_booking_id', v_id, 'from', _event_date,
                             'to', _end_date, 'slot', _slot));

  return v_id;
end;
$function$;

create or replace function public.cancel_offline_booking(_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_hall uuid; v_from date; v_to date; v_slot booking_slot;
begin
  select hall_id, event_date, end_date, slot into v_hall, v_from, v_to, v_slot
  from public.offline_bookings where id = _id;
  if v_hall is null then raise exception 'That offline booking no longer exists'; end if;
  if not (public.owns_hall(v_hall) or public.is_admin()) then
    raise exception 'Not allowed: you can only manage inventory for your own venue'
      using errcode = 'insufficient_privilege';
  end if;

  update public.offline_bookings
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now()
   where id = _id and status = 'confirmed';

  -- DELETED rather than set 'available': absence is what this schema means by
  -- available (see lib/availability-release.ts), and deleting cannot resurrect a
  -- manual block that predated this offline booking — those rows carry no
  -- offline_booking_id and are never touched here.
  delete from public.availability where offline_booking_id = _id;

  insert into public.admin_audit_log
    (actor_id, action, entity_type, entity_id, previous_status, new_status, reason, metadata)
  values (auth.uid(), 'offline_booking.cancelled', 'hall', v_hall, 'offline_booked', 'available',
          'Offline booking released — the dates are bookable again',
          jsonb_build_object('offline_booking_id', _id, 'from', v_from,
                             'to', v_to, 'slot', v_slot));
end;
$function$;

revoke all on function public.create_offline_booking(uuid, date, date, booking_slot, text, text, text, text) from public, anon;
revoke all on function public.cancel_offline_booking(uuid) from public, anon;
grant execute on function public.create_offline_booking(uuid, date, date, booking_slot, text, text, text, text) to authenticated;
grant execute on function public.cancel_offline_booking(uuid) to authenticated;
