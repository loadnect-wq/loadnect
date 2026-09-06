-- RECOVERED 2026-09-06 from supabase_migrations.schema_migrations, version
-- 20260826092115 "lock_down_internal_functions". This migration was applied to
-- production but its file was never committed, so supabase/migrations/ could
-- not rebuild the schema. Exported verbatim; not re-run.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 0034: lock down internal functions flagged by the Supabase security advisor.
--
-- WHAT IS REVOKED AND WHY IT IS SAFE:
--   • Trigger functions (handle_new_user, prevent_overlapping_booking,
--     guard_commission_payment_integrity, rls_auto_enable, set_updated_at,
--     trg_recompute_hall_premium, recalc_hall_rating): Postgres does NOT check
--     EXECUTE privilege when a trigger fires, so revoking API-role EXECUTE
--     changes nothing about normal operation — it only closes the
--     /rest/v1/rpc/* door.
--   • Maintenance functions (expire_ads, recompute_hall_premium): no app code
--     calls them via .rpc() (verified by grep); they run from triggers/SQL.
--   • cleanup_expired_pending_bookings: the admin dashboard calls it through
--     the session client, so `authenticated` keeps EXECUTE; anon loses it.
--
-- WHAT IS DELIBERATELY LEFT ALONE:
--   • RLS policy helpers (is_admin, is_hall_owner, is_owner_approved,
--     owns_hall, owns_owner_row, is_trusted_backend): policies evaluate these
--     with the caller's privileges, so anon/authenticated NEED EXECUTE for the
--     public halls listing and every gated table to answer at all. They are
--     auth.uid()-based predicates that mutate nothing and leak nothing.
--   • get_commission_percent / get_public_payment_settings: intentionally
--     public — anonymous visitors on /halls and /owner/register read them.
-- ─────────────────────────────────────────────────────────────────────────────

revoke execute on function public.expire_ads() from public, anon, authenticated;
revoke execute on function public.recompute_hall_premium(uuid) from public, anon, authenticated;
revoke execute on function public.recalc_hall_rating() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.prevent_overlapping_booking() from public, anon, authenticated;
revoke execute on function public.guard_commission_payment_integrity() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.trg_recompute_hall_premium() from public, anon, authenticated;

revoke execute on function public.cleanup_expired_pending_bookings() from public, anon;
grant execute on function public.cleanup_expired_pending_bookings() to authenticated;

-- Pin search_path on the three functions the advisor flagged as mutable.
-- SECURITY DEFINER + mutable search_path is the classic shadowing attack;
-- these run as definer inside triggers/policies, so pin them.
alter function public.trg_recompute_hall_premium() set search_path = public, pg_temp;
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.is_trusted_backend() set search_path = public, pg_temp;
