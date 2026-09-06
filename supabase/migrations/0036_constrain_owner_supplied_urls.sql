-- RECOVERED 2026-09-06 from supabase_migrations.schema_migrations, version
-- 20260827010140 "constrain_owner_supplied_urls". Applied to production but
-- never committed, so supabase/migrations/ could not rebuild the schema.
-- Exported verbatim; not re-run.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 0036: owner-supplied URLs must be http(s) at the DATABASE level.
--
-- owner_commission_payments.screenshot_url is rendered by the admin dashboard
-- as <a href={...}>. The server action validated ^https?:// — but the RLS
-- INSERT policy (ocp_owner_insert) constrains only owner_id and status, so an
-- owner could POST straight to PostgREST with
--   screenshot_url = 'javascript:...'
-- and skip the action entirely. The admin clicking "View screenshot" would
-- then execute it in an admin session: stored XSS into the highest-privilege
-- surface on the platform.
--
-- The CSP shipped alongside this does NOT cover it — script-src must keep
-- 'unsafe-inline' for the Next runtime and the Cashfree SDK, which also
-- permits javascript: URIs. So the constraint is the real fix, and the
-- render-side sanitiser is defence in depth.
--
-- NOT VALID: existing rows are left alone (there are none today, but a
-- launch-time migration must never fail on historical data); every future
-- write is checked.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.owner_commission_payments
  drop constraint if exists ocp_screenshot_url_http;

alter table public.owner_commission_payments
  add constraint ocp_screenshot_url_http
  check (screenshot_url is null or screenshot_url ~* '^https?://[^\s]+$')
  not valid;
