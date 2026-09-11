-- ─────────────────────────────────────────────────────────────────────────────
-- 0085_coupon_cap_holds_at_payment.sql
--
-- A CAPPED COUPON COULD BE REDEEMED MORE TIMES THAN ITS CAP.
--
-- guard_booking_coupon_integrity counts redemptions only on INSERT, and counts
-- only bookings that are already PAID:
--     status in (payment_success, booking_requested, owner_confirmed, completed)
-- lib/coupons.ts:104-122 resolves it the same way. That is deliberate and it is
-- right — counting pending_payment holds would let anyone starve a capped
-- coupon by opening checkout and walking away.
--
-- The consequence is that while fewer than N bookings are PAID, the coupon
-- admits an unbounded number of pending holds. Each one passes the check at
-- INSERT because at that moment the paid count really is under the cap. When
-- the webhook then moves them to payment_success, the trigger's UPDATE branch
-- checks coupon IMMUTABILITY ONLY — it never re-counts — so every one of them
-- redeems.
--
-- A coupon with max_redemptions = 1 can therefore be used by as many customers
-- as reach the payment page inside the 20-minute hold window.
--
-- BOUNDED, WHICH IS WHY THIS IS LOW: the only coupon kind is
-- zero_platform_fee, one coupon_id per booking and immutable after creation, so
-- the exposure is Rs.200 per over-redemption and nothing else. No stacking, no
-- effect on the advance, no effect on commission.
--
-- THE FIX: re-count at the moment of redemption. The UPDATE branch now applies
-- the cap when a booking ENTERS the paid set and did not used to be in it —
-- which is exactly the transition that spends a redemption, and the first
-- moment the count can be correct.
--
-- Why here rather than in verifyAndApplyPayment: the webhook is not the only
-- writer, and a cap enforced in one caller is a cap the next caller forgets.
-- The trigger sees every path.
--
-- WHAT HAPPENS TO THE LOSER, and it is deliberately harsh in one direction
-- only: the UPDATE raises, so the webhook's booking transition fails and the
-- existing handling takes over — the capture is already recorded and the
-- booking stays pending_payment, which is the state the sweep and the refund
-- queue are built for. That is far better than the alternative of letting the
-- redemption through: a fee we said was waived and then charged is a dispute,
-- while a rare refused transition is a refund. NOTE that this makes the earlier
-- race visible instead of silent, which is the point.
--
-- The excluded self-row matters: `b.id <> new.id` stops a booking counting
-- ITSELF when it lands in the paid set, which would make the last legitimate
-- redemption fail.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.guard_booking_coupon_integrity()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  c          public.coupons%rowtype;
  used_count integer;
  adv numeric(12,2);
  fee numeric(12,2);
  gst numeric(12,2);
  tot numeric(12,2);
  fee_floor numeric(12,2);
  paid_states text[] := array['payment_success','booking_requested','owner_confirmed','completed'];
begin
  if tg_op = 'UPDATE' then
    if new.coupon_id     is distinct from old.coupon_id
       or new.coupon_code is distinct from old.coupon_code then
      raise exception 'bookings: coupon fields are immutable after creation';
    end if;

    -- THE REDEMPTION MOMENT. Entering the paid set is when a coupon is actually
    -- spent, and until 0085 nothing counted here at all.
    if new.coupon_id is not null
       and new.status::text = any(paid_states)
       and not (old.status::text = any(paid_states)) then
      select * into c from public.coupons where id = new.coupon_id;
      if found and c.max_redemptions is not null then
        select count(*) into used_count
          from public.bookings b
         where b.coupon_id = new.coupon_id
           and b.id <> new.id                      -- never count yourself
           and b.status::text = any(paid_states);
        if used_count >= c.max_redemptions then
          raise exception
            'bookings: coupon % has reached its redemption limit (% of %)',
            c.code, used_count, c.max_redemptions;
        end if;
      end if;
    end if;

    return new;
  end if;

  adv := new.advance_amount;
  fee := new.platform_fee_amount;
  -- Pre-0049 rows carry NULL and were charged advance + fee, so zero is the
  -- arithmetically correct substitute for them (migration 0077).
  gst := coalesce(new.platform_fee_gst, 0);
  tot := new.customer_total_amount;

  if adv is not null and fee is not null and tot is not null
     and round(tot, 2) is distinct from round(adv + fee + gst, 2) then
    raise exception
      'bookings: customer_total_amount % <> advance_amount % + platform_fee_amount % + platform_fee_gst %',
      tot, adv, fee, gst;
  end if;

  if adv is not null and new.commission_amount is not null
     and new.owner_net_advance is not null
     and round(adv, 2) is distinct from round(new.commission_amount + new.owner_net_advance, 2) then
    raise exception
      'bookings: advance_amount % <> commission_amount % + owner_net_advance %',
      adv, new.commission_amount, new.owner_net_advance;
  end if;

  -- The lowest fee this booking may legitimately carry without a coupon: the
  -- standard 200, or the 25%-of-advance ceiling when that is smaller. Mirrors
  -- cappedPlatformFeeRupees, floor-to-paise included (migration 0078).
  if fee is not null and new.coupon_id is null then
    fee_floor := least(200::numeric, floor(coalesce(adv, 0) * 25) / 100);
    if fee < fee_floor then
      raise exception
        'bookings: platform_fee_amount % is below the % chargeable on an advance of % and carries no coupon_id',
        fee, fee_floor, adv;
    end if;
  end if;

  if new.coupon_id is null then
    return new;
  end if;

  select * into c from public.coupons where id = new.coupon_id;

  if not found then
    raise exception 'bookings: unknown coupon';
  end if;
  if not c.is_active then
    raise exception 'bookings: coupon % is not active', c.code;
  end if;
  if c.expires_at is not null and now() >= c.expires_at then
    raise exception 'bookings: coupon % has expired', c.code;
  end if;
  if new.coupon_code is distinct from c.code then
    raise exception 'bookings: coupon_code % does not match coupon %', new.coupon_code, c.code;
  end if;
  if c.kind = 'zero_platform_fee' and coalesce(fee, -1) <> 0 then
    raise exception
      'bookings: coupon % waives the platform fee but platform_fee_amount is %', c.code, fee;
  end if;

  if c.max_redemptions is not null then
    select count(*) into used_count
      from public.bookings b
     where b.coupon_id = new.coupon_id
       and b.status::text = any(paid_states);
    if used_count >= c.max_redemptions then
      raise exception 'bookings: coupon % has reached its redemption limit', c.code;
    end if;
  end if;

  return new;
end;
$function$;

-- ── Verify ──────────────────────────────────────────────────────────────────
do $mig$
declare
  ownerA uuid; custX uuid; v_hall uuid; v_c uuid; b1 uuid; b2 uuid;
begin
  select id into ownerA from public.hall_owners limit 1;
  select id into custX  from public.profiles where role='customer' limit 1;
  if ownerA is null or custX is null then
    raise notice 'no owner/customer - skipping behavioural verify';
    return;
  end if;

  insert into public.halls (owner_id, name, slug, city, capacity_max, price_per_day,
                            booking_mode, commission_rate, status, venue_types)
  values (ownerA, 'zz verify 0085', 'zz-verify-0085-'||substr(md5(random()::text),1,8),
          'Madurai', 500, 100000, 'DIRECT_BOOKING', 2.5, 'approved', array['wedding'])
  returning id into v_hall;

  insert into public.coupons (code, kind, is_active, max_redemptions)
  values ('ZZ0085'||upper(substr(md5(random()::text),1,6)), 'zero_platform_fee', true, 1)
  returning id into v_c;

  -- TWO holds on a cap of one. Both are allowed to exist — that is the design.
  insert into public.bookings
    (hall_id, customer_id, event_date, end_date, slot, base_amount, platform_fee, total_amount,
     advance_amount, platform_fee_amount, platform_fee_gst, gst_rate, customer_total_amount,
     commission_rate, commission_amount, owner_net_advance, status, terms_accepted,
     coupon_id, coupon_code)
  values (v_hall, custX, current_date+140, current_date+140, 'full_day', 100000, 0, 100000,
          25000, 0, 0, 18, 25000, 2.5, 2500, 22500, 'pending_payment', true,
          v_c, (select code from public.coupons where id = v_c))
  returning id into b1;

  insert into public.bookings
    (hall_id, customer_id, event_date, end_date, slot, base_amount, platform_fee, total_amount,
     advance_amount, platform_fee_amount, platform_fee_gst, gst_rate, customer_total_amount,
     commission_rate, commission_amount, owner_net_advance, status, terms_accepted,
     coupon_id, coupon_code)
  values (v_hall, custX, current_date+141, current_date+141, 'full_day', 100000, 0, 100000,
          25000, 0, 0, 18, 25000, 2.5, 2500, 22500, 'pending_payment', true,
          v_c, (select code from public.coupons where id = v_c))
  returning id into b2;

  -- The FIRST to pay redeems it.
  update public.bookings set status = 'payment_success' where id = b1;

  -- The SECOND must now be refused. Before 0085 it succeeded silently.
  begin
    update public.bookings set status = 'payment_success' where id = b2;
    raise exception 'GUARD FAILED: a capped coupon was redeemed twice';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'GUARD FAILED%' then raise; end if;
    if sqlerrm not like '%redemption limit%' then
      raise exception 'GUARD FAILED: refused by % - not by the cap', sqlerrm;
    end if;
  end;

  -- And the winner must not have been blocked by counting itself.
  if (select status from public.bookings where id = b1)::text <> 'payment_success' then
    raise exception 'GUARD FAILED: the first redemption did not go through';
  end if;

  delete from public.availability where hall_id = v_hall;
  delete from public.bookings where hall_id = v_hall;
  delete from public.halls where id = v_hall;
  delete from public.coupons where id = v_c;
end
$mig$;
