-- ─────────────────────────────────────────────────────────────────────────────
-- 0055_pin_per_party_booking_fields.sql — stop each party editing the other's
-- columns on a shared booking row.
--
-- bookings_update RLS is (customer_id = auth.uid() OR owns_hall(hall_id) OR
-- is_admin()). Both parties legitimately pass it for the SAME row, and 0046's
-- column grants are role-wide — `authenticated` either has UPDATE on a column
-- or it does not, with no way to say "the customer may write this one and the
-- owner may not". RLS is row-level and grants are role-level, so neither
-- mechanism can express a per-party column rule. The trigger can.
--
-- WHAT THIS CLOSES.
--
-- contact_phone was granted to authenticated deliberately in 0046: a customer
-- retrying checkout refreshes their own number, and a stale one sends
-- post-payment messages to the wrong person. But the grant reaches the OWNER
-- too, and since SMS went live that column decides WHERE BOOKING MESSAGES GO.
-- An owner could point a customer's confirmations, payment receipts and
-- cancellation notices at a number they control, and the customer would simply
-- stop hearing from Hallnect about their own booking — no error, no trace, and
-- the owner is the counterparty in any dispute that follows.
--
-- customer_notes is the same shape (the owner could rewrite what the customer
-- asked for), and owner_notes is the mirror: a customer editing it fabricates a
-- venue statement on their own record.
--
-- WHY "AND NOT ALSO THE OTHER PARTY". An owner booking their own hall is
-- legitimately both, and must keep their customer rights on that row. The
-- guards therefore fire only when the actor is one party and not the other.
--
-- Verified against production inside rolled-back transactions, impersonating
-- genuine non-admin accounts (an admin is is_admin() = trusted and exempt by
-- design, which made the first test subject useless):
--
--   owner    -> contact_phone   BLOCKED
--   owner    -> customer_notes  BLOCKED
--   owner    -> owner_notes     allowed   (no regression)
--   customer -> owner_notes     BLOCKED
--   customer -> contact_phone   allowed   (no regression)
--
-- Also adds the columns 0049 and 0052 introduced to the immutable list —
-- platform_fee_gst, gst_rate, terms_version, terms_accepted, terms_accepted_at.
-- They carry no client UPDATE grant, so this is defence in depth rather than a
-- live hole, but "what was bought and what it cost" now includes the tax
-- charged and the policy version accepted, and both belong on that list.

create or replace function public.validate_booking_transition()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  is_owner    boolean := public.owns_hall(new.hall_id);
  is_customer boolean := (new.customer_id = auth.uid());
  trusted     boolean := public.is_trusted_backend() or public.is_admin();
begin
  if trusted then
    return new;
  end if;

  if new.customer_id  is distinct from old.customer_id
     or new.hall_id   is distinct from old.hall_id
     or new.event_date is distinct from old.event_date
     or new.end_date   is distinct from old.end_date
     -- WHAT WAS BOUGHT is as immutable as what it cost. Without these three a
     -- customer could pay the morning rate then PATCH slot to 'full_day', or
     -- push owner_response_due_at out to defer the auto-cancel indefinitely.
     or new.slot                  is distinct from old.slot
     or new.guest_count           is distinct from old.guest_count
     or new.owner_response_due_at is distinct from old.owner_response_due_at
     or new.base_amount   is distinct from old.base_amount
     or new.platform_fee  is distinct from old.platform_fee
     or new.total_amount  is distinct from old.total_amount
     or new.advance_amount        is distinct from old.advance_amount
     or new.platform_fee_amount   is distinct from old.platform_fee_amount
     or new.platform_fee_gst      is distinct from old.platform_fee_gst
     or new.gst_rate              is distinct from old.gst_rate
     or new.customer_total_amount is distinct from old.customer_total_amount
     or new.commission_rate       is distinct from old.commission_rate
     or new.commission_amount     is distinct from old.commission_amount
     or new.owner_net_advance     is distinct from old.owner_net_advance
     or new.terms_version         is distinct from old.terms_version
     or new.terms_accepted        is distinct from old.terms_accepted
     or new.terms_accepted_at     is distinct from old.terms_accepted_at
     or new.coupon_id             is distinct from old.coupon_id
     or new.coupon_code           is distinct from old.coupon_code then
    raise exception 'Booking financial and identity fields are immutable';
  end if;

  -- The customer's columns are not the owner's to write. See the header.
  if is_owner and not is_customer then
    if new.contact_phone  is distinct from old.contact_phone
       or new.customer_notes is distinct from old.customer_notes then
      raise exception 'Not allowed: the customer''s contact details and notes are theirs to change';
    end if;
  end if;

  -- And the mirror.
  if is_customer and not is_owner then
    if new.owner_notes is distinct from old.owner_notes then
      raise exception 'Not allowed: venue notes are the venue''s to change';
    end if;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if is_customer and not is_owner then
    if not (
      (old.status = 'pending_payment'    and new.status = 'cancelled')
      or (old.status = 'payment_success' and new.status = 'cancelled')
      or (old.status = 'booking_requested' and new.status = 'cancelled')
      or (old.status = 'owner_confirmed' and new.status = 'cancelled')
    ) then
      raise exception
        'Customer cannot transition booking from % to %', old.status, new.status;
    end if;
    return new;
  end if;

  if is_owner then
    if not (
      (old.status = 'booking_requested' and new.status = 'owner_confirmed')
      or (old.status = 'booking_requested' and new.status = 'owner_rejected')
      or (old.status = 'owner_confirmed'  and new.status = 'completed')
    ) then
      raise exception
        'Owner cannot transition booking from % to %', old.status, new.status;
    end if;
    return new;
  end if;

  raise exception 'Not allowed: only customer, owner, or admin may transition this booking';
end;
$function$;
