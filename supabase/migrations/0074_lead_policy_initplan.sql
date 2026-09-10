-- ─────────────────────────────────────────────────────────────────────────────
-- 0074_lead_policy_initplan.sql
--
-- Two defects in migration 0073, both found by Supabase's performance advisor
-- rather than by me, and both cheap to fix before there is any data to slow
-- down.
--
-- 1. A DUPLICATE INDEX. 0073 added idx_commissions_hall_owner on
--    commissions(hall_owner_id). commissions already carried
--    idx_commissions_owner on the same column, from an earlier migration —
--    I did not check before adding one. Two identical indexes cost double on
--    every insert and update of a financial row and buy nothing. The OLDER one
--    is kept, because it is the one existing query plans were built against.
--
-- 2. auth.uid() RE-EVALUATED PER ROW. Written as
--        customer_id = auth.uid()
--    Postgres treats the call as volatile-per-row and executes it for every
--    row scanned. Wrapping it in a scalar subquery — `(select auth.uid())` —
--    lets the planner hoist it into an InitPlan and run it ONCE. Same for
--    is_admin(), which is `stable` and depends on nothing in the row.
--
--    This is a pure planner change: the VALUE each expression returns is
--    identical, so the set of rows a caller may see does not move. That claim
--    is not taken on trust — the authorization suite is re-run against this
--    policy after it is applied.
--
--    owns_hall(hall_id) is deliberately NOT wrapped: it takes a column from
--    the row, so it genuinely has to run per row and a subquery would change
--    its meaning rather than its cost.
--
-- SCOPE. Only the two policies migration 0073 authored or rewrote. The advisor
-- reports the same initplan pattern on 20 other policies written earlier; those
-- are a separate, wider change and are deliberately left alone here — mixing
-- them in would mean re-verifying every table's authorization in one migration.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Drop the index I duplicated ──────────────────────────────────────────
do $mig$
begin
  -- Only drop mine, and only if the older one really is still there. If the
  -- pre-existing index were ever removed this would otherwise leave the column
  -- unindexed, which is worse than the duplication it fixes.
  if exists (select 1 from pg_class where relname = 'idx_commissions_owner')
     and exists (select 1 from pg_class where relname = 'idx_commissions_hall_owner') then
    drop index if exists public.idx_commissions_hall_owner;
  end if;
end
$mig$;

-- ── 2. Hoist the session lookups out of the row loop ────────────────────────
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select using (
    (select public.is_admin())
    or customer_id = (select auth.uid())
    -- Per-row by necessity: it reads this row's hall_id.
    or (public.owns_hall(hall_id) and phone_verified)
  );

drop policy if exists commissions_select on public.commissions;
create policy commissions_select on public.commissions
  for select using (
    (select public.is_admin())
    or exists (
      select 1 from public.bookings b
      where b.id = commissions.booking_id and public.owns_hall(b.hall_id)
    )
    or exists (
      select 1 from public.leads l
      where l.id = commissions.lead_id and public.owns_hall(l.hall_id)
    )
  );

-- ── 3. Verify ───────────────────────────────────────────────────────────────
do $mig$
declare
  n int;
begin
  select count(*) into n from pg_class
   where relname in ('idx_commissions_owner', 'idx_commissions_hall_owner');
  if n <> 1 then
    raise exception 'expected exactly one hall_owner_id index on commissions, found %', n;
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'leads' and policyname = 'leads_select') then
    raise exception 'leads_select is missing - the table would be unreadable';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'commissions' and policyname = 'commissions_select') then
    raise exception 'commissions_select is missing - owners would lose their statement';
  end if;

  -- The write path must stay shut. 0073 granted clients no INSERT/UPDATE on
  -- leads, and a policy rewrite must not have quietly re-opened it.
  if has_table_privilege('authenticated', 'public.leads', 'INSERT')
     or has_table_privilege('authenticated', 'public.leads', 'UPDATE') then
    raise exception 'authenticated can write public.leads';
  end if;
end
$mig$;
