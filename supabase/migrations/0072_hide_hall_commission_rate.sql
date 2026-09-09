-- ─────────────────────────────────────────────────────────────────────────────
-- 0072_hide_hall_commission_rate.sql
--
-- The per-hall commission is a commercial term between Hallnect and the venue
-- and must never reach the customer. This is migration 0032's argument applied
-- to the column 0071 just added, for exactly the same reason and by exactly the
-- same mechanism.
--
-- WHY IT IS NEEDED EVEN THOUGH NO PAGE RENDERS IT. RLS on halls is ROW-level
-- and deliberately generous: halls_select is
-- `status = 'approved' OR owns_owner_row(owner_id) OR is_admin()`, so every
-- approved hall is readable by anyone, signed in or not. That is correct — it
-- is how the public catalogue works — but it means row access is not a defence
-- for a single column. Anybody holding the public anon key could ask PostgREST
-- for `/rest/v1/halls?select=commission_rate&status=eq.approved` and read what
-- every venue in the country agreed to pay, without ever loading a page.
--
-- Column privileges are what actually hide a column, and a TABLE-wide
-- `grant select` covers every column including ones added later — so a
-- column-level REVOKE against it is a silent no-op. Verified before writing
-- this: has_column_privilege('anon','public.halls','commission_rate','SELECT')
-- returned TRUE the moment 0071 created the column. The blanket grant has to be
-- dropped and the permitted columns re-granted by name.
--
-- SAFE FOR THE APP, because no session-client query names this column. Every
-- read of it goes through lib/hall-commission.ts, which uses the service role:
-- the owner's own hall detail, the admin hall list, and the booking engine.
-- That was written that way first, precisely so this migration would be a
-- privilege change and not an outage. The public catalogue reads
-- (lib/halls.ts), the owner list (lib/owner.ts) and the admin list
-- (lib/admin.ts) all use explicit column lists that do not mention it.
--
-- FAIL-CLOSED, and that cuts both ways: a column added to halls LATER is not
-- readable by clients until it is granted. For a table carrying money that is
-- the right default, but it is a real cost — a future column will appear to
-- "not exist" (42703) until someone remembers this file. 0032 accepted the same
-- trade for bookings.
--
-- ROLLBACK: grant select on public.halls to authenticated, anon;
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  cols text;
  hidden text[] := array['commission_rate'];
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'halls'
    and column_name <> all (hidden);

  execute 'revoke select on public.halls from authenticated, anon';
  execute format('grant select (%s) on public.halls to authenticated', cols);
  execute format('grant select (%s) on public.halls to anon', cols);
end $$;

-- The trusted backend keeps full column access; lib/hall-commission.ts depends
-- on exactly this.
grant select on public.halls to service_role;

-- Writes were already impossible: 0046's column-scoped UPDATE grant omits this
-- column (an owner changes it through an audited server action, not a PATCH).
-- Stated explicitly at the privilege layer so a future table-wide re-grant
-- cannot quietly reopen it.
revoke update (commission_rate) on public.halls from authenticated, anon;

do $$
begin
  if has_column_privilege('anon', 'public.halls', 'commission_rate', 'SELECT') then
    raise exception 'anon can still read halls.commission_rate';
  end if;
  if has_column_privilege('authenticated', 'public.halls', 'commission_rate', 'SELECT') then
    raise exception 'authenticated can still read halls.commission_rate';
  end if;
  if not has_column_privilege('service_role', 'public.halls', 'commission_rate', 'SELECT') then
    raise exception 'service_role lost read access - lib/hall-commission.ts needs it';
  end if;

  -- The catalogue must still work. These are the columns the public pages and
  -- the owner/admin lists actually name; if any of them lost its grant the site
  -- would 42703 on the homepage.
  if not has_column_privilege('anon', 'public.halls', 'name', 'SELECT')
     or not has_column_privilege('anon', 'public.halls', 'slug', 'SELECT')
     or not has_column_privilege('anon', 'public.halls', 'price_per_day', 'SELECT')
     or not has_column_privilege('anon', 'public.halls', 'status', 'SELECT') then
    raise exception 'the public catalogue lost a column it needs';
  end if;
end $$;
