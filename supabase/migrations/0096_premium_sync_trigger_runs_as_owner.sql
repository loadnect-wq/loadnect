-- ─────────────────────────────────────────────────────────────────────────────
-- 0096_premium_sync_trigger_runs_as_owner.sql — admins can grant, revoke and
-- cancel premium listings again.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE BUG
-- ════════════════════════════════════════════════════════════════════════════
-- Admin → Premium listings → "Grant Premium" returned "You don't have
-- permission to do this." for a real, active admin. That text is lib/errors.ts's
-- mapping of Postgres 42501 — NOT the application's admin gate, which passed.
-- Production logs and a reproduction as the admin's own session both show:
--
--     42501  permission denied for function recompute_hall_premium
--
-- The chain:
--   createPremiumListing (admin session client — deliberately not the service
--   role, so is_admin(), the guard trigger and the audit trail see the admin)
--     → INSERT premium_listings            RLS premium_admin_write: is_admin() ✓
--     → trg_guard_premium_listing_writes   is_admin() ✓
--     → trg_premium_listings_sync → trg_recompute_hall_premium()
--         → PERFORM public.recompute_hall_premium(hall_id)   ✗ 42501
--
-- 0034_lock_down_internal_functions (26 Aug) revoked EXECUTE on
-- recompute_hall_premium from `authenticated`, reasoning that it only runs
-- from triggers and "Postgres does NOT check EXECUTE privilege when a trigger
-- fires". That is true for the TRIGGER FUNCTION itself — but
-- trg_recompute_hall_premium() is SECURITY INVOKER, so the functions IT calls
-- are checked against the role that fired the trigger. For the Cashfree
-- webhook that role is service_role, which kept EXECUTE, so paid purchases
-- never noticed. For an admin acting through their own session it is
-- `authenticated`, which lost it. Every admin write to premium_listings has
-- failed since: manual grants, complimentary grants, cancel and revoke.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE FIX, AND WHY IT DOES NOT WEAKEN ANYTHING
-- ════════════════════════════════════════════════════════════════════════════
-- trg_recompute_hall_premium() becomes SECURITY DEFINER, so its internal call
-- runs with its owner's privileges. Nothing else changes:
--
--   • WHO MAY WRITE premium_listings is unchanged. RLS premium_admin_write
--     (is_admin()) and guard_premium_listing_writes (is_trusted_backend() or
--     is_admin()) still decide that, before this trigger ever runs.
--   • recompute_hall_premium STAYS REVOKED from anon and authenticated — the
--     /rest/v1/rpc door 0034 closed remains closed. Granting EXECUTE back was
--     the alternative and was rejected for exactly that reason.
--   • A trigger function cannot be called through the API at all (PostgREST
--     will not route a function returning `trigger`), and its own EXECUTE stays
--     revoked. It only ever recomputes the hall of the row being written, from
--     that hall's listings — a derived value, never an input.
--   • search_path is already pinned (0034), which SECURITY DEFINER requires.
--
-- VERIFIED before applying, in a rolled-back transaction, with the fix applied:
--   admin grants complimentary Premium    succeeded, hall tier -> premium
--   admin revokes it                      succeeded, hall tier -> none
--   the hall's own owner grants itself    blocked (guard trigger)
--   owner forging granted_by = the admin  blocked
--   owner extending the admin's grant     0 rows (RLS)
--   another owner targeting the hall      blocked
--   signed-in customer                    blocked
--   anon                                  blocked
--   service role (Cashfree paid path)     succeeded, unchanged
--   authenticated EXECUTE on recompute    still false
--
-- ROLLBACK: alter function public.trg_recompute_hall_premium() security invoker;
-- ─────────────────────────────────────────────────────────────────────────────

alter function public.trg_recompute_hall_premium() security definer;

-- Restated, not changed: neither function is callable by an API role.
revoke execute on function public.trg_recompute_hall_premium() from public, anon, authenticated;
revoke execute on function public.recompute_hall_premium(uuid) from public, anon, authenticated;

do $verify$
begin
  if not (select prosecdef from pg_proc where oid = 'public.trg_recompute_hall_premium()'::regprocedure) then
    raise exception '0096: trg_recompute_hall_premium is not SECURITY DEFINER';
  end if;
  if not exists (
    select 1 from pg_proc
    where oid = 'public.trg_recompute_hall_premium()'::regprocedure
      and array_to_string(proconfig, ',') like '%search_path=%'
  ) then
    raise exception '0096: SECURITY DEFINER trigger function has no pinned search_path';
  end if;
  if has_function_privilege('authenticated', 'public.recompute_hall_premium(uuid)', 'execute')
     or has_function_privilege('anon', 'public.recompute_hall_premium(uuid)', 'execute') then
    raise exception '0096: recompute_hall_premium became callable by an API role';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'premium_listings'
                  and policyname = 'premium_admin_write' and qual = 'is_admin()' and with_check = 'is_admin()') then
    raise exception '0096: premium_admin_write is not the admin-only policy it must be';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.premium_listings'::regclass
                  and tgname = 'trg_guard_premium_listing_writes' and not tgisinternal) then
    raise exception '0096: the premium write guard trigger is missing';
  end if;
end
$verify$;
