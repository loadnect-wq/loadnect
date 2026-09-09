-- ─────────────────────────────────────────────────────────────────────────────
-- 0070_revoke_anon_select_hall_owners.sql
--
-- Take the anonymous role's table-level SELECT off public.hall_owners.
--
-- WHAT THE TABLE HOLDS: gst_number, and the payout destination —
-- payout_beneficiary_name / _account / _ifsc / _upi. Bank details and a tax id
-- for a real business. It is the most sensitive table in the schema after auth.
--
-- WHAT WAS TRUE BEFORE THIS: `anon` held SELECT at the table level, and the
-- ONLY thing standing between an anonymous PostgREST request and those columns
-- was the RLS policy
--
--     hall_owners_select : (profile_id = auth.uid()) OR is_admin()
--
-- which is correctly closed today — auth.uid() is NULL for anon, so the
-- comparison is NULL rather than true, and is_admin() is false, so anon reads
-- zero rows. This migration changes nothing about what is reachable right now.
-- Verified before writing it: no code path reads hall_owners through the anon
-- client. Every reader uses either the service-role client or the per-request
-- server client (which runs as `authenticated`), and the public hall page gets
-- its seller fields from hall_seller_public(), a SECURITY DEFINER function that
-- bypasses grants by design and returns only the public subset.
--
-- WHY DO IT THEN: so that a single future edit cannot become a disclosure. A
-- policy is one WHERE clause; loosening hall_owners_select — adding an OR for a
-- public directory, say — would silently hand anon the bank columns too,
-- because the grant underneath was already open. Removing the grant means the
-- anonymous role has no path to this table at all, and a future policy mistake
-- degrades to "no rows" instead of "PAN and account number".
--
-- NOT EXTENDED TO `authenticated`, deliberately. lib/admin.ts and the owner
-- dashboard read hall_owners through the request-scoped server client, which
-- authenticates as `authenticated`; revoking there would break the owner
-- dashboard and the admin owner list. RLS is what scopes those reads to the
-- caller's own row, and it does that correctly.
--
-- Column grants are checked BEFORE RLS and are not is_admin()-aware, which is
-- why this is written as a role-scoped table revoke and not as a policy change.
-- ─────────────────────────────────────────────────────────────────────────────

-- SCOPED TO THIS ONE TABLE ON PURPOSE. The obvious "belt and braces" addition
-- here is `alter default privileges in schema public revoke select on tables
-- from anon`, and it would be a mistake: default privileges apply to every
-- table created afterwards, so the next genuinely public table — halls,
-- reviews, amenities — would come into existence unreadable by anonymous
-- visitors, and the failure would look like an RLS problem rather than a grant
-- one. Fix the table that holds bank details; do not change the schema default.
revoke select on public.hall_owners from anon;

do $$
begin
  if has_table_privilege('anon', 'public.hall_owners', 'SELECT') then
    raise exception
      'anon still holds SELECT on hall_owners after the revoke — check for a grant to PUBLIC';
  end if;

  -- The owner dashboard and admin list must keep working.
  if not has_table_privilege('authenticated', 'public.hall_owners', 'SELECT') then
    raise exception
      'authenticated lost SELECT on hall_owners — the owner dashboard would break';
  end if;
end $$;
