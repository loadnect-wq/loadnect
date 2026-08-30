-- ─────────────────────────────────────────────────────────────────────────────
-- 0046_lock_privileged_columns.sql — stop a signed-in user editing the columns
-- that decide placement, reputation, payouts, and what was bought.
--
-- WHY: migration 0032 column-locked SELECT on `bookings`, but nothing ever
-- locked WRITES on `halls` or `hall_owners`. anon and authenticated hold
-- TABLE-WIDE INSERT/UPDATE/DELETE/TRUNCATE on halls, bookings, hall_owners and
-- payments, so RLS is the only thing between a user and those columns — and
-- `halls_update` is `(owns_hall(id) OR is_admin())` with no column restriction.
--
-- The three holes this closes, all reachable with the public anon key any
-- visitor can read out of the page source, using nothing but a normal login:
--
--   1. PLACEMENT AND REPUTATION. An approved owner PATCHes their own hall with
--      {is_premium:true, premium_tier:'pro', rating_average:5, rating_count:742}
--      and is permanently top of every search with a fabricated rating — free,
--      beside owners who are paying for that placement. Nothing recomputes it
--      back: recompute_hall_premium fires only from premium_listings, and
--      recalc_hall_rating only from reviews.
--
--   2. WHAT WAS BOUGHT. validate_booking_transition() froze the sixteen money
--      and identity columns but NOT slot, guest_count or owner_response_due_at.
--      A customer pays the morning rate, PATCHes slot to 'full_day', and the
--      owner is handed a full-day booking against a morning advance. Pushing
--      owner_response_due_at out also defers the auto-cancel indefinitely.
--
--   3. PAYOUT IDENTITY. hall_owners.cashfree_vendor_id / vendor_kyc_status
--      decide where money is sent. The server writes them on the owner's
--      behalf; the owner must never set them directly.
--
-- Two independent layers, because either alone has a known failure mode:
--   • REVOKE the table-wide write grants and re-grant per column. This is the
--     real fix — a column-level GRANT means nothing while the table-level grant
--     stands. 0032's header documents that trap for SELECT; it applies to
--     INSERT and UPDATE identically.
--   • BEFORE INSERT OR UPDATE triggers that refuse the change outright. These
--     survive a future migration that re-adds a table-wide grant, and they fail
--     loudly instead of silently no-op'ing.
--
-- THE TRIGGERS COVER INSERT, NOT JUST UPDATE. A column-restricted UPDATE grant
-- alone still leaves INSERT open: an owner may legitimately create a hall, and
-- without an insert check could create one that is *already* premium with a
-- fabricated rating. On insert the privileged columns must equal their
-- defaults.
--
-- Trusted callers (service role / admin) are exempt via is_trusted_backend()
-- and is_admin(), exactly as validate_booking_transition() already does, so
-- every legitimate server path is unaffected.
--
-- ALSO HERE (same blast radius, all small):
--   • REVOKE EXECUTE on cleanup_expired_pending_bookings() from anon and
--     authenticated. It is SECURITY DEFINER and unscoped — it cancels EVERY
--     expired pending_payment row platform-wide, so any signed-in user could
--     fire it and cancel other customers' holds. The other two sweeps are
--     already revoked; this one was missed.
--   • A partial UNIQUE index making a second successful capture on one booking
--     impossible at the database rather than merely unlikely in the app.
--
-- ROLLBACK:
--   drop trigger if exists trg_guard_hall_privileged_columns on public.halls;
--   drop trigger if exists trg_guard_owner_payout_columns on public.hall_owners;
--   drop function if exists public.guard_hall_privileged_columns();
--   drop function if exists public.guard_owner_payout_columns();
--   drop index if exists uq_payment_success_per_booking;
--   grant insert, update, delete on public.halls, public.bookings,
--     public.hall_owners, public.payments to anon, authenticated;
--   -- and re-apply the 0045 body of validate_booking_transition().
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. halls: placement, reputation and moderation are not the owner's ───────

create or replace function public.guard_hall_privileged_columns()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Must start at the column defaults. A new listing is never premium and
    -- has no reviews yet.
    if coalesce(new.is_premium, false) is distinct from false
       or new.premium_tier is not null
       or coalesce(new.rating_average, 0) is distinct from 0
       or coalesce(new.rating_count, 0)   is distinct from 0 then
      raise exception
        'halls: a new listing cannot start premium or pre-rated';
    end if;
    if new.moderated_at is not null
       or new.moderated_by is not null
       or new.rejection_reason is not null then
      raise exception 'halls: moderation fields are admin-only';
    end if;
    return new;
  end if;

  if new.is_premium        is distinct from old.is_premium
     or new.premium_tier   is distinct from old.premium_tier
     or new.rating_average is distinct from old.rating_average
     or new.rating_count   is distinct from old.rating_count then
    raise exception
      'halls: placement and rating are set by Hallnect, not by the owner';
  end if;

  if new.moderated_at        is distinct from old.moderated_at
     or new.moderated_by     is distinct from old.moderated_by
     or new.rejection_reason is distinct from old.rejection_reason then
    raise exception 'halls: moderation fields are admin-only';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_hall_privileged_columns() from public, anon, authenticated;

drop trigger if exists trg_guard_hall_privileged_columns on public.halls;
create trigger trg_guard_hall_privileged_columns
  before insert or update on public.halls
  for each row execute function public.guard_hall_privileged_columns();

-- ── 2. hall_owners: verification and payout identity are server-written ──────

create or replace function public.guard_owner_payout_columns()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.cashfree_vendor_id is not null
       or new.vendor_synced_at is not null
       or new.vendor_last_error is not null
       or coalesce(new.is_verified, false) is distinct from false
       or new.verified_at is not null
       or new.verified_by is not null then
      raise exception
        'hall_owners: verification and payout account fields are set by Hallnect';
    end if;
    return new;
  end if;

  if new.cashfree_vendor_id  is distinct from old.cashfree_vendor_id
     or new.vendor_kyc_status is distinct from old.vendor_kyc_status
     or new.vendor_synced_at  is distinct from old.vendor_synced_at
     or new.vendor_last_error is distinct from old.vendor_last_error then
    raise exception
      'hall_owners: payout account fields are set by Hallnect, not directly';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_owner_payout_columns() from public, anon, authenticated;

drop trigger if exists trg_guard_owner_payout_columns on public.hall_owners;
create trigger trg_guard_owner_payout_columns
  before insert or update on public.hall_owners
  for each row execute function public.guard_owner_payout_columns();

-- ── 3. Take back the table-wide write grants ─────────────────────────────────
-- The column lists below are exactly what the owner and customer server
-- actions write through the SESSION client (updateHall, upsertOwnerProfile,
-- connectPayoutAccount, cancelBooking). Anything the SERVICE ROLE writes needs
-- no grant here — service_role bypasses these entirely.
--
-- DELETE and TRUNCATE are not re-granted to anyone: nothing in the app deletes
-- these rows from a client, and bookings.hall_id is ON DELETE RESTRICT
-- precisely so paid history cannot be removed.

revoke insert, update, delete, truncate on public.halls        from anon, authenticated;
revoke insert, update, delete, truncate on public.bookings     from anon, authenticated;
revoke insert, update, delete, truncate on public.hall_owners  from anon, authenticated;
revoke insert, update, delete, truncate on public.payments     from anon, authenticated;

-- halls — an owner creates and edits their listing's descriptive fields.
-- Money, placement, rating, moderation and ownership are absent by design; the
-- trigger above is the backstop on INSERT.
grant insert on public.halls to authenticated;
grant update (
  name, slug, description, city, state, address, pincode,
  capacity_min, capacity_max, price_per_day, price_morning, price_evening,
  venue_types, updated_at
) on public.halls to authenticated;

-- bookings — creation is service-role only (0031 revoked the client INSERT
-- policy). A customer or owner may only move the status machine, which
-- validate_booking_transition() polices.
-- contact_phone is included: a retried checkout refreshes the customer's own
-- number on their own row through the session client, and a stale number sends
-- post-payment messages to the wrong person. expires_at is NOT included — that
-- write is service-role, and a client-writable expiry would let a customer
-- extend their own hold on a slot indefinitely.
grant update (status, cancel_reason, customer_notes, owner_notes, contact_phone, updated_at)
  on public.bookings to authenticated;

-- hall_owners — business profile and payout bank details, both written by the
-- owner through session-client server actions. Verification and vendor id are
-- excluded and additionally trigger-guarded.
grant insert on public.hall_owners to authenticated;
grant update (
  business_name, business_email, business_phone, gst_number, pan_number,
  address, city, state, payout_upi,
  payout_account_number, payout_ifsc, payout_account_holder, updated_at
) on public.hall_owners to authenticated;

-- payments — written ONLY by the server (webhook, verification, refunds).
-- No client write grant is restored at all.

-- ── 4. The platform-wide sweep is not callable by a signed-in user ───────────
revoke execute on function public.cleanup_expired_pending_bookings()
  from anon, authenticated, public;

-- ── 5. One successful capture per booking, enforced by the database ──────────
-- A retry after a transient gateway error can capture twice; the second row
-- lands payment_success with refund_state 'none', so it sits outside the refund
-- queue and is invisible on the customer's booking page (which reads one
-- payment row). Make it impossible rather than unlikely.
create unique index if not exists uq_payment_success_per_booking
  on public.payments (booking_id)
  where status = 'payment_success';

notify pgrst, 'reload schema';
