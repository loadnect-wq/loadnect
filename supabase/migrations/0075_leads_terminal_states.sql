-- ─────────────────────────────────────────────────────────────────────────────
-- 0075_leads_terminal_states.sql
--
-- FIXES A BUG SHIPPED IN 0073. leads_forwarded_is_verified was written as
--
--     check (status = 'awaiting_verification' or phone_verified)
--
-- to enforce RULE 2 — nothing reaches the venue before MSG91 confirms the
-- customer's number. It does enforce that. It also blocks two states that
-- forward nothing to anybody:
--
--   • 'cancelled' — the CUSTOMER withdrawing their own enquiry. cancelLead()
--     explicitly allows this from awaiting_verification, so a customer who
--     abandoned the OTP and then tapped Withdraw got a check violation, which
--     the action turned into "Could not withdraw this enquiry. Please try
--     again." — advice that could never work. Verified against production
--     before writing this: both terminal transitions raise 23514.
--
--   • 'expired' — the sweep in lib/lead-expiry.ts retiring an enquiry nobody
--     ever verified. Without this fix that row is immortal, and it holds its
--     slot in uq_lead_active for ever, so the same customer can never enquire
--     about that venue and date again.
--
-- THE RULE THE CONSTRAINT WAS ACTUALLY FOR is narrower than what it said: a
-- lead may not enter a state THE VENUE CAN SEE without a verified phone. The
-- venue-visible states are 'pending', 'confirmed' and 'rejected' — 'rejected'
-- included, because the venue can only decline something it was shown. Those
-- three still require phone_verified. The two terminal states that mean
-- "this never went anywhere" are now reachable.
--
-- RULE 2 IS NOT WEAKENED. leads_select still requires phone_verified for the
-- owner arm, so even a hand-crafted row in a wrong state stays invisible to
-- the venue. This migration only stops the database refusing writes that take
-- a lead further AWAY from the venue.
-- ─────────────────────────────────────────────────────────────────────────────

do $mig$
begin
  alter table public.leads drop constraint if exists leads_forwarded_is_verified;
  alter table public.leads
    add constraint leads_forwarded_is_verified
    check (
      status in ('awaiting_verification', 'cancelled', 'expired')
      or phone_verified
    );
end
$mig$;

comment on constraint leads_forwarded_is_verified on public.leads is
  'RULE 2 at the database: a lead may not enter a state the VENUE CAN SEE '
  '(pending, confirmed, rejected) unless the customer''s phone was verified by '
  'MSG91. The terminal states cancelled and expired forward nothing and are '
  'reachable from awaiting_verification — see migration 0075.';

-- ── Verify: the fix works, and the rule it exists for still holds ───────────
do $mig$
declare
  ownerA uuid;
  custX  uuid;
  v_hall uuid;
  v_lead uuid;

begin
  select id, profile_id into ownerA, custX from public.hall_owners limit 1;
  if ownerA is null then
    raise notice 'no hall_owners row - skipping behavioural verify';
    return;
  end if;

  insert into public.halls (owner_id, name, slug, city, capacity_max, price_per_day,
                            booking_mode, status, venue_types)
  values (ownerA, 'zz verify 0075', 'zz-verify-0075-'||substr(md5(random()::text),1,8),
          'Madurai', 10, null, 'LEAD_GENERATION', 'draft', array['wedding'])
  returning id into v_hall;

  insert into public.leads (hall_id, owner_id, customer_id, contact_name,
                            contact_phone, event_date)
  values (v_hall, ownerA, custX, 'zz', '+919999900099', current_date + 30)
  returning id into v_lead;

  -- The two transitions that were blocked must now work.
  update public.leads set status = 'cancelled' where id = v_lead;
  update public.leads set status = 'awaiting_verification' where id = v_lead;
  update public.leads set status = 'expired' where id = v_lead;
  update public.leads set status = 'awaiting_verification' where id = v_lead;

  -- RULE 2 must STILL be enforced for every venue-visible state.
  begin
    update public.leads set status = 'pending' where id = v_lead;
    raise exception 'RULE 2 BROKEN: an unverified lead reached pending';
  exception when check_violation then null;
  end;

  begin
    update public.leads set status = 'rejected' where id = v_lead;
    raise exception 'RULE 2 BROKEN: an unverified lead reached rejected';
  exception when check_violation then null;
  end;

  -- Undo everything this block created. Deliberately explicit rather than
  -- relying on a rollback: apply_migration commits.
  delete from public.leads where id = v_lead;
  delete from public.halls where id = v_hall;
end
$mig$;
