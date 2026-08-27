-- ─────────────────────────────────────────────────────────────────────────────
-- 0042 — plan_purchases: use the owns_owner_row() helper, like every other
-- owner-scoped policy in this schema.
--
-- 0040 wrote the ownership test as a raw subquery against hall_owners. That
-- subquery is itself subject to hall_owners' RLS, so the policy only works for
-- as long as an owner can SELECT their own hall_owners row. It can today — but
-- RLS failing to a subquery of zero rows is silent, and the failure mode is an
-- owner who simply cannot see the plan they just paid for, with no error
-- anywhere.
--
-- owns_owner_row() is STABLE SECURITY DEFINER, so it answers the same question
-- without depending on another table's policies. It is what the rest of the
-- schema already uses.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists plan_purchases_owner_select on public.plan_purchases;
create policy plan_purchases_owner_select on public.plan_purchases
  for select
  using (public.owns_owner_row(owner_id));
