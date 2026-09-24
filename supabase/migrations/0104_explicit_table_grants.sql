-- ─────────────────────────────────────────────────────────────────────────────
-- 0104_explicit_table_grants.sql
--
-- EVERY TABLE IN public NOW STATES ITS OWN PRIVILEGES. Nothing in this schema
-- depends on Supabase's default grants any more.
--
-- ═══ WHY NOW ════════════════════════════════════════════════════════════════
--
-- From 30 October 2026 Supabase stops granting Data API access to NEW tables in
-- `public` automatically. Existing tables keep what they have, so this project's
-- production database is not affected and nothing here is urgent for the live
-- site. What IS affected is REPLAY: `supabase db push` into a fresh project, a
-- preview branch, or a local `db reset` after that date produces a database
-- where a table created without a grant is invisible to the API.
--
-- Measured before writing this: 39 tables exist in `public`. Twenty-one of them
-- have no GRANT anywhere in supabase/migrations — they have only ever held the
-- privileges Supabase handed out at `create table` time. Another handful
-- (availability, contact_messages, hall_owners, profiles, reviews) DO appear in
-- earlier migrations, but only as REVOKEs that narrow the default; the SELECT
-- underneath them is still default-derived. Replayed after 30 October, all of
-- those come back empty-handed and the app 42501s on almost every page.
--
-- 0079 already found the same fault line from the other side — its header reads
-- "The other twenty-four kept Supabase's default grant set" — and revoked
-- TRUNCATE across the schema. This finishes that job for the remaining verbs.
--
-- ═══ THIS IS NOT A COPY OF TODAY'S GRANTS ═══════════════════════════════════
--
-- Restating the defaults verbatim would make a permanent, auditable-looking
-- decision out of an accident. The default set is `arwdxt` for BOTH anon and
-- authenticated, which today means `anon` holds INSERT, UPDATE and DELETE on
-- payment_transactions, commissions, plan_purchases, platform_settings and
-- twenty others. Only RLS has ever stopped that being reachable.
--
-- So each table is granted what the application actually uses, established by
-- reading every `.from("<table>")` call site in app/ and lib/ and resolving
-- which client issues it:
--
--   lib/supabase/public.ts  -> anon        (cookie-free, public pages)
--   lib/supabase/server.ts  -> authenticated when signed in, anon when not
--   lib/supabase/client.ts  -> the same, from the browser
--   lib/supabase/admin.ts   -> service_role, which bypasses all of this
--
-- A table reached only through admin.ts gets nothing here. That is most of the
-- money ledger.
--
-- ADMIN WRITES ARE `authenticated`, NOT service_role. app/admin/actions.ts
-- resolves its client through requireAdminActor(), which returns the SESSION
-- client — so an admin's INSERT/UPDATE/DELETE is checked against these grants
-- before RLS ever sees it. That is why advertisements, premium_plans, reviews
-- and platform_settings grant writes to `authenticated`: is_admin() is enforced
-- in the policy, not at the privilege layer.
--
-- ═══ WHAT IS DELIBERATELY DROPPED ═══════════════════════════════════════════
--
--   * anon loses INSERT/UPDATE/DELETE everywhere. No code path uses them.
--   * commission_transactions, payment_transactions, settlement_transactions,
--     payment_webhook_events and owner_commission_payments lose API access
--     entirely — zero non-service call sites between them. 0073 already said of
--     owner_commission_payments that "no grant is needed and none is restored";
--     the default had quietly restored it anyway.
--   * saved_halls keeps SELECT only. Saving a hall writes to localStorage
--     (lib/hooks/useSavedHalls.ts), never to this table.
--   * profiles loses INSERT and DELETE from authenticated. Rows are created by
--     handle_new_user(), a SECURITY DEFINER trigger on auth.users; deletion
--     runs through lib/account-deletion.ts on the service role.
--   * reviews keeps UPDATE revoked (0048) — moderation is service-role — but
--     regains the SELECT/INSERT/DELETE it was silently relying on.
--
-- ═══ THREE TABLES ARE NARROWED, NOT REVOKED ═════════════════════════════════
--
-- contact_messages, hall_owners and profiles carry COLUMN-level grants from
-- 0046/0069/0080/0082/0084. `revoke all` would take those with it and there is
-- no reason to restate a column list that is already correct, so those three
-- get only the missing table-level SELECT.
--
-- ═══ NO SCHEMA CHANGE ═══════════════════════════════════════════════════════
--
-- No table, column, index, policy, trigger or function is created, altered or
-- dropped. This migration contains GRANT and REVOKE only.
-- ─────────────────────────────────────────────────────────────────────────────

-- No explicit begin/commit, matching 0102 and 0103: the applier wraps a
-- migration in its own transaction, so the verify block at the bottom rolls
-- every grant here back if any assertion fails.

-- ═══ 1. service_role ════════════════════════════════════════════════════════
-- Also a default today, and also gone on replay after 30 October. Every
-- server-side path in this app runs through it, so without this a replayed
-- database has no working writes at all. Verified no-op against production:
-- all 39 tables already grant service_role all seven privileges.
grant all on all tables in schema public to service_role;

-- ═══ 2. Public catalogue ════════════════════════════════════════════════════
-- Read by logged-out visitors. Note that the venue page uses the SESSION client
-- (lib/halls.ts, fetchHallBySlug) so a logged-out reader arrives as `anon`
-- there too — these reads are anon's, not an oversight.

revoke all on public.amenities from anon, authenticated;
grant select on public.amenities to anon, authenticated;

revoke all on public.availability from anon, authenticated;
grant select on public.availability to anon, authenticated;
-- 0060 and 0062 granted select on two columns each; a table grant subsumes both.
-- 0063's revoke of insert/update/delete is preserved by granting none of them.

revoke all on public.hall_amenities from anon, authenticated;
grant select on public.hall_amenities to anon, authenticated;
grant insert, delete on public.hall_amenities to authenticated;
-- Owner edits replace the whole set: delete by hall_id, then insert the new
-- list. No UPDATE is ever issued against this table.

revoke all on public.hall_custom_amenities from anon, authenticated;
grant select on public.hall_custom_amenities to anon, authenticated;
grant insert, delete on public.hall_custom_amenities to authenticated;

revoke all on public.hall_images from anon, authenticated;
grant select on public.hall_images to anon, authenticated;
grant insert, update, delete on public.hall_images to authenticated;

revoke all on public.reviews from anon, authenticated;
grant select on public.reviews to anon, authenticated;
grant insert, delete on public.reviews to authenticated;
-- INSERT is the customer leaving a review; DELETE is an admin removing one, on
-- the session client. UPDATE stays revoked — 0048 moved is_visible moderation
-- to the service role and it is still there.

revoke all on public.advertisements from anon, authenticated;
grant select on public.advertisements to anon, authenticated;
grant insert, update, delete on public.advertisements to authenticated;

revoke all on public.premium_plans from anon, authenticated;
grant select on public.premium_plans to anon, authenticated;
grant update on public.premium_plans to authenticated;
-- The plan catalogue is public (lib/premium-plans.ts reads it through the anon
-- client). Admins edit prices in place; nothing inserts or deletes a plan.

-- ═══ 3. Signed-in only ══════════════════════════════════════════════════════

revoke all on public.admin_audit_log from anon, authenticated;
grant select, insert on public.admin_audit_log to authenticated;
-- Append-only by design: the trail is read in lib/admin.ts and written by admin
-- actions. No UPDATE, no DELETE — not even for an admin.

revoke all on public.notifications from anon, authenticated;
grant select, update on public.notifications to authenticated;
-- UPDATE is "mark as read". Rows are created by lib/notifications/service.ts on
-- the service role, so INSERT is not granted.

revoke all on public.support_tickets from anon, authenticated;
grant select, insert, update on public.support_tickets to authenticated;
-- 0076's privileged-column guard is a TRIGGER, not a grant, and is unaffected.

revoke all on public.commissions from anon, authenticated;
grant select on public.commissions to authenticated;
-- An owner reads their own commission rows (lib/owner.ts). Every write is
-- service-role.

revoke all on public.owner_settlement_adjustments from anon, authenticated;
grant select on public.owner_settlement_adjustments to authenticated;

revoke all on public.plan_purchases from anon, authenticated;
grant select on public.plan_purchases to authenticated;

revoke all on public.plan_subscriptions from anon, authenticated;
grant select on public.plan_subscriptions to authenticated;

revoke all on public.premium_listings from anon, authenticated;
grant select, insert, update on public.premium_listings to authenticated;
-- INSERT/UPDATE are the admin's complimentary-premium grant (0091), which runs
-- on the session client. Paid activation is service-role.

revoke all on public.platform_settings from anon, authenticated;
grant select, insert, update on public.platform_settings to authenticated;
-- INSERT and UPDATE together because the admin screen upserts the row.
-- anon gets NOTHING: the public booking form reads these values through the
-- SECURITY DEFINER RPC get_public_payment_settings(), never from the table.

revoke all on public.saved_halls from anon, authenticated;
grant select on public.saved_halls to authenticated;

-- ═══ 4. No API access at all ════════════════════════════════════════════════
-- Zero non-service call sites. They held full anon+authenticated privileges
-- purely because they were created before anyone revoked anything.

revoke all on public.commission_transactions   from anon, authenticated;
revoke all on public.payment_transactions      from anon, authenticated;
revoke all on public.settlement_transactions   from anon, authenticated;
revoke all on public.payment_webhook_events    from anon, authenticated;
revoke all on public.owner_commission_payments from anon, authenticated;

-- ═══ 5. Narrowed, not revoked — column grants must survive ══════════════════

-- authenticated's SELECT here is default-derived; 0082 only revoked anon's.
grant select on public.contact_messages to authenticated;

-- Same shape: 0070 revoked anon's SELECT and left authenticated's implicit.
-- The column-scoped INSERT (0069) and UPDATE (0046/0068/0080) stay untouched.
grant select on public.hall_owners to authenticated;

-- 0084 revoked table-wide UPDATE and re-granted ten columns. SELECT was never
-- stated. anon keeps SELECT: RLS returns it no rows, and the auth callback
-- reads profiles on a client whose session may not be attached yet.
grant select on public.profiles to anon, authenticated;
revoke insert, delete on public.profiles from authenticated;

-- ═══ 6. Verify ══════════════════════════════════════════════════════════════
-- Asserts the four DML privileges for anon and authenticated on every table
-- touched above. REFERENCES and TRIGGER are ignored: they grant no data access
-- and the three narrowed tables still carry theirs.
do $$
declare
  expected constant text[][] := array[
    -- table,                         anon,      authenticated
    array['amenities',                    'SELECT',  'SELECT'],
    array['availability',                 'SELECT',  'SELECT'],
    array['hall_amenities',               'SELECT',  'DELETE,INSERT,SELECT'],
    array['hall_custom_amenities',        'SELECT',  'DELETE,INSERT,SELECT'],
    array['hall_images',                  'SELECT',  'DELETE,INSERT,SELECT,UPDATE'],
    array['reviews',                      'SELECT',  'DELETE,INSERT,SELECT'],
    array['advertisements',               'SELECT',  'DELETE,INSERT,SELECT,UPDATE'],
    array['premium_plans',                'SELECT',  'SELECT,UPDATE'],
    array['admin_audit_log',              '',        'INSERT,SELECT'],
    array['notifications',                '',        'SELECT,UPDATE'],
    array['support_tickets',              '',        'INSERT,SELECT,UPDATE'],
    array['commissions',                  '',        'SELECT'],
    array['owner_settlement_adjustments', '',        'SELECT'],
    array['plan_purchases',               '',        'SELECT'],
    array['plan_subscriptions',           '',        'SELECT'],
    array['premium_listings',             '',        'INSERT,SELECT,UPDATE'],
    array['platform_settings',            '',        'INSERT,SELECT,UPDATE'],
    array['saved_halls',                  '',        'SELECT'],
    array['commission_transactions',      '',        ''],
    array['payment_transactions',         '',        ''],
    array['settlement_transactions',      '',        ''],
    array['payment_webhook_events',       '',        ''],
    array['owner_commission_payments',    '',        ''],
    array['contact_messages',             '',        'SELECT'],
    array['hall_owners',                  '',        'SELECT'],
    array['profiles',                     'SELECT',  'SELECT']
  ];
  tbl  text;
  rol  text;
  want text;
  got  text;
  i    int;
  r    int;
begin
  for i in 1 .. array_length(expected, 1) loop
    tbl := expected[i][1];

    if to_regclass('public.' || tbl) is null then
      raise exception '0104: table public.% does not exist', tbl;
    end if;

    for r in 2 .. 3 loop
      rol  := case r when 2 then 'anon' else 'authenticated' end;
      want := expected[i][r];

      select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
        into got
        from information_schema.role_table_grants
       where table_schema   = 'public'
         and table_name     = tbl
         and grantee        = rol
         and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

      if got is distinct from want then
        raise exception '0104: public.% for % is [%], expected [%]', tbl, rol, got, want;
      end if;
    end loop;
  end loop;

  -- The column grants the three narrowed tables depend on must have survived.
  if not has_column_privilege('authenticated', 'public.contact_messages', 'is_read', 'UPDATE') then
    raise exception '0104: contact_messages.is_read lost its UPDATE grant';
  end if;
  if not has_column_privilege('authenticated', 'public.hall_owners', 'business_name', 'UPDATE') then
    raise exception '0104: hall_owners.business_name lost its UPDATE grant';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') then
    raise exception '0104: profiles.full_name lost its UPDATE grant';
  end if;

  -- And the things that must NOT be reachable.
  if has_table_privilege('anon', 'public.payment_transactions', 'SELECT') then
    raise exception '0104: anon can still read payment_transactions';
  end if;
  if has_table_privilege('authenticated', 'public.profiles', 'INSERT') then
    raise exception '0104: authenticated can still insert profiles';
  end if;
  if has_table_privilege('anon', 'public.halls', 'SELECT') then
    raise exception '0104: halls regained a table-wide SELECT — 0072 column list bypassed';
  end if;
  if not has_table_privilege('service_role', 'public.halls', 'SELECT') then
    raise exception '0104: service_role lost SELECT on halls';
  end if;

  raise notice '0104: privileges verified on % tables', array_length(expected, 1);
end $$;
