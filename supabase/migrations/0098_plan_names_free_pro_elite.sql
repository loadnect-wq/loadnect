-- ─────────────────────────────────────────────────────────────────────────────
-- 0098_plan_names_free_pro_elite.sql — the listing plans are named Free, Pro
-- and Elite.
--
-- NAMES AND ONE DESCRIPTION ONLY. Prices, durations, purchasability, slugs and
-- Cashfree plan ids are untouched:
--
--   slug      before     after    price          cf_plan_id (unchanged)
--   free      Free       Free     ₹0             —
--   premium   Premium    Pro      ₹4,999/month   hallnect_premium_monthly
--   pro       Pro        Elite    ₹9,999/month   hallnect_pro_monthly
--
-- WHY THE SLUGS STAY. They are stored in premium_listings.plan_slug (1 live
-- row), halls.premium_tier, the Cashfree subscription plan ids, the slug CHECK
-- and recompute_hall_premium(). Renaming them would orphan live entitlements
-- and subscriptions for a cosmetic change. The application maps slug → name in
-- lib/plan-names.ts (TIER_LABEL), which says the same words as this table.
--
-- Checked before applying: no database function reads premium_plans.name
-- (guard_plan_purchase_integrity reads the price only); 0 plan purchases.
--
-- ROLLBACK:
--   update public.premium_plans set name = 'Premium' where slug = 'premium';
--   update public.premium_plans set name = 'Pro',
--     description = 'Everything in Premium, plus homepage promotion and top placement above Premium listings in search.'
--     where slug = 'pro';
-- ─────────────────────────────────────────────────────────────────────────────

update public.premium_plans set name = 'Free'  where slug = 'free'    and name is distinct from 'Free';
update public.premium_plans set name = 'Pro'   where slug = 'premium' and name is distinct from 'Pro';
update public.premium_plans
   set name = 'Elite',
       description = 'Everything in Pro, plus homepage promotion and top placement above Pro listings in search.'
 where slug = 'pro';

do $verify$
begin
  if (select name from public.premium_plans where slug = 'premium') <> 'Pro'
     or (select name from public.premium_plans where slug = 'pro') <> 'Elite'
     or (select name from public.premium_plans where slug = 'free') <> 'Free' then
    raise exception '0098: plan names were not applied';
  end if;
  -- Prices must be exactly what they were.
  if (select monthly_price from public.premium_plans where slug = 'premium') <> 4999
     or (select monthly_price from public.premium_plans where slug = 'pro') <> 9999
     or (select monthly_price from public.premium_plans where slug = 'free') <> 0 then
    raise exception '0098: a plan price changed — this migration must only rename';
  end if;
end
$verify$;
