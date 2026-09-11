-- ─────────────────────────────────────────────────────────────────────────────
-- 0081_suspended_accounts_cannot_write.sql
--
-- SUSPENDING AN ACCOUNT DID NOT STOP IT WRITING. profiles.is_active was
-- enforced in exactly one place — requireAuth() in lib/auth.ts, which PAGES and
-- LAYOUTS call. Of the eighty server actions, only the forty in
-- app/admin/actions.ts re-read it (requireAdminActor). Every other action
-- authenticates with supabase.auth.getUser() alone, and NO RLS POLICY MENTIONED
-- is_active AT ALL. The application's own source says so, at
-- app/admin/actions.ts:409-421.
--
-- The compensating control was a GoTrue ban, and the developer comment beside
-- it is already honest about the limit: a ban stops sign-in and token refresh,
-- it does not invalidate an access token already in someone's hands. That token
-- stays valid until it expires — an hour on Supabase's default.
--
-- So for up to an hour after suspension, a suspended customer or owner could
-- still cancel bookings, post reviews, edit their profile and phone, create and
-- edit halls, accept or reject bookings, open tickets, spend MSG91 quota on OTP
-- SMS and start Cashfree checkouts. Deleting their auth.sessions rows does NOT
-- fix this: PostgREST validates the JWT signature and expiry locally and never
-- asks GoTrue whether the session still exists — which is also why they could
-- skip the app entirely and write straight to PostgREST with the anon key.
--
-- That last part is what decides where the fix belongs. An app-layer
-- requireActiveUser() helper would be eighty edits and would still leave the
-- direct-PostgREST path wide open. ONE RULE IN THE DATABASE CLOSES BOTH, and it
-- closes them for every action written from here on without anyone having to
-- remember.
--
-- ── WHY RESTRICTIVE POLICIES ────────────────────────────────────────────────
-- Postgres ORs permissive policies together and ANDs restrictive ones over the
-- top. So a restrictive policy adds "and the account is active" to whatever
-- each table already decided, WITHOUT reproducing a single existing policy
-- body. Rewriting eleven policy expressions by hand to append one clause is how
-- a subtle authorisation regression gets shipped; this cannot change who is
-- allowed to do what, only add a condition on top.
--
-- WRITES ONLY — no restrictive policy on SELECT. A suspended user reading their
-- own booking history is not a security problem, and blocking reads would break
-- the suspended-account screens and every support conversation that starts with
-- "what did I have booked". The harm was always the writing.
--
-- THE SERVICE ROLE IS UNAFFECTED, which is required rather than incidental:
-- it bypasses RLS entirely, so cron expiry, webhook settlement, payouts and
-- account deletion keep working on a suspended user's rows — several of them
-- exist precisely to clean up after a suspension.
--
-- ── is_active_user() ────────────────────────────────────────────────────────
-- Phrased as "no profile row says I am inactive", NOT "a profile row says I am
-- active". The difference matters at the edges: anon has no profile and must
-- stay unaffected, and a signed-in user whose profile row is missing must not
-- be locked out of the app by this migration. Only an explicit is_active=false
-- blocks, which is the only case this is about.
--
-- SECURITY DEFINER like its sibling is_admin(), and for a specific reason: it
-- reads public.profiles from inside a policy, and as INVOKER that read would
-- re-enter profiles' own RLS. Definer steps out of that loop. It exposes
-- nothing — a boolean about the caller, to the caller.
--
-- NO LIVE IMPACT TODAY: all ten profiles are is_active = true, so nothing that
-- works now stops working. This lands before the first suspension.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select not exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_active = false
  );
$function$;

comment on function public.is_active_user() is
  'False only when the caller has a profile row with is_active = false. Anon '
  'and unknown users are unaffected. Used by the restrictive write policies '
  'added in 0081 so a suspended account cannot write with a token issued '
  'before the suspension.';

-- ── The restrictive write rule, one per table that a client can write ───────
do $mig$
declare
  t text;
  tables text[] := array[
    'bookings', 'halls', 'hall_owners', 'profiles',
    'reviews', 'saved_halls', 'support_tickets'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', t || '_active_writer', t);
    -- Three separate policies rather than FOR ALL, so SELECT is untouched.
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated '
      'with check (public.is_active_user())', t || '_active_writer_ins', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated '
      'using (public.is_active_user()) with check (public.is_active_user())',
      t || '_active_writer_upd', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated '
      'using (public.is_active_user())', t || '_active_writer_del', t);
  end loop;
end
$mig$;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Behavioural, against a real profile, and the row is put back. No handler
-- swallows an assertion.
do $mig$
declare
  victim uuid;
  original boolean;
  saved uuid;
  outcome text;
begin
  -- (a) the policies exist and are restrictive.
  if (select count(*) from pg_policies
       where schemaname='public' and policyname like '%\_active\_writer\_%') <> 21 then
    raise exception 'expected 21 restrictive write policies, found %',
      (select count(*) from pg_policies
        where schemaname='public' and policyname like '%\_active\_writer\_%');
  end if;

  -- (b) an ACTIVE user must still be able to write. If this migration makes
  --     ordinary use impossible it is worse than the hole it closes.
  select id into victim from public.profiles where role='customer' and is_active limit 1;
  if victim is null then
    raise notice 'no active customer - skipping behavioural verify';
    return;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', victim)::text, true);
  insert into public.saved_halls (customer_id, hall_id)
    select victim, id from public.halls limit 1
    returning hall_id into saved;
  if saved is null then
    raise notice 'no hall to save against - partial verify only';
  else
    delete from public.saved_halls where customer_id = victim and hall_id = saved;
  end if;
  reset role;

  -- (c) SUSPEND the same user and prove the write is now refused.
  select is_active into original from public.profiles where id = victim;
  update public.profiles set is_active = false where id = victim;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', victim)::text, true);
  begin
    insert into public.saved_halls (customer_id, hall_id)
      select victim, id from public.halls limit 1;
    outcome := 'ACCEPTED';
  exception when others then
    outcome := 'refused ' || sqlstate;
  end;
  reset role;

  -- Restore BEFORE asserting, so a failed assertion cannot leave the account
  -- suspended in production.
  update public.profiles set is_active = original where id = victim;

  if outcome = 'ACCEPTED' then
    raise exception 'GUARD FAILED: a suspended account still wrote a row';
  end if;

  -- (d) and the restore actually happened.
  if not (select is_active from public.profiles where id = victim) then
    raise exception 'the verify block left a real account suspended';
  end if;

  raise notice 'suspended write %, active write ok', outcome;
end
$mig$;
