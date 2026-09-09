-- ─────────────────────────────────────────────────────────────────────────────
-- 0071_hall_commission_rate.sql
--
-- Each hall carries the commission percentage its owner agreed to give
-- Hallnect. Until now there was ONE platform-wide rate in
-- platform_settings.commission_percent (live value 1.50), applied to every
-- booking of every hall.
--
-- WHAT THIS DOES NOT CHANGE, and the reason this migration is small:
-- bookings.commission_rate and bookings.commission_amount ALREADY EXIST and are
-- already snapshotted at booking creation (see app/book/[slug]/actions.ts and
-- lib/booking-payment.ts). Historical protection is therefore not being built
-- here — it is already in place. This changes only the SOURCE the snapshot is
-- taken from: the hall's own rate instead of the platform default.
--
-- NULLABLE ON PURPOSE. A hall with no rate reads as "commission not configured"
-- rather than being silently assigned one, which would be inventing a
-- commercial term on an owner's behalf. The application requires the field when
-- a hall is created; the database permits its absence so that a legacy row, a
-- restored backup, or an admin-side insert degrades to a visible, fixable state
-- instead of a rejected write. (There are zero halls today, so NOT NULL was
-- available — it is declined for those three cases, not out of caution about
-- current data.)
--
-- THE CHECK IS THE REAL CONTROL, not the form. Migration 0046 left
-- `grant insert on public.halls to authenticated` at the TABLE level, so this
-- new column is insertable by any owner the moment it exists, including through
-- a hand-written PostgREST call that never touches the React form. The eight
-- permitted values are therefore enforced here, in the database, where a
-- crafted request meets them too.
--
-- UPDATE IS DELIBERATELY NOT GRANTED. 0046 replaced the table-wide UPDATE with
-- a named column list — "Money, placement, rating, moderation and ownership are
-- absent by design" — and a column added later is NOT covered by that list. So
-- an owner cannot PATCH this value directly, and every change has to go through
-- the server action that checks ownership and writes an audit row. That is the
-- intent; do not "fix" it by adding commission_rate to the 0046 grant.
--
-- WHY THESE EIGHT VALUES AND NO OTHERS: they are the rates the business offers.
-- A free-text percentage would also have to be bounded against the advance —
-- the commission is charged on the FULL hall price but retained out of the 25%
-- advance, so the two can cross (see checkCommissionAgainstAdvance and
-- MAX_COMMISSION_SHARE_OF_ADVANCE = 0.5 in lib/validation/schemas.ts). At the
-- live 25% advance the ceiling is 12.5%, so all eight values clear it with room
-- to spare. They stop clearing it if the advance is ever lowered below 10%,
-- which is why the admin advance setting now validates against the highest rate
-- actually in use rather than only the platform default.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.halls
  add column if not exists commission_rate numeric(4,2);

comment on column public.halls.commission_rate is
  'Commission percent this hall gives Hallnect. One of 1.5/2/2.5/3/3.5/4/4.5/5, '
  'or NULL meaning not configured. Snapshotted onto bookings.commission_rate at '
  'booking creation; never read retroactively for an existing booking.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.halls'::regclass
      and conname  = 'halls_commission_rate_allowed'
  ) then
    alter table public.halls
      add constraint halls_commission_rate_allowed
      check (
        commission_rate is null
        or commission_rate in (1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5)
      );
  end if;
end $$;

-- Admin needs to find the halls that have no rate. Partial, because that set is
-- expected to be small and shrinking — the index exists to answer "which halls
-- still need configuring", not to scan the catalogue.
create index if not exists halls_commission_rate_unset
  on public.halls (created_at desc)
  where commission_rate is null;

-- ── Verify, rather than assume ───────────────────────────────────────────────
-- Each of these has been wrong before in this project: a CHECK that was never
-- added because the DO block swallowed the error, and a column grant that was
-- assumed rather than read.
do $$
declare
  def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'halls'
      and column_name = 'commission_rate'
  ) then
    raise exception 'halls.commission_rate was not created';
  end if;

  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'public.halls'::regclass
     and conname  = 'halls_commission_rate_allowed';

  if def is null then
    raise exception 'halls_commission_rate_allowed constraint is missing';
  end if;

  -- The bound read back from the constraint rather than probed with a test
  -- INSERT. An earlier draft did probe, inside a BEGIN/EXCEPTION with a
  -- `when others then null` that would have caught its own "the CHECK did not
  -- reject" raise and passed silently -- the fail-open shape this project keeps
  -- finding. Not worth reintroducing to test something Postgres enforces anyway.
  if def not like '%1.5%' or def not like '%4.5%' or def like '%2.25%' then
    raise exception 'halls_commission_rate_allowed is not the expected value set: %', def;
  end if;

  -- An owner must NOT be able to UPDATE this column through the session client.
  -- Verified true on apply: has_column_privilege returned false.
  if has_column_privilege('authenticated', 'public.halls', 'commission_rate', 'UPDATE') then
    raise exception
      'authenticated can UPDATE halls.commission_rate - 0046 kept money columns out of that grant on purpose';
  end if;
end $$;
