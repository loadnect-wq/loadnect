-- ─────────────────────────────────────────────────────────────────────────────
-- 0022_premium_listings_admin_write.sql
--
-- BUG: `premium_listings` had RLS enabled (0007) but only ONE policy —
-- `premium_select`. There was no INSERT or UPDATE policy at all, while
-- app/admin/actions.ts deliberately uses the SESSION client (anon key + admin
-- cookie), which does NOT bypass RLS.
--
-- Proven on the live database before the fix (probe rolled back):
--     admin INSERT -> 42501                     "Grant premium manually" failed
--     admin UPDATE -> 0 rows affected, NO error togglePremiumActive returned
--                                               { success: true } while
--                                               is_active never changed
--
-- The silent UPDATE is the dangerous half: an admin could not switch OFF a
-- premium boost (including one granted by mistake or being abused) and the UI
-- told them it had worked. A row filtered out by RLS is not an error in
-- Postgres — it simply affects zero rows — so `if (error)` never fires.
--
-- FIX: give admins an explicit write policy, matching the pattern already used
-- by commissions (commissions_admin_write) and advertisements (ads_write).
-- guard_premium_listing_writes (0013) stays as defence in depth.
--
-- Verified on the live database after applying (probe rolled back):
--     admin UPDATE rows=1 ........... ok   (was 0)
--     admin INSERT ok ............... ok   (was 42501)
--     non-admin owner INSERT blocked  ok   (security preserved)
--
-- Owners and customers still have no write path; premium_select is unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists premium_admin_write on public.premium_listings;
create policy premium_admin_write on public.premium_listings
  for all using (public.is_admin()) with check (public.is_admin());
