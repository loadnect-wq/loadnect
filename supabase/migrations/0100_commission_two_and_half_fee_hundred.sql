-- ─────────────────────────────────────────────────────────────────────────────
-- 0100_commission_two_and_half_fee_hundred.sql — business change, 2026-09-17:
--
--   1. The standard Hallnect commission is 2.5% (was 2%, set by 0097).
--   2. The commission rate is not disclosed publicly: nothing callable without
--      the service role returns it.
--   3. The customer platform fee is ₹100 (was ₹200), before 18% GST.
--
-- Mirrors lib/commission.ts STANDARD_COMMISSION_PERCENT = 2.5 and
-- lib/booking-payment.ts PLATFORM_FEE_RUPEES = 100. The application and this
-- migration must ship together: the database refuses a booking or lead
-- commission at any other rate, and would refuse a ₹100 fee without the fee
-- floor change below.
--
-- HISTORY. Snapshots on bookings / commissions are never rewritten, and both
-- enforcement triggers are BEFORE INSERT only. Live when written: 0 bookings,
-- 0 leads, 0 commissions, 1 hall (rate 2.00), 1 coupon.
--
-- ROLLBACK (with the app constants reverted to 2 and 200):
--   create or replace function public.standard_commission_percent() ... select 2::numeric
--   re-add both CHECKs at 2, set halls/platform_settings back to 2,
--   replace 'least(100::numeric' with 'least(200::numeric' in
--   guard_booking_coupon_integrity(), and grant execute on the three
--   commission functions back to anon, authenticated.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The rate ─────────────────────────────────────────────────────────────
create or replace function public.standard_commission_percent()
returns numeric
language sql
immutable
set search_path to 'public'
as $$ select 2.5::numeric $$;

comment on function public.standard_commission_percent() is
  'The standard Hallnect commission percent (2.5). Mirrors lib/commission.ts '
  'STANDARD_COMMISSION_PERCENT; enforced on new bookings and lead commissions. '
  'Not callable by anon or authenticated (0100).';

-- standard_commission_amount() reads the percent above; floor to the paisa is
-- unchanged: floor(round(amount × 100) × 2.5 / 100) / 100.

alter table public.halls drop constraint if exists halls_commission_rate_standard;
update public.halls set commission_rate = 2.5
 where commission_rate is not null and commission_rate is distinct from 2.5;
alter table public.halls alter column commission_rate set default 2.5;
alter table public.halls
  add constraint halls_commission_rate_standard
  check (commission_rate is null or commission_rate = 2.5);

comment on column public.halls.commission_rate is
  'Recorded standard Hallnect commission (2.5). Not chosen by anyone and not read '
  'to price bookings — lib/commission.ts is the source of truth.';

alter table public.platform_settings drop constraint if exists platform_settings_commission_percent_standard;
update public.platform_settings set commission_percent = 2.5
 where commission_percent is distinct from 2.5;
alter table public.platform_settings alter column commission_percent set default 2.5;
alter table public.platform_settings
  add constraint platform_settings_commission_percent_standard
  check (commission_percent = 2.5);

-- ── 2. Not disclosed through the API ────────────────────────────────────────
-- get_commission_percent() was SECURITY DEFINER and executable by anon, so
-- anyone could read the rate at /rest/v1/rpc/get_commission_percent; the two
-- standard_* functions were likewise callable. No application code calls any
-- of them (the rate lives in lib/commission.ts, read server-side), so they are
-- closed to the API roles. service_role and the owner keep EXECUTE.
revoke execute on function public.get_commission_percent()                from public, anon, authenticated;
revoke execute on function public.standard_commission_percent()           from public, anon, authenticated;
revoke execute on function public.standard_commission_amount(numeric)     from public, anon, authenticated;

-- The enforcement triggers call those functions. They are SECURITY INVOKER, so
-- after the revoke a session-client write (e.g. an admin inserting a commission
-- row through RLS commissions_admin_write) would hit 42501 — the 0096 / 0099
-- class of bug. They run as their owner instead; who may write is still RLS's
-- decision, and their own EXECUTE stays revoked (0097).
alter function public.enforce_standard_booking_commission() security definer;
alter function public.enforce_standard_lead_commission()    security definer;

-- ── 3. Platform fee ₹100 ────────────────────────────────────────────────────
-- guard_booking_coupon_integrity() refuses a coupon-less booking whose fee is
-- below least(<standard fee>, 25% of the advance). Patched textually so the
-- live body is otherwise kept exactly.
do $fee$
declare
  def text := pg_get_functiondef('public.guard_booking_coupon_integrity()'::regprocedure);
begin
  if position('least(200::numeric' in def) = 0 then
    raise exception '0100: fee floor literal not found in guard_booking_coupon_integrity()';
  end if;
  execute replace(def, 'least(200::numeric', 'least(100::numeric');
end
$fee$;

notify pgrst, 'reload schema';

-- ── Verify ──────────────────────────────────────────────────────────────────
do $verify$
declare
  def text := pg_get_functiondef('public.guard_booking_coupon_integrity()'::regprocedure);
  fn  text;
begin
  if public.standard_commission_percent() <> 2.5 then raise exception '0100: percent is not 2.5'; end if;
  if public.standard_commission_amount(10000)    <> 250    then raise exception '0100: 10,000 -> 250 failed'; end if;
  if public.standard_commission_amount(50000)    <> 1250   then raise exception '0100: 50,000 -> 1,250 failed'; end if;
  if public.standard_commission_amount(100000)   <> 2500   then raise exception '0100: 1,00,000 -> 2,500 failed'; end if;
  if public.standard_commission_amount(12345.67) <> 308.64 then raise exception '0100: non-round amount failed'; end if;
  if public.get_commission_percent() <> 2.5 then raise exception '0100: get_commission_percent() is not 2.5'; end if;

  if exists (select 1 from public.halls where commission_rate is not null and commission_rate <> 2.5) then
    raise exception '0100: a hall carries a non-standard rate';
  end if;

  foreach fn in array array['public.get_commission_percent()',
                            'public.standard_commission_percent()',
                            'public.standard_commission_amount(numeric)'] loop
    if has_function_privilege('anon', fn, 'execute')
       or has_function_privilege('authenticated', fn, 'execute') then
      raise exception '0100: % is still callable by an API role', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception '0100: % lost service_role EXECUTE', fn;
    end if;
  end loop;

  if not (select prosecdef from pg_proc where oid = 'public.enforce_standard_booking_commission()'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.enforce_standard_lead_commission()'::regprocedure) then
    raise exception '0100: commission enforcement triggers are not SECURITY DEFINER';
  end if;

  if position('least(100::numeric' in def) = 0 or position('least(200::numeric' in def) > 0 then
    raise exception '0100: fee floor was not moved to 100';
  end if;
end
$verify$;
