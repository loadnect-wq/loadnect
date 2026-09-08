-- 0069 — close two holes the launch audit found, both of which let a user write
-- a value the trusted backend is supposed to own.

-- ── 1. AN OWNER COULD DECLARE THEIR OWN PAYOUT ACCOUNT VERIFIED ─────────────
--
-- 0068 revoked UPDATE on the destination columns because they are "the
-- machine-readable destination of real money" — and left INSERT granted on the
-- whole table. guard_owner_payout_columns' INSERT branch was written for Easy
-- Split's vendor_* columns and never learned about the payout_beneficiary_*
-- columns 0068 added. So an owner creating their hall_owners row could set
-- payout_beneficiary_status = 'VERIFIED' themselves.
--
-- That value is the ONLY thing dispatchOwnerPayout checks before sending money
-- (lib/payout-dispatch.ts: refuses unless it reads VERIFIED), and
-- payout_beneficiary_id is what it sends the money TO. Self-declaring both is a
-- straight path from "create an owner account" to "receive a transfer".
create or replace function public.guard_owner_payout_columns()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if public.is_trusted_backend() or public.is_admin() then return new; end if;

  if tg_op = 'INSERT' then
    if new.cashfree_vendor_id is not null or new.vendor_synced_at is not null
       or new.vendor_last_error is not null
       or coalesce(new.is_verified, false) is distinct from false
       or new.verified_at is not null or new.verified_by is not null
       -- Added in 0069: the Payouts equivalents of the above.
       or new.payout_beneficiary_id is not null
       or new.payout_beneficiary_status is not null
       or new.payout_beneficiary_synced_at is not null
       or new.payout_beneficiary_last_error is not null then
      raise exception 'hall_owners: verification and payout account fields are set by Hallnect';
    end if;
    return new;
  end if;

  if new.cashfree_vendor_id is distinct from old.cashfree_vendor_id
     or new.vendor_kyc_status is distinct from old.vendor_kyc_status
     or new.vendor_synced_at  is distinct from old.vendor_synced_at
     or new.vendor_last_error is distinct from old.vendor_last_error
     -- Added in 0069. UPDATE on these was already revoked, but a grant can be
     -- restored by a later migration while this trigger keeps holding the line.
     or new.payout_beneficiary_id is distinct from old.payout_beneficiary_id
     or new.payout_beneficiary_status is distinct from old.payout_beneficiary_status
     or new.payout_beneficiary_synced_at is distinct from old.payout_beneficiary_synced_at then
    raise exception 'hall_owners: payout account fields are set by Hallnect, not directly';
  end if;
  return new;
end; $function$;

-- Grants are checked BEFORE row security and know nothing about triggers, so
-- this is the outer of the two layers.
--
-- A COLUMN-LEVEL REVOKE DOES NOTHING AGAINST A TABLE-LEVEL GRANT, which is how
-- this was written first and why it silently changed nothing:
-- `authenticated` held plain INSERT on hall_owners, and has_column_privilege
-- keeps answering true for every column while that grant stands. The table
-- grant has to go, and the columns an owner may legitimately write are then
-- granted back by name.
--
-- The list is exactly saveOwnerBusiness's payload. Every payout and
-- verification column is absent on purpose: savePayoutDetails writes those with
-- the service role after resolving the owner row from the session.
revoke insert on public.hall_owners from authenticated;
grant insert (
  profile_id, business_name, business_email, gst_number, address, city, state
) on public.hall_owners to authenticated;

-- ── 2. A REVIEW DID NOT HAVE TO BE ABOUT THE BOOKING IT CLAIMED ────────────
--
-- reviews_insert required only "you have SOME completed booking at this hall".
-- booking_id was never referenced, and it is nullable, so:
--   • omit it and the partial unique index (WHERE booking_id IS NOT NULL) does
--     not apply — one completed stay buys UNLIMITED reviews, each one moving
--     rating_average, which drives search ranking and the venue page;
--   • or supply a STRANGER'S booking id and permanently consume the one review
--     slot that person had.
-- 0066's guard_review_delete means the author cannot undo either, so cleanup is
-- admin-only.
drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    customer_id = auth.uid()
    and booking_id is not null
    and exists (
      select 1 from public.bookings b
      where b.id = reviews.booking_id
        and b.customer_id = auth.uid()
        and b.hall_id     = reviews.hall_id
        and b.status      = 'completed'
    )
  );

-- ── 3. Pin a mutable search_path flagged by the Supabase linter ────────────
-- A SECURITY DEFINER function without a pinned search_path can be steered by
-- the caller's search_path. This one computes the advisory-lock key that
-- serialises double-booking claims, so it is not a function to leave open.
alter function public.inventory_lock_key(uuid, date) set search_path to 'public';
