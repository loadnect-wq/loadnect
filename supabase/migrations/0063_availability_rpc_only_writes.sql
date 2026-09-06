-- 0063 — availability becomes a projection nobody hand-edits, and blocking
--        becomes idempotent.

-- ── 1. OWNERS NO LONGER WRITE `availability` DIRECTLY ────────────────────────
--
-- availability_write was FOR ALL USING (owns_hall OR is_admin), and the guard
-- trigger fires on INSERT OR UPDATE — not DELETE. So an owner could
--
--   DELETE /rest/v1/availability?booking_id=eq.<a paid booking>
--
-- and the date a customer had paid for went back on public sale. No double
-- booking resulted — checkout re-checks `bookings` under the advisory lock — but
-- the public calendar lied, and a venue could grief its own confirmed customer.
--
-- The reason this can be CLOSED rather than patched with a DELETE guard is that
-- after this release there is no legitimate owner write to this table at all.
-- The manual availability editor is gone; every remaining writer is either the
-- service role (the payment flow stamping and releasing a booking) or a
-- SECURITY DEFINER RPC owned by postgres. Both bypass RLS and are unaffected.
--
-- The REVOKE is the real gate, not the dropped policy: column and table grants
-- are checked BEFORE RLS and are not is_admin()-aware.
revoke insert, update, delete on public.availability from anon, authenticated;
drop policy if exists availability_write on public.availability;

comment on table public.availability is
  'PUBLIC projection of who holds a (hall, date, slot). Derived, never hand-edited: '
  'rows carrying booking_id belong to a Hallnect booking, rows carrying '
  'offline_booking_id to an offline one. Clients have NO write access — writes come '
  'from the service role (payment flow) or the SECURITY DEFINER inventory RPCs, '
  'which hold the advisory lock. Grants are checked before RLS, so the revoke is '
  'the real gate.';

-- ── 2. IDEMPOTENCY ───────────────────────────────────────────────────────────
--
-- A retried request (flaky mobile connection, a double submit) would otherwise
-- create a SECOND offline booking, or — more likely — be refused with "those
-- dates are not free", because the first attempt now holds them. Both are wrong
-- answers to "did my block go through?", and the second actively misleads.
--
-- A caller-supplied token makes the retry return the ORIGINAL id.
alter table public.offline_bookings
  add column if not exists client_token uuid;

create unique index if not exists uq_offline_booking_client_token
  on public.offline_bookings (hall_id, client_token) where client_token is not null;

comment on column public.offline_bookings.client_token is
  'Caller-supplied idempotency key. A retry with the same token returns the original booking instead of creating a second one or colliding with itself.';

-- The old signature must be DROPPED, not replaced: adding a defaulted parameter
-- creates an overload, and PostgREST cannot choose between two candidates.
drop function if exists public.create_offline_booking(uuid, date, date, booking_slot, text, text, text, text);

create or replace function public.create_offline_booking(
  _hall_id uuid, _event_date date, _end_date date, _slot booking_slot,
  _customer_name text default null, _customer_phone text default null,
  _notes text default null, _reference text default null,
  _client_token uuid default null
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
     reference, created_by, client_token)
  values (_hall_id, _event_date, _end_date, _slot,
          nullif(btrim(_customer_name), ''), nullif(btrim(_customer_phone), ''),
          nullif(btrim(_notes), ''), nullif(btrim(_reference), ''), auth.uid(), _client_token)
  returning id into v_id;

  d := _event_date;
  while d <= _end_date loop
    -- NOTE IS NOT COPIED HERE ANY MORE. availability is world-readable, and
    -- "your reference" is a field an owner will eventually put a customer's name
    -- in. The public row needs only "this slot is taken"; the reference stays in
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

revoke all on function public.create_offline_booking(uuid, date, date, booking_slot, text, text, text, text, uuid) from public, anon;
grant execute on function public.create_offline_booking(uuid, date, date, booking_slot, text, text, text, text, uuid) to authenticated;
