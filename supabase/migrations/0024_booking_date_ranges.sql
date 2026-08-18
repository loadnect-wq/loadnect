-- ─────────────────────────────────────────────────────────────────────────────
-- 0024_booking_date_ranges.sql
-- Multi-day bookings: customer selects a start + end date, max 4 days.
--
-- DESIGN — extend, don't replace:
--   • bookings.event_date becomes the range START. Existing single-day rows are
--     preserved untouched as 1-day ranges (end_date backfilled = event_date);
--     nothing is fabricated (spec §32).
--   • MULTI-DAY BOOKINGS ARE FULL-DAY ONLY (enforced by CHECK). Morning/evening
--     slots remain for single-day bookings. A 3-day wedding does not book
--     "mornings only", and this keeps the slot model coherent.
--   • number_of_days is a GENERATED column — it can never disagree with the
--     dates, and clients cannot supply it.
--
-- CONCURRENCY (spec §22) — why an exclusion constraint is REQUIRED:
--   The existing backstop, uq_booking_active_slot, is a unique index on
--   (hall_id, event_date, slot): it only stops two bookings with the IDENTICAL
--   start date. Two overlapping RANGES (15–17 vs 16–18) have different start
--   dates, and the BEFORE-trigger check cannot see the other transaction's
--   uncommitted row — so both would commit. The GiST exclusion constraint makes
--   Postgres itself reject the second overlapping active full-day range with
--   error 23P01, closing the race at the database layer.
--   (Half-day vs full-day same-day races keep today's trigger-level protection —
--   unchanged risk profile for the pre-existing single-day model.)
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists btree_gist;

-- ── 1. Range columns ─────────────────────────────────────────────────────────
alter table public.bookings
  add column if not exists end_date date;

update public.bookings set end_date = event_date where end_date is null;

alter table public.bookings alter column end_date set not null;

-- Generated day count: inclusive (15th→18th = 4 days). Clients can't supply it.
alter table public.bookings
  add column if not exists number_of_days integer
    generated always as (end_date - event_date + 1) stored;

-- ── 2. Integrity checks ──────────────────────────────────────────────────────
do $$ begin
  alter table public.bookings
    add constraint booking_range_valid check (end_date >= event_date);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.bookings
    add constraint booking_range_max_4_days check (end_date - event_date <= 3);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.bookings
    add constraint booking_multiday_is_full_day
      check (end_date = event_date or slot = 'full_day');
exception when duplicate_object then null; end $$;

-- ── 3. Race-proof range overlap (active full-day bookings) ───────────────────
do $$ begin
  alter table public.bookings
    add constraint bookings_no_overlapping_ranges
      exclude using gist (
        hall_id with =,
        daterange(event_date, end_date, '[]') with &&
      )
      where (
        status in ('payment_success', 'booking_requested', 'owner_confirmed', 'completed')
        and slot = 'full_day'
      );
exception when duplicate_object then null; end $$;

-- ── 4. Range-aware overlap trigger (replaces single-date version from 0006) ──
create or replace function public.prevent_overlapping_booking()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status in ('payment_success','booking_requested','owner_confirmed','completed') then
    if exists (
      select 1 from public.bookings b
      where b.hall_id = new.hall_id
        and b.id     <> new.id
        and b.status in ('payment_success','booking_requested','owner_confirmed','completed')
        -- date-RANGE overlap, not just same start date
        and daterange(b.event_date, b.end_date, '[]')
            && daterange(new.event_date, new.end_date, '[]')
        and (new.slot = 'full_day' or b.slot = 'full_day' or b.slot = new.slot)
    ) then
      raise exception 'This hall is already booked for one or more of the selected dates';
    end if;
  end if;
  return new;
end;
$$;

-- ── 5. Lock end_date against tampering (extends 0009's immutable-field list) ──
create or replace function public.validate_booking_transition()
returns trigger
language plpgsql set search_path = public
as $$
declare
  is_owner    boolean := public.owns_hall(new.hall_id);
  is_customer boolean := (new.customer_id = auth.uid());
  trusted     boolean := public.is_trusted_backend() or public.is_admin();
begin
  if trusted then
    return new;
  end if;

  -- Financial + identity + DATE-RANGE fields are immutable for customer/owner.
  if new.customer_id  is distinct from old.customer_id
     or new.hall_id   is distinct from old.hall_id
     or new.event_date is distinct from old.event_date
     or new.end_date   is distinct from old.end_date
     or new.base_amount   is distinct from old.base_amount
     or new.platform_fee  is distinct from old.platform_fee
     or new.total_amount  is distinct from old.total_amount then
    raise exception 'Booking financial and identity fields are immutable';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if is_customer and not is_owner then
    if not (
      (old.status = 'pending_payment'    and new.status = 'cancelled')
      or (old.status = 'payment_success' and new.status = 'cancelled')
      or (old.status = 'booking_requested' and new.status = 'cancelled')
      or (old.status = 'owner_confirmed' and new.status = 'cancelled')
    ) then
      raise exception
        'Customer cannot transition booking from % to %', old.status, new.status;
    end if;
    return new;
  end if;

  if is_owner then
    if not (
      (old.status = 'booking_requested' and new.status = 'owner_confirmed')
      or (old.status = 'booking_requested' and new.status = 'owner_rejected')
      or (old.status = 'owner_confirmed'  and new.status = 'completed')
    ) then
      raise exception
        'Owner cannot transition booking from % to %', old.status, new.status;
    end if;
    return new;
  end if;

  raise exception 'Not allowed: only customer, owner, or admin may transition this booking';
end;
$$;

create index if not exists idx_bookings_end_date on public.bookings (end_date);
