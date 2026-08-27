-- ─────────────────────────────────────────────────────────────────────────────
-- 0041 — Make premium expiry actually happen.
--
-- THE BUG: recompute_hall_premium() is date-aware, but it only ever runs as a
-- REACTION TO A WRITE on premium_listings (trg_premium_listings_sync). Nothing
-- was scheduled. So once a listing's end_date passed, halls.premium_tier and
-- halls.is_premium stayed set INDEFINITELY — until somebody happened to write
-- another premium_listings row for that same hall.
--
-- The consequence was visible in two directions at once: /admin/premium-listings
-- and /owner/premium recompute the window in JS and correctly showed "Expired",
-- while public search ranking, the ?category=premium filter and the Pro/Premium
-- badges all read the stale halls column and kept promoting the hall forever.
-- An owner could pay for one 30-day month and be boosted permanently.
--
-- This adds the sweep. It is idempotent and safe to run repeatedly.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.expire_premium_listings()
returns table (deactivated integer, halls_recomputed integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n_deactivated integer := 0;
  n_recomputed  integer := 0;
  h             uuid;
begin
  -- 1. Retire listings whose window has closed. The AFTER trigger on
  --    premium_listings recomputes each affected hall's tier as a side effect.
  with expired as (
    update public.premium_listings
       set is_active = false,
           updated_at = now()
     where is_active = true
       and end_date < current_date
    returning hall_id
  )
  select count(*)::integer into n_deactivated from expired;

  -- 2. Belt and braces: any hall still carrying a tier without a live listing
  --    behind it. Catches rows that went stale before this sweep existed, and
  --    any future path that changes a window without touching is_active.
  for h in
    select id from public.halls
     where (premium_tier is not null or is_premium = true)
       and not exists (
         select 1 from public.premium_listings pl
          where pl.hall_id = halls.id
            and pl.is_active = true
            and pl.start_date <= current_date
            and pl.end_date   >= current_date
       )
  loop
    perform public.recompute_hall_premium(h);
    n_recomputed := n_recomputed + 1;
  end loop;

  return query select n_deactivated, n_recomputed;
end;
$$;

-- Service-role / cron only. Not reachable by a signed-in owner or the public.
revoke all on function public.expire_premium_listings() from public, anon, authenticated;

comment on function public.expire_premium_listings() is
  'Daily sweep: deactivates premium_listings past end_date and clears any '
  'halls.premium_tier left set without a live listing behind it. Idempotent. '
  'Called by /api/admin/premium/expire-listings on Vercel Cron.';
