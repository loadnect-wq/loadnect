-- ─────────────────────────────────────────────────────────────────────────────
-- 0106_offline_booking_money.sql
--
-- THE DIARY NEEDS TO KNOW WHO STILL OWES WHAT. A hall manager's paper diary
-- records three things against every function: who, which date, and how much
-- of the agreed amount has come in. offline_bookings (0058) has the first two.
-- This adds the third, so /owner/diary can replace the notebook rather than
-- sit beside it.
--
--   total_amount     what the venue agreed with the customer, rupees
--   amount_received  what has been paid so far, rupees
--
-- Both NULLABLE, and null means "not recorded" — never zero. A booking blocked
-- before this migration, or blocked in a hurry with no money discussed, must
-- not read as "Rs.0 total, fully paid". The UI renders null as "no amount".
--
-- RECEIVED CANNOT EXCEED TOTAL. Balance due = total - received is the number
-- the diary leads with; a negative balance would be a data-entry slip shown
-- back as "the customer is owed money". When a customer pays for extras, the
-- owner raises the total — which is also what actually happened.
--
-- ═══ WRITES STAY IN RPCs ════════════════════════════════════════════════════
--
-- offline_bookings has NO client write policy and no INSERT/UPDATE grant
-- (0058), and that does not change. create_offline_booking gains two optional
-- parameters; update_offline_booking is new and can change ONLY the private
-- detail — name, phone, notes and money. Dates and slot are deliberately not
-- editable: moving a booking is a release plus a new claim, and only the
-- create path holds the advisory lock (assert_inventory_free, 0057) that keeps
-- it from colliding with a customer paying online for the same day.
--
-- REPLACING create_offline_booking. Adding parameters creates an OVERLOAD, and
-- a call naming only the old nine arguments would then match both versions and
-- fail as "function is not unique". So the nine-argument version is dropped and
-- the eleven-argument one created in the same transaction. The two new
-- parameters default to null, so every existing caller — the availability
-- screen, and the code deployed when this runs — keeps working unchanged.
--
-- Columns are readable through the existing table-level SELECT grant (0058),
-- which RLS limits to the venue's own halls and admins.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.offline_bookings
  add column if not exists total_amount    numeric(12,2),
  add column if not exists amount_received numeric(12,2);

alter table public.offline_bookings
  drop constraint if exists offline_bookings_total_range,
  drop constraint if exists offline_bookings_received_range,
  drop constraint if exists offline_bookings_received_le_total;

alter table public.offline_bookings
  -- Ten crore is far past any hall booking; it exists to catch a mistyped
  -- extra zero before it becomes the headline figure on the diary.
  add constraint offline_bookings_total_range
    check (total_amount is null or (total_amount >= 0 and total_amount <= 100000000)),
  add constraint offline_bookings_received_range
    check (amount_received is null or (amount_received >= 0 and amount_received <= 100000000)),
  add constraint offline_bookings_received_le_total
    check (total_amount is null or amount_received is null or amount_received <= total_amount);

comment on column public.offline_bookings.total_amount is
  'Amount the venue agreed with the customer, in rupees. NULL = not recorded, never zero.';
comment on column public.offline_bookings.amount_received is
  'Amount paid so far, in rupees. NULL = not recorded. Never exceeds total_amount.';

-- ═══ create_offline_booking, with money ═════════════════════════════════════

drop function if exists public.create_offline_booking(uuid, date, date, booking_slot, text, text, text, text, uuid);

create or replace function public.create_offline_booking(
  _hall_id uuid, _event_date date, _end_date date, _slot booking_slot,
  _customer_name text default null, _customer_phone text default null,
  _notes text default null, _reference text default null,
  _client_token uuid default null,
  _total_amount numeric default null, _amount_received numeric default null
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
  -- Raised here with words an owner can act on; the table constraints would
  -- otherwise surface as a bare 23514.
  if _total_amount is not null and _total_amount < 0
     or _amount_received is not null and _amount_received < 0 then
    raise exception 'AMOUNT_INVALID: amounts cannot be negative';
  end if;
  if _total_amount is not null and _amount_received is not null and _amount_received > _total_amount then
    raise exception 'AMOUNT_INVALID: the amount received cannot be more than the total';
  end if;

  -- A retry of a request that already succeeded. Returned BEFORE the inventory
  -- check, because that check would refuse it against its own first attempt.
  if _client_token is not null then
    select id into v_id from public.offline_bookings
     where hall_id = _hall_id and client_token = _client_token;
    if v_id is not null then return v_id; end if;
  end if;

  perform public.assert_inventory_free(_hall_id, _event_date, _end_date, _slot, null, null);

  insert into public.offline_bookings
    (hall_id, event_date, end_date, slot, customer_name, customer_phone, notes,
     reference, created_by, client_token, total_amount, amount_received)
  values (_hall_id, _event_date, _end_date, _slot,
          nullif(btrim(_customer_name), ''), nullif(btrim(_customer_phone), ''),
          nullif(btrim(_notes), ''), nullif(btrim(_reference), ''), auth.uid(), _client_token,
          _total_amount, _amount_received)
  returning id into v_id;

  d := _event_date;
  while d <= _end_date loop
    -- NOTE IS NOT COPIED HERE. availability is world-readable; the public row
    -- needs only "this slot is taken". Names, phones, notes and money stay in
    -- offline_bookings, which only the venue and an admin can read.
    insert into public.availability (hall_id, date, slot, status, offline_booking_id)
    values (_hall_id, d, _slot, 'offline_booked', v_id)
    on conflict (hall_id, date, slot) do update
      set status = 'offline_booked', offline_booking_id = excluded.offline_booking_id,
          note = null, updated_at = now();
    d := d + 1;
  end loop;

  insert into public.admin_audit_log
    (actor_id, action, entity_type, entity_id, new_status, reason, metadata)
  values (auth.uid(), 'offline_booking.created', 'hall', _hall_id, 'offline_booked',
          'Dates taken out of circulation by an offline booking',
          jsonb_build_object('offline_booking_id', v_id, 'from', _event_date,
                             'to', _end_date, 'slot', _slot));

  return v_id;
end;
$function$;

revoke all on function public.create_offline_booking(uuid, date, date, booking_slot, text, text, text, text, uuid, numeric, numeric) from public, anon;
grant execute on function public.create_offline_booking(uuid, date, date, booking_slot, text, text, text, text, uuid, numeric, numeric) to authenticated;

-- ═══ update_offline_booking — the private detail only ═══════════════════════
--
-- A FULL REPLACEMENT of the five editable fields: the caller sends every one,
-- so "clear the phone number" is expressible (send null) and there is no
-- ambiguity between "unchanged" and "removed". Dates, slot, hall and status
-- are not parameters at all.
--
-- The row is locked FOR UPDATE so two devices recording a payment at once
-- serialise rather than interleave; the second simply writes after the first.

create or replace function public.update_offline_booking(
  _id uuid,
  _customer_name text, _customer_phone text, _notes text,
  _total_amount numeric, _amount_received numeric
) returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_hall uuid; v_status text;
begin
  select hall_id, status into v_hall, v_status
    from public.offline_bookings where id = _id
    for update;
  if v_hall is null then
    raise exception 'That offline booking no longer exists';
  end if;
  if not (public.owns_hall(v_hall) or public.is_admin()) then
    raise exception 'Not allowed: you can only manage inventory for your own venue'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'BOOKING_CANCELLED: that booking was cancelled';
  end if;
  if _total_amount is not null and _total_amount < 0
     or _amount_received is not null and _amount_received < 0 then
    raise exception 'AMOUNT_INVALID: amounts cannot be negative';
  end if;
  if _total_amount is not null and _amount_received is not null and _amount_received > _total_amount then
    raise exception 'AMOUNT_INVALID: the amount received cannot be more than the total';
  end if;

  update public.offline_bookings
     set customer_name   = nullif(btrim(_customer_name), ''),
         customer_phone  = nullif(btrim(_customer_phone), ''),
         notes           = nullif(btrim(_notes), ''),
         total_amount    = _total_amount,
         amount_received = _amount_received
   where id = _id;

  -- Amounts in the audit trail, names and phones not: the log is read by
  -- admins for disputes about money and dates, and has no need of PII.
  insert into public.admin_audit_log
    (actor_id, action, entity_type, entity_id, reason, metadata)
  values (auth.uid(), 'offline_booking.updated', 'hall', v_hall,
          'Offline booking details updated from the diary',
          jsonb_build_object('offline_booking_id', _id,
                             'total_amount', _total_amount,
                             'amount_received', _amount_received));
  return _id;
end;
$function$;

revoke all on function public.update_offline_booking(uuid, text, text, text, numeric, numeric) from public, anon;
grant execute on function public.update_offline_booking(uuid, text, text, text, numeric, numeric) to authenticated;

-- ═══ Verify ═════════════════════════════════════════════════════════════════
do $$
begin
  -- Exactly one create_offline_booking, the eleven-argument one.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'create_offline_booking') <> 1 then
    raise exception '0106: create_offline_booking is overloaded — a nine-argument call would be ambiguous';
  end if;
  if not has_function_privilege('authenticated',
       'public.create_offline_booking(uuid, date, date, booking_slot, text, text, text, text, uuid, numeric, numeric)', 'execute') then
    raise exception '0106: authenticated cannot execute create_offline_booking';
  end if;
  if has_function_privilege('anon',
       'public.create_offline_booking(uuid, date, date, booking_slot, text, text, text, text, uuid, numeric, numeric)', 'execute') then
    raise exception '0106: anon can execute create_offline_booking';
  end if;
  if not has_function_privilege('authenticated',
       'public.update_offline_booking(uuid, text, text, text, numeric, numeric)', 'execute') then
    raise exception '0106: authenticated cannot execute update_offline_booking';
  end if;
  if has_function_privilege('anon',
       'public.update_offline_booking(uuid, text, text, text, numeric, numeric)', 'execute') then
    raise exception '0106: anon can execute update_offline_booking';
  end if;

  -- The table stays RPC-only for writes.
  if has_table_privilege('authenticated', 'public.offline_bookings', 'INSERT')
     or has_table_privilege('authenticated', 'public.offline_bookings', 'UPDATE') then
    raise exception '0106: authenticated can write offline_bookings directly';
  end if;
  -- And the new columns are readable to the venue (RLS still decides whose).
  if not has_column_privilege('authenticated', 'public.offline_bookings', 'total_amount', 'SELECT')
     or not has_column_privilege('authenticated', 'public.offline_bookings', 'amount_received', 'SELECT') then
    raise exception '0106: the money columns are not readable by authenticated';
  end if;

  raise notice '0106: offline booking money columns and RPCs verified';
end $$;
