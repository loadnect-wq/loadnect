-- ─────────────────────────────────────────────────────────────────────────────
-- 0097_standard_commission_two_percent.sql — ONE standard Hallnect commission:
-- 2% of the booking amount, on every applicable booking.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT IT REPLACES
-- ════════════════════════════════════════════════════════════════════════════
--   • halls.commission_rate — chosen per hall by the OWNER from eight values
--     (1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5), CHECK halls_commission_rate_allowed.
--   • platform_settings.commission_percent — an ADMIN-editable default (live
--     value 1.50, column default 2.5), used when a hall had no rate.
-- The application no longer reads either to price anything: bookings and lead
-- commissions apply lib/commission.ts STANDARD_COMMISSION_PERCENT directly, and
-- the owner selector, the admin form and their server actions are removed.
--
-- ════════════════════════════════════════════════════════════════════════════
-- NON-DESTRUCTIVE, AND WHY
-- ════════════════════════════════════════════════════════════════════════════
-- No column is dropped and no historical row is rewritten.
--   • bookings.commission_rate / commission_amount and the commissions ledger
--     are SNAPSHOTS of what each booking was actually charged. They keep their
--     values and their existing 0–100 CHECKs; a past booking at another rate
--     stays exactly as it was charged. Checked before applying: 0 bookings,
--     0 commissions, 0 leads, 0 payments exist, so nothing is at stake today —
--     but the rules below are written so they would also be safe with history.
--   • halls.commission_rate is kept (claim_admin_hall_draft and older readers
--     know the column) but can now only hold the standard rate. Live data: one
--     hall, already at 2.00.
--   • platform_settings.commission_percent is kept for get_commission_percent()
--     and the settings audit trail, set to 2 and constrained to it.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ENFORCED IN THE DATABASE, NOT ONLY IN THE APP
-- ════════════════════════════════════════════════════════════════════════════
-- The server already computes the commission; the browser never sends one.
-- These are the second layer, for any writer that does not go through
-- lib/booking-payment.ts or lib/leads.ts:
--   1. A NEW booking must carry commission_rate = 2 and
--      commission_amount = floor(total_amount × 2%) to the paisa.
--      INSERT only — later updates (refund adjustments, status changes) and
--      every existing row are untouched.
--   2. A NEW lead commission (commissions.lead_id set) must carry rate 2 and
--      amount = floor(booking_amount × 2%). Booking-sourced ledger rows copy the
--      booking's own snapshot, which rule 1 already guarantees.
--   3. halls.commission_rate may only be the standard rate (default 2). This
--      also closes the one client write path: 0046 leaves INSERT on halls
--      table-wide for `authenticated`, so a crafted insert could previously
--      store any of the eight old rates.
--   4. platform_settings.commission_percent may only be 2.
--
-- ROLLBACK (only if the business rule changes again):
--   drop trigger if exists trg_enforce_standard_booking_commission on public.bookings;
--   drop trigger if exists trg_enforce_standard_lead_commission on public.commissions;
--   drop function if exists public.enforce_standard_booking_commission();
--   drop function if exists public.enforce_standard_lead_commission();
--   alter table public.halls drop constraint if exists halls_commission_rate_standard;
--   alter table public.platform_settings drop constraint if exists platform_settings_commission_percent_standard;
-- ─────────────────────────────────────────────────────────────────────────────

-- ── The rate, once ───────────────────────────────────────────────────────────
create or replace function public.standard_commission_percent()
returns numeric
language sql
immutable
set search_path to 'public'
as $$ select 2::numeric $$;

comment on function public.standard_commission_percent() is
  'The standard Hallnect commission percent (2). Mirrors lib/commission.ts '
  'STANDARD_COMMISSION_PERCENT; the database enforces it on new bookings and '
  'lead commissions.';

-- floor(amount × 2%) to the paisa — the same arithmetic as commissionPaiseOn.
create or replace function public.standard_commission_amount(_amount numeric)
returns numeric
language sql
immutable
set search_path to 'public'
as $$
  select floor(round(_amount * 100) * public.standard_commission_percent() / 100) / 100
$$;

-- ── 3. halls.commission_rate: the standard rate only ────────────────────────
update public.halls set commission_rate = 2
 where commission_rate is distinct from 2;   -- live: 0 rows (the one hall is 2.00)

alter table public.halls alter column commission_rate set default 2;

alter table public.halls drop constraint if exists halls_commission_rate_allowed;
alter table public.halls drop constraint if exists halls_commission_rate_standard;
alter table public.halls
  add constraint halls_commission_rate_standard
  check (commission_rate is null or commission_rate = 2);

comment on column public.halls.commission_rate is
  'Recorded standard Hallnect commission (2). Not chosen by anyone and not read '
  'to price bookings — lib/commission.ts is the source of truth.';

-- ── 4. platform_settings.commission_percent: the standard rate only ─────────
update public.platform_settings set commission_percent = 2
 where commission_percent is distinct from 2;   -- live: 1.50 -> 2

alter table public.platform_settings alter column commission_percent set default 2;

alter table public.platform_settings drop constraint if exists platform_settings_commission_percent_standard;
alter table public.platform_settings
  add constraint platform_settings_commission_percent_standard
  check (commission_percent = 2);

-- The public RPC keeps its signature; its fallback now matches the standard.
create or replace function public.get_commission_percent()
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select commission_percent from public.platform_settings where id = true),
    public.standard_commission_percent()
  );
$function$;

-- ── 1. New bookings carry exactly the standard commission ───────────────────
create or replace function public.enforce_standard_booking_commission()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- A row written without the breakdown columns (the pre-0031 fallback ladder
  -- in the booking action) carries no commission to check.
  if new.commission_rate is null and new.commission_amount is null then
    return new;
  end if;

  if new.commission_rate is distinct from public.standard_commission_percent() then
    raise exception 'Booking commission must be the standard % percent (got %)',
      public.standard_commission_percent(), new.commission_rate
      using errcode = 'check_violation';
  end if;

  if new.commission_amount is distinct from public.standard_commission_amount(new.total_amount) then
    raise exception 'Booking commission amount % does not equal % percent of %',
      new.commission_amount, public.standard_commission_percent(), new.total_amount
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_standard_booking_commission on public.bookings;
create trigger trg_enforce_standard_booking_commission
  before insert on public.bookings
  for each row execute function public.enforce_standard_booking_commission();

-- ── 2. New lead commissions carry exactly the standard commission ───────────
create or replace function public.enforce_standard_lead_commission()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.lead_id is null then
    -- Booking-sourced ledger row: it copies the booking's own snapshot, which
    -- the booking trigger above already constrained at creation.
    return new;
  end if;

  if new.commission_rate is distinct from public.standard_commission_percent() then
    raise exception 'Lead commission must be the standard % percent (got %)',
      public.standard_commission_percent(), new.commission_rate
      using errcode = 'check_violation';
  end if;

  if new.commission_amount is distinct from public.standard_commission_amount(new.booking_amount) then
    raise exception 'Lead commission amount % does not equal % percent of %',
      new.commission_amount, public.standard_commission_percent(), new.booking_amount
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_standard_lead_commission on public.commissions;
create trigger trg_enforce_standard_lead_commission
  before insert on public.commissions
  for each row execute function public.enforce_standard_lead_commission();

-- Trigger functions are not API (same treatment as 0092). EXECUTE is not
-- checked when a trigger fires, so this changes nothing about enforcement.
revoke all on function public.enforce_standard_booking_commission() from public, anon, authenticated;
revoke all on function public.enforce_standard_lead_commission() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ── Self-verification ───────────────────────────────────────────────────────
do $verify$
begin
  if public.standard_commission_amount(10000)   <> 200   then raise exception '0097: 10,000 -> 200 failed'; end if;
  if public.standard_commission_amount(25000)   <> 500   then raise exception '0097: 25,000 -> 500 failed'; end if;
  if public.standard_commission_amount(50000)   <> 1000  then raise exception '0097: 50,000 -> 1,000 failed'; end if;
  if public.standard_commission_amount(100000)  <> 2000  then raise exception '0097: 1,00,000 -> 2,000 failed'; end if;
  -- 12,345.67 × 2% = 246.9134 -> floored to the paisa: 246.91
  if public.standard_commission_amount(12345.67) <> 246.91 then raise exception '0097: non-round amount failed'; end if;

  if exists (select 1 from public.halls where commission_rate is distinct from 2 and commission_rate is not null) then
    raise exception '0097: a hall still carries a non-standard rate';
  end if;
  if (select commission_percent from public.platform_settings where id = true) <> 2 then
    raise exception '0097: platform commission is not the standard rate';
  end if;
  if public.get_commission_percent() <> 2 then
    raise exception '0097: get_commission_percent() does not return 2';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_enforce_standard_booking_commission'
                  and tgrelid = 'public.bookings'::regclass) then
    raise exception '0097: booking commission trigger missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_enforce_standard_lead_commission'
                  and tgrelid = 'public.commissions'::regclass) then
    raise exception '0097: lead commission trigger missing';
  end if;
end
$verify$;
