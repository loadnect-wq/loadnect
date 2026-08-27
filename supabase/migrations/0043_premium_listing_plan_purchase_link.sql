-- ─────────────────────────────────────────────────────────────────────────────
-- 0043 — Make plan activation exactly-once, by construction.
--
-- THE BUG (found in review of 0040). verifyAndApplyPlanPurchase claimed the
-- purchase with a status-guarded update (status 'created' -> 'paid') and only
-- THEN created the listing. If that second step failed — a lock wait on the
-- halls row the sync trigger updates, a statement timeout, a transient
-- PostgREST 5xx — the row was left status='paid' with premium_listing_id NULL,
-- and NOTHING could recover it: the claim now matched zero rows, so every retry
-- (webhook redelivery, the owner reloading the status page) fell through to
-- "already paid" and returned success without re-attempting activation. The
-- owner was charged Rs9,999, given nothing, and told "Your plan is active".
--
-- Simply retrying was not safe either: a NULL premium_listing_id could also
-- mean the listing WAS created and only the link-back write failed, so a naive
-- retry would grant a second full duration for free.
--
-- The fix is to stop relying on the link-back write at all. The listing now
-- carries the purchase that paid for it, with a UNIQUE index, so activation can
-- be retried freely: the second attempt either finds the row it already created
-- or is rejected by the constraint. One purchase can never produce two
-- listings, whatever fails and whenever it is retried.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.premium_listings
  add column if not exists plan_purchase_id uuid
    references public.plan_purchases(id) on delete set null;

-- Exactly-once: at most one listing per purchase. Partial, because
-- admin-granted listings legitimately have no purchase behind them.
create unique index if not exists uq_premium_listings_plan_purchase
  on public.premium_listings (plan_purchase_id)
  where plan_purchase_id is not null;

comment on column public.premium_listings.plan_purchase_id is
  'The plan_purchases row that paid for this listing. NULL for listings granted '
  'by an admin. UNIQUE where present, which is what makes activation safe to '
  'retry after a partial failure — see migration 0043.';
