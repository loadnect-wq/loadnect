-- ─────────────────────────────────────────────────────────────────────────────
-- 0048_restore_moderation_writes.sql — 0046 locked two doors that were in use.
--
-- 0046 was right to revoke table-wide UPDATE on halls, hall_owners and
-- payments. But a column GRANT is checked BEFORE row security and knows nothing
-- about is_admin(), so re-granting only the descriptive columns did not merely
-- stop attackers — it stopped the product. Verified against production:
--
--   has_column_privilege('authenticated','public.halls','status','UPDATE')
--     -> false
--
-- and every listing state change runs through the session client, i.e. as
-- `authenticated`. So:
--
--   • submitHallForApproval  (owner: draft/rejected -> pending_approval)  42501
--   • moderateHall           (admin: -> approved/rejected/suspended)      42501
--   • verifyOwnerRow         (admin: hall_owners.is_verified)             42501
--   • markPayoutSettledManually (admin: payments.split_status)            42501
--
-- The catalogue could not grow past the listings that were already approved
-- when 0046 shipped, from either end: an owner could not submit and an admin
-- could not approve. Nothing surfaced it because these are separate code paths
-- from the reads, and 0046 shipped with no listing moving through the queue.
--
-- TWO DIFFERENT FIXES, because these are two different situations.
--
-- 1. halls.status is written by a NON-ADMIN in normal use — the owner moving
--    their own draft into the review queue. That write must stay under RLS, so
--    it needs the grant back. It is safe to give back because the privileged
--    VALUES are already policed by trg_prevent_hall_self_approve, which raises
--    unless is_trusted_backend() or is_admin():
--
--      new.status in ('approved','rejected','suspended') -> admin only
--
--    and halls_update RLS still restricts the owner to their own rows. So an
--    owner regains exactly one transition: their own hall, into the queue.
--
-- 2. Everything else on that list is written ONLY by an admin. Those need no
--    grant at all — the server actions move to the service-role client behind
--    requireAdminActor(), the pattern issueRefund already uses. Least privilege
--    is kept: no client role can write moderation, verification or split state
--    under any policy.
--
-- Column-level grants are invisible to RLS reasoning. When a write fails with
-- 42501 and the RLS policy plainly allows it, check has_column_privilege first.

grant update (status) on public.halls to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- reviews — the one table 0046 never touched, and the only one still open.
--
-- reviews_update is USING/WITH CHECK ((customer_id = auth.uid()) OR is_admin())
-- with no column restriction, and anon/authenticated hold table-wide UPDATE.
-- Verified against production: has_column_privilege on both is_visible and
-- hall_id returned true. The completed-booking proof that reviews_insert
-- enforces is NOT re-checked on UPDATE. So an author, with nothing but their
-- own login and the public anon key, can:
--
--   • PATCH {is_visible:true} and undo an admin's moderation. toggleReviewVisible
--     was hardened in app code for exactly this, but a server action is not the
--     only door — PostgREST is reachable directly.
--   • PATCH {hall_id:'<any other hall>'} and move their review onto a venue
--     they never booked. recalc_hall_rating() is SECURITY DEFINER, so it
--     rewrites halls.rating_average straight past guard_hall_privileged_columns
--     — a 1-star review planted on a competitor, or a 5-star on themselves.
--
-- No client ever legitimately updates a review: there is no edit-your-review
-- feature, only insert and delete. So the grant goes entirely, and admin
-- moderation moves to the service-role client with the others.

revoke update on public.reviews from anon, authenticated;

-- The revoke alone closes it today. The trigger is the backstop, so that a
-- future migration handing back UPDATE cannot silently re-open it — the same
-- shape as guard_hall_privileged_columns and guard_owner_payout_columns.

create or replace function public.guard_review_privileged_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if public.is_trusted_backend() or public.is_admin() then return new; end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_visible, true) is distinct from true then
      raise exception 'reviews: visibility is set by Hallnect';
    end if;
    return new;
  end if;

  -- Who wrote it, what it is attached to, and whether it is shown are not the
  -- author's to change after the fact.
  if new.is_visible  is distinct from old.is_visible
     or new.hall_id     is distinct from old.hall_id
     or new.customer_id is distinct from old.customer_id
     or new.booking_id  is distinct from old.booking_id then
    raise exception 'reviews: moderation and attribution are admin-only';
  end if;
  return new;
end; $function$;

drop trigger if exists trg_guard_review_privileged_columns on public.reviews;
create trigger trg_guard_review_privileged_columns
  before insert or update on public.reviews
  for each row execute function public.guard_review_privileged_columns();
