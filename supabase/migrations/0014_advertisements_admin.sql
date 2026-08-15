-- ─────────────────────────────────────────────────────────────────────────────
-- 0014  Advertisement management (admin)
--
-- WHAT THIS MIGRATION DOES
--   1. Adds `advertiser_name` text column to advertisements (free-form display
--      name shown to viewers; independent of owner FK).
--   2. Adds a CHECK constraint pinning placement to a known set:
--        homepage_banner | search_page_banner | hall_detail_sidebar
--        | booking_confirmation
--      (NULL still allowed for legacy rows.)
--   3. Adds a CHECK constraint on target_url that disallows javascript: /
--      data: / file: / vbscript: schemes at the DB level. The app validates
--      first; this is defense-in-depth so a buggy/abused server insert can
--      never store an unsafe URL.
--   4. Adds an `expire_ads()` SECURITY DEFINER helper that flips status to
--      'expired' for any active ad whose end_date is in the past. Safe for
--      any role to call (admin schedulers / cron); only touches the status
--      transition active→expired.
--
-- RLS is unchanged — existing ads_select hides inactive/expired rows from
-- public reads already, and ads_write keeps writes admin-only. Trusted backend
-- can still insert via service-role key (bypasses RLS).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. advertiser_name column
alter table public.advertisements
  add column if not exists advertiser_name text;

-- 2. Placement allow-list (drop first so re-runs are safe)
alter table public.advertisements
  drop constraint if exists ad_placement_valid;

alter table public.advertisements
  add constraint ad_placement_valid
  check (
    placement is null
    or placement in (
      'homepage_banner',
      'search_page_banner',
      'hall_detail_sidebar',
      'booking_confirmation'
    )
  );

-- 3. Target URL scheme guard (defense-in-depth; app validates first)
alter table public.advertisements
  drop constraint if exists ad_target_url_safe;

alter table public.advertisements
  add constraint ad_target_url_safe
  check (
    target_url is null
    or (
      lower(target_url) !~ '^\s*(javascript|data|vbscript|file):'
      and target_url ~* '^https?://'
      and length(target_url) <= 2048
    )
  );

-- 4. Expire ads helper. Admin or scheduled call.
create or replace function public.expire_ads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rows_affected integer;
begin
  -- Only admins may invoke; the function is SECURITY DEFINER so it can run
  -- with elevated rights, but we still gate on the caller's role.
  if not public.is_admin() then
    raise exception 'expire_ads: admin only';
  end if;

  update public.advertisements
     set status = 'expired',
         updated_at = now()
   where status = 'active'
     and end_date is not null
     and end_date < current_date;

  get diagnostics rows_affected = row_count;
  return rows_affected;
end;
$$;

grant execute on function public.expire_ads() to authenticated;

create index if not exists idx_ads_end_date on public.advertisements (end_date)
  where status = 'active';
