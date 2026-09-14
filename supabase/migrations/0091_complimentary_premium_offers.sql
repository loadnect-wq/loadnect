-- ─────────────────────────────────────────────────────────────────────────────
-- 0091_complimentary_premium_offers.sql — an admin can grant Premium or Pro at
-- no charge, alongside the paid subscription system rather than instead of it.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHY THIS EXTENDS premium_listings INSTEAD OF ADDING A NEW TABLE
-- ════════════════════════════════════════════════════════════════════════════
-- recompute_hall_premium() already decides a hall's tier from "is there an
-- active premium_listings row, inside its date window, with this plan_slug" —
-- it never looks at payment_id. expire_premium_listings() already retires a row
-- past its end_date and recomputes the hall, plus a belt-and-braces sweep for
-- any hall carrying a tier with no live listing behind it.
-- guard_premium_listing_writes() already refuses every writer that is not an
-- admin or the trusted backend, and premium_admin_write is already the policy.
--
-- So a complimentary grant IS a premium listing nobody paid for. Putting it in
-- this table means the entitlement logic, the expiry sweep, the overlap check
-- and the public badge all work with NO new code — which is what the brief
-- asks for in three separate places: "use the existing plan entitlement
-- system", "integrate with it rather than creating a competing system", and
-- "do not blindly create duplicate tables or columns". A dedicated
-- complimentary_premium_offers table would have required reimplementing all
-- four, and the two copies would drift the first time a plan changed.
--
-- IT ALSO MAKES THE HARD SCENARIOS FREE. A paid-Premium owner given a
-- complimentary Pro gets a SECOND ROW. The paid row is untouched — no
-- overwrite, no lost billing history — and recompute_hall_premium prefers 'pro'
-- while it is live. When the complimentary window closes, the sweep deactivates
-- only that row and the hall falls back to 'premium' on its own. Scenarios C
-- and D in the brief need no special case at all; this was probed against the
-- live database before shipping.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT STOPS A GIVEAWAY BECOMING A FAKE SALE
-- ════════════════════════════════════════════════════════════════════════════
-- premium_listings_complimentary_is_free refuses any complimentary row that
-- carries a payment_id, a plan_purchase_id or a non-zero amount, and requires a
-- named granting admin. The application refuses the same thing, so it is caught
-- at the keystroke AND at the table.
--
-- Revenue is unaffected by construction: every revenue figure reads
-- plan_purchases where status = 'paid', never premium_listings.amount.
--
-- ROLLBACK:
--   alter table public.premium_listings
--     drop constraint if exists premium_listings_complimentary_is_free,
--     drop constraint if exists premium_listings_grant_type_allowed,
--     drop column if exists revoked_by,   drop column if exists revoked_at,
--     drop column if exists grant_reason, drop column if exists granted_by,
--     drop column if exists grant_type;
--   drop index if exists idx_premium_listings_grant_type;
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.premium_listings
  add column if not exists grant_type   text not null default 'paid',
  add column if not exists granted_by   uuid references public.profiles(id) on delete set null,
  add column if not exists grant_reason text,
  add column if not exists revoked_at   timestamptz,
  add column if not exists revoked_by   uuid references public.profiles(id) on delete set null;

comment on column public.premium_listings.grant_type is
  'paid = bought through Cashfree; complimentary = granted by an admin at no charge. Never counted as revenue (revenue reads plan_purchases).';

-- Existing rows default to 'paid', which is what they are. The DEFAULT also
-- means the Cashfree webhook keeps inserting 'paid' with no change to that path.
alter table public.premium_listings
  drop constraint if exists premium_listings_grant_type_allowed;
alter table public.premium_listings
  add constraint premium_listings_grant_type_allowed
  check (grant_type in ('paid', 'complimentary'));

-- A COMPLIMENTARY LISTING MUST NEVER LOOK LIKE A PAYMENT. Enforced by the
-- database rather than trusted to the caller, because "do not fake a
-- transaction" and "do not add fake revenue" are the two rules here with money
-- on the other side of them.
alter table public.premium_listings
  drop constraint if exists premium_listings_complimentary_is_free;
alter table public.premium_listings
  add constraint premium_listings_complimentary_is_free
  check (
    grant_type <> 'complimentary'
    or (payment_id is null and plan_purchase_id is null and amount = 0 and granted_by is not null)
  );

-- Supports the offer history and its filters, and the overlap check on grant.
create index if not exists idx_premium_listings_grant_type
  on public.premium_listings (grant_type, is_active, end_date desc);

notify pgrst, 'reload schema';

-- ── Self-verification ───────────────────────────────────────────────────────
do $verify$
begin
  if (select count(*) from public.premium_listings where grant_type <> 'paid') > 0 then
    raise exception '0091: existing listings were not left as paid';
  end if;
  -- The entitlement function must be untouched: it is what makes a
  -- complimentary grant work at all, and a change here would be a change to
  -- every PAID listing too.
  if pg_get_functiondef('public.recompute_hall_premium(uuid)'::regprocedure) not like '%plan_slug  = ''pro''%' then
    raise exception '0091: recompute_hall_premium changed unexpectedly';
  end if;
end
$verify$;
