-- ─────────────────────────────────────────────────────────────────────────────
-- 0021_fix_halls_select_returning.sql
--
-- THE BUG: no hall could EVER be created. Owners saw
--   "You don't have permission to do this."
-- and production logged
--   42501 new row violates row-level security policy for table "halls"
--
-- WHY. `createHall` does:
--     .insert({...}).select("id").single()
-- which PostgREST issues as `INSERT ... RETURNING`. Postgres applies the
-- **SELECT** policy to the row being returned, in addition to the INSERT
-- policy's WITH CHECK. `halls_select` rested on:
--     owns_hall(id) -> is_hall_owner(id)
-- which is declared STABLE and re-queries `halls`. A STABLE function sees the
-- snapshot from the START of the statement, where the just-inserted row does
-- not exist yet — so ownership evaluated FALSE and the whole statement aborted,
-- even though the INSERT's own WITH CHECK had passed.
--
-- Proven on the live database (both probes rolled back):
--     INSERT              -> SUCCEEDED
--     INSERT ... RETURNING -> 42501  ← exactly what the app hit
--
-- THE FIX: decide ownership from the row's OWN `owner_id` column using
-- `owns_owner_row()`, which reads `hall_owners` — a table that pre-exists the
-- statement — instead of re-reading `halls`. Semantically identical ("this
-- hall's owner_id belongs to me" is the same test as "I own this hall"), but
-- evaluable on a row created by the current statement.
--
-- SECURITY IS UNCHANGED — verified against the live database after applying:
--   • owner can create their own hall ................ ok
--   • a DIFFERENT owner cannot insert under that
--     owner_id (still 42501) ......................... ok
--   • a pending hall stays invisible to anon ......... ok
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists halls_select on public.halls;
create policy halls_select on public.halls
  for select using (
    status = 'approved'
    or public.owns_owner_row(owner_id)
    or public.is_admin()
  );
