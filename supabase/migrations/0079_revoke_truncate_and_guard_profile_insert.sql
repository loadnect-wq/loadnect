-- ─────────────────────────────────────────────────────────────────────────────
-- 0079_revoke_truncate_and_guard_profile_insert.sql
--
-- TWO HARDENING ITEMS. Read this line first, because the shape of both findings
-- resembles the support-ticket forgery 0076 fixed and they are NOT the same
-- severity: that one was exploitable and proven; NEITHER of these is reachable
-- today. Both were probed against production and both are closed by some other
-- layer. They are fixed because each costs one migration and each is one
-- careless future edit away from mattering. Nothing here is an incident.
--
-- ═══ 1. TRUNCATE IS NOT FILTERED BY RLS ═════════════════════════════════════
--
-- Migration 0046 knew this mattered — line 177 reads
--   revoke insert, update, delete, truncate on public.halls ... from anon, authenticated
-- for four tables. The other twenty-four kept Supabase's default grant set, and
-- POSTGRES DOES NOT EVALUATE ROW-LEVEL SECURITY FOR TRUNCATE AT ALL. It is
-- gated solely by the TRUNCATE table privilege. So on each of those tables the
-- admin-only policy is, for this one verb, decorative.
--
-- Measured before this migration: 24 of 36 tables in `public` granted TRUNCATE
-- to BOTH anon and authenticated, including admin_audit_log (the tamper-
-- evidence trail), commissions and payment_transactions (the money ledgers),
-- profiles (every account) and availability (the double-booking inventory).
-- TRUNCATE fires no row triggers, so the append-only audit guard would not even
-- record its own erasure.
--
-- WHY IT IS NOT REACHABLE TODAY, and this qualifier is load-bearing: PostgREST
-- emits only SELECT/INSERT/UPDATE/DELETE plus RPC, and no anon- or
-- authenticated-callable function in this schema runs dynamic SQL — all 28
-- SECURITY DEFINER bodies were read. There is no path from the internet to a
-- TRUNCATE statement. This is a latent privilege, not an open door. It is
-- revoked because the day some helper does interpolate SQL, this is the
-- difference between a bug and losing the ledger.
--
-- Done as a schema-wide sweep plus DEFAULT PRIVILEGES rather than a table list,
-- because a table list is precisely how four tables got fixed in 0046 and
-- twenty-four drifted.
--
-- ═══ 2. THE PROFILE GUARD ONLY COVERS UPDATE ════════════════════════════════
--
-- guard_profile_privileged_columns is what stops a client granting itself
-- phone verification — the flag that gates lead forwarding and owner contact
-- details. It is declared `before update` only (0066:49), so on INSERT those
-- columns are not guarded, and the column grant does let `authenticated` write
-- them.
--
-- NOT EXPLOITABLE. All three insert paths were probed against production as a
-- real customer, in a rolled-back transaction, and every one was refused by a
-- different layer:
--
--   new row, forged phone_verified   -> 42501, profiles_insert WITH CHECK
--                                       requires auth.uid() = id
--   own id, forged phone_verified    -> 23505, profiles_pkey; handle_new_user
--                                       already created the row at signup
--   PostgREST upsert (ON CONFLICT
--     DO UPDATE), forged flag        -> P0001, the EXISTING update guard fires
--                                       on the DO UPDATE branch
--
-- So this is defence in depth for one specific future: profiles_insert being
-- widened the way tickets_insert was widened. The guard is the layer that does
-- not depend on a policy staying correct.
--
-- WHY IT COULD NOT SIMPLY BE `before insert or update` ON THE OLD BODY: on
-- INSERT, OLD is NULL, so `new.is_active is distinct from old.is_active` is
-- `true is distinct from null` = TRUE, and every signup would be rejected.
-- Hence the explicit TG_OP branch.
--
-- SIGNUP IS UNAFFECTED, checked rather than assumed: handle_new_user is
-- SECURITY DEFINER owned by postgres, so inside it current_user is postgres,
-- is_trusted_backend() is true, and the guard returns NEW on its first branch.
-- The verify block at the bottom proves an honest insert still gets past the
-- guard rather than trusting that reasoning.
--
-- This function stays SECURITY INVOKER (the default). Not a style choice: in a
-- DEFINER function current_user becomes the owner, postgres, which
-- is_trusted_backend() trusts — so the guard would return NEW for every caller
-- and never fire once. That mistake was caught by 0076's own verify block.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. TRUNCATE ─────────────────────────────────────────────────────────────
revoke truncate on all tables in schema public from anon, authenticated;

-- So a table added tomorrow starts closed rather than inheriting the default.
alter default privileges in schema public revoke truncate on tables from anon, authenticated;

-- ── 2. profiles INSERT ──────────────────────────────────────────────────────
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return new;
  end if;

  -- INSERT: there is no OLD row to compare against, so the test is absolute.
  -- A client may create its own profile; it may not arrive pre-verified.
  if tg_op = 'INSERT' then
    if coalesce(new.phone_verified, false) then
      raise exception 'profiles: phone verification is granted by the OTP check, not by the client';
    end if;
    if new.phone_verified_at is not null then
      raise exception 'profiles: phone_verified_at is stamped by the OTP check, not by the client';
    end if;
    return new;
  end if;

  if new.is_active is distinct from old.is_active then
    raise exception 'profiles: account status is set by Hallnect, not by the account holder';
  end if;

  -- Asymmetric ON PURPOSE. Dropping your own verification is allowed, because
  -- changing your phone number must do exactly that and the profile forms rely
  -- on it. Granting it to yourself is the thing the OTP is for.
  if coalesce(new.phone_verified, false)
     and new.phone_verified is distinct from old.phone_verified then
    raise exception 'profiles: phone verification is granted by the OTP check, not by the client';
  end if;

  return new;
end;
$fn$;

-- Trigger bodies are not RPCs.
revoke all on function public.guard_profile_privileged_columns() from public, anon, authenticated;

drop trigger if exists trg_guard_profile_privileged_columns on public.profiles;
create trigger trg_guard_profile_privileged_columns
  before insert or update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();

-- ── Verify ──────────────────────────────────────────────────────────────────
-- No handler swallows an assertion: a verify block that catches its own raise
-- reports success either way.
do $mig$
declare
  t record;
  n int := 0;
  custX uuid;
begin
  -- (a) no client role may TRUNCATE anything in public, now or by default.
  for t in select tablename from pg_tables where schemaname = 'public' loop
    if has_table_privilege('anon', 'public.'||quote_ident(t.tablename), 'TRUNCATE')
       or has_table_privilege('authenticated', 'public.'||quote_ident(t.tablename), 'TRUNCATE') then
      raise exception 'TRUNCATE still granted to a client role on %', t.tablename;
    end if;
    n := n + 1;
  end loop;
  raise notice 'TRUNCATE revoked across % tables in public', n;

  -- (b) the ordinary verbs the app depends on must be untouched. A revoke that
  --     overshoots would break the app in a way no test here would notice.
  --
  --     halls IS CHECKED PER-COLUMN ON PURPOSE. 0046 revoked the blanket grant
  --     and re-granted SELECT column by column, so has_table_privilege('anon',
  --     'public.halls','SELECT') is FALSE on a perfectly healthy database --
  --     the first draft of this block asserted it and failed the migration.
  --     Table-level checks silently misread a column-granted schema, which is
  --     the same confusion behind the 42501s that hit admins in this project.
  if not has_table_privilege('authenticated', 'public.support_tickets', 'INSERT')
     or not has_table_privilege('authenticated', 'public.saved_halls', 'INSERT')
     or not has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     or not has_table_privilege('anon', 'public.amenities', 'SELECT')
     or not has_column_privilege('anon', 'public.halls', 'name', 'SELECT')
     or not has_column_privilege('anon', 'public.halls', 'price_per_day', 'SELECT') then
    raise exception 'the revoke was too broad - an ordinary grant was removed';
  end if;

  -- (c) the profile guard.
  --
  -- The probes below are meaningful because of the ORDER POSTGRES USES on
  -- INSERT: BEFORE ROW triggers run first, THEN the RLS WITH CHECK expression,
  -- then constraints. So the guard now gets the first word, and each assertion
  -- matches the guard's own message instead of accepting any error at all --
  -- otherwise RLS refusing the row would look identical to the guard working.
  select id into custX from public.profiles where role = 'customer' limit 1;
  if custX is null then
    raise notice 'no customer profile - skipping behavioural verify';
    return;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', custX)::text, true);

  begin
    insert into public.profiles (id, email, full_name, role, phone_verified)
    values (gen_random_uuid(), 'zz0079a@example.invalid', 'zz', 'customer', true);
    raise exception 'GUARD FAILED: a client inserted a pre-verified profile';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'GUARD FAILED%' then raise; end if;
    if sqlerrm not like '%phone verification is granted by the OTP check%' then
      raise exception 'GUARD FAILED: refused by % - not by the guard', sqlerrm;
    end if;
  end;

  begin
    insert into public.profiles (id, email, full_name, role, phone_verified_at)
    values (gen_random_uuid(), 'zz0079b@example.invalid', 'zz', 'customer', now());
    raise exception 'GUARD FAILED: a client stamped its own phone_verified_at';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'GUARD FAILED%' then raise; end if;
    if sqlerrm not like '%phone_verified_at is stamped by the OTP check%' then
      raise exception 'GUARD FAILED: refused by % - not by the guard', sqlerrm;
    end if;
  end;

  -- An HONEST insert must still get PAST the guard. It is then refused by
  -- profiles_insert (auth.uid() = id), and that 42501 is the proof we want:
  -- reaching RLS at all means the trigger returned NEW instead of raising, so
  -- the guard has not been made broad enough to break account creation.
  begin
    insert into public.profiles (id, email, full_name, role)
    values (gen_random_uuid(), 'zz0079c@example.invalid', 'zz', 'customer');
    raise exception 'GUARD FAILED: the probe row should not have survived RLS';
  exception
    when insufficient_privilege then
      null;  -- exactly as expected: the guard let it through, RLS stopped it
    when sqlstate 'P0001' then
      if sqlerrm like 'GUARD FAILED%' then raise; end if;
      raise exception 'GUARD TOO BROAD: an honest profile insert was refused - %', sqlerrm;
  end;

  reset role;
end
$mig$;
