-- ─────────────────────────────────────────────────────────────────────────────
-- 0092_trigger_functions_are_not_api.sql — take three trigger functions off the
-- public API surface, and drop a duplicate index.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHY THESE THREE AND NOT THE OTHER NINE
-- ════════════════════════════════════════════════════════════════════════════
-- The database linter reports twelve SECURITY DEFINER functions as executable
-- by `anon`. Nine of them are meant to be:
--
--   get_commission_percent, get_public_payment_settings, hall_seller_public
--     — deliberately public. hall_seller_public returns business_name, address
--       and city for APPROVED halls only; it exposes no phone and no email.
--   is_admin, is_active_user, is_owner_approved, is_hall_owner, owns_hall,
--   owns_owner_row
--     — RLS helpers. They answer a question about the CALLER's own session and
--       return false for anon, so there is nothing to disclose. They are also
--       invoked from inside policy expressions, which ARE evaluated with the
--       querying user's privileges — revoking EXECUTE would break row-level
--       security rather than tighten it.
--
-- The three revoked here are different: they return `trigger`. They are not
-- callable as an API at all (PostgREST will not route a trigger-returning
-- function, and Postgres refuses a direct call), so this closes no live hole —
-- it removes three permanent entries from the security report so that a real
-- finding in it is still visible. Same reasoning as the .claude/** eslint
-- ignore: the damage from noise is that a genuine problem hides inside it.
--
-- VERIFIED, NOT ASSUMED, THAT THIS IS SAFE. The obvious worry is that revoking
-- EXECUTE stops the triggers firing for ordinary users, which would silently
-- break payout-detail stamping and availability syncing. Postgres checks
-- EXECUTE at CREATE TRIGGER time, not at fire time — so the trigger still runs.
-- That was proved on a throwaway table before this migration was written: a
-- SECURITY DEFINER trigger function with every grant revoked still fired for
-- role `authenticated` and mutated the row. The probe objects were dropped.
--
-- The self-verification below also asserts all three triggers still EXIST,
-- because a revoke is worthless if someone later drops the trigger instead.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE DUPLICATE INDEX
-- ════════════════════════════════════════════════════════════════════════════
-- 0015_review_enhancements.sql:57 created uq_review_per_booking. 0066 then
-- created uq_review_one_per_booking with a byte-identical definition —
-- `create unique index if not exists` under a NEW NAME does not notice that the
-- same index already exists. Two identical unique indexes both get maintained
-- on every write and both get considered by the planner, for one constraint.
-- The 0015 original survives; neither name is referenced anywhere in
-- application code, which was checked before dropping.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT WAS DELIBERATELY NOT CHANGED
-- ════════════════════════════════════════════════════════════════════════════
-- • invoice_counters and owner_payouts are reported as "RLS enabled, no
--   policies". That is the intended state, not an oversight: neither table
--   grants anything to anon or authenticated (checked), so they are reachable
--   only through the service role. Adding a policy would be the actual mistake
--   — it would imply a grant that should not exist.
-- • btree_gist lives in the public schema. Moving it would invalidate the
--   exclusion constraints built on it. Not worth a production outage for a
--   linter preference.
-- • schema_migration_state() and coupon_usage() are reported as executable by
--   `authenticated`. Both open with `if not public.is_admin() then raise` — the
--   linter cannot see inside a function body. Revoking would break the admin
--   pages that call them through the user's own session.
--
-- ROLLBACK:
--   grant execute on function public.stamp_payout_details_changed()     to authenticated;
--   grant execute on function public.sync_availability_is_public()      to authenticated;
--   grant execute on function public.sync_availability_on_hall_status() to authenticated;
--   create unique index uq_review_one_per_booking
--     on public.reviews (booking_id) where booking_id is not null;
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function public.stamp_payout_details_changed()     from public, anon, authenticated;
revoke all on function public.sync_availability_is_public()      from public, anon, authenticated;
revoke all on function public.sync_availability_on_hall_status() from public, anon, authenticated;

drop index if exists public.uq_review_one_per_booking;

notify pgrst, 'reload schema';

-- ── Self-verification ───────────────────────────────────────────────────────
do $verify$
declare v_name text;
begin
  foreach v_name in array array[
    'stamp_payout_details_changed','sync_availability_is_public','sync_availability_on_hall_status'
  ] loop
    if has_function_privilege('anon', ('public.'||v_name||'()')::regprocedure, 'EXECUTE')
       or has_function_privilege('authenticated', ('public.'||v_name||'()')::regprocedure, 'EXECUTE') then
      raise exception '0092: % is still executable by anon or authenticated', v_name;
    end if;
  end loop;

  -- A revoke that "passes" because the trigger was deleted is a regression, not
  -- a fix.
  if (select count(*) from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('stamp_payout_details_changed','sync_availability_is_public',
                           'sync_availability_on_hall_status')
         and not t.tgisinternal) < 3 then
    raise exception '0092: a trigger that used one of these functions has gone missing';
  end if;

  if not exists (select 1 from pg_indexes
                  where schemaname='public' and tablename='reviews'
                    and indexname='uq_review_per_booking') then
    raise exception '0092: the surviving one-review-per-booking index is gone';
  end if;
  if exists (select 1 from pg_indexes
              where schemaname='public' and tablename='reviews'
                and indexname='uq_review_one_per_booking') then
    raise exception '0092: the duplicate index was not dropped';
  end if;
end
$verify$;
