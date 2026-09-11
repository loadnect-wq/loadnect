-- ─────────────────────────────────────────────────────────────────────────────
-- 0077_coupon_guard_counts_gst.sql
--
-- DIRECT BOOKING HAS BEEN IMPOSSIBLE SINCE GST SHIPPED. This is not a hardening
-- item; it is a total, silent outage of the primary revenue path, found by the
-- VAPT panel and reproduced independently against production before this fix.
--
-- guard_booking_coupon_integrity() (migration 0045) asserts:
--
--     customer_total_amount = advance_amount + platform_fee_amount
--
-- Migration 0049 then introduced platform_fee_gst and made the customer total
-- INCLUDE the tax — lib/booking-payment.ts:348 computes
-- customerTotalPaise = advancePaise + feePaise + gstPaise, and
-- app/book/[slug]/actions.ts writes that value. 0049 updated the booking
-- transition guard and never touched this one, so the two halves of the schema
-- have disagreed about what a customer total IS ever since.
--
-- The arithmetic, for the one live hall at Rs.1,00,000/day:
--     advance 25000 + fee 200 + gst 36 = 25236     (what the app writes)
--     advance 25000 + fee 200          = 25200     (what the trigger demands)
-- Every standard booking therefore raises P0001 and rolls back. The customer
-- sees only the sanitised failure string; the real reason is server-side only.
--
-- THE CRUEL DETAIL: the only bookings that COULD be created were coupon
-- bookings, because a fee-waiving coupon sets fee = 0, which makes gst = 0,
-- which makes the broken equality hold. So the path that works is the
-- discounted one, and the full-price path — the one that earns money — is the
-- one that fails.
--
-- REPRODUCED (rolled back, production): inserting the exact row the booking
-- action writes gives
--   'bookings: customer_total_amount 25236.00 <> advance_amount 25000.00 +
--    platform_fee_amount 200.00'
-- and the identical row with platform_fee_gst = 0 inserts cleanly, isolating
-- the tax term as the sole cause.
--
-- WHY NOBODY NOTICED: production holds zero bookings. That was read as "nothing
-- has been exercised yet"; it is at least partly "nothing CAN be".
--
-- The whole function is re-emitted verbatim with one clause changed, following
-- the 0045 precedent — a targeted ALTER is not available for a function body,
-- and re-emitting keeps the reviewed text in one place.
--
-- coalesce(platform_fee_gst, 0) is deliberate and is not merely null-safety:
-- rows written before 0049 carry NULL there and were genuinely charged
-- advance + fee, so zero is the arithmetically correct substitute for them.
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
begin
  if tg_op = 'UPDATE' then
    if new.coupon_id     is distinct from old.coupon_id
       or new.coupon_code is distinct from old.coupon_code then
      raise exception 'bookings: coupon fields are immutable after creation';
    end if;
    return new;
  end if;

  adv := new.advance_amount;
  fee := new.platform_fee_amount;
  -- THE FIX. Pre-0049 rows have NULL here and were charged advance + fee, so
  -- zero is the right value for them, not a guess.
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

  if fee is not null and fee < 200 and new.coupon_id is null then
    raise exception
      'bookings: platform_fee_amount % below the standard fee requires a coupon_id', fee;
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
       and b.status in ('payment_success','booking_requested','owner_confirmed','completed');
    if used_count >= c.max_redemptions then
      raise exception 'bookings: coupon % has reached its redemption limit', c.code;
    end if;
  end if;

  return new;
end;
$function$;

-- ── Verify: the standard booking now works, and every other invariant the
--    guard enforces still bites. No exception handler around the assertions.
do $mig$
declare
  ownerA uuid;
  custX  uuid;
  v_hall uuid;
  v_b    uuid;
begin
  select id into ownerA from public.hall_owners limit 1;
  select id into custX  from public.profiles where role = 'customer' limit 1;
  if ownerA is null or custX is null then
    raise notice 'no owner/customer - skipping behavioural verify';
    return;
  end if;

  insert into public.halls (owner_id, name, slug, city, capacity_max, price_per_day,
                            booking_mode, commission_rate, status, venue_types)
  values (ownerA, 'zz verify 0077', 'zz-verify-0077-'||substr(md5(random()::text),1,8),
          'Madurai', 500, 100000, 'DIRECT_BOOKING', 2.5, 'approved', array['wedding'])
  returning id into v_hall;

  -- 1. THE ROW THE APP ACTUALLY WRITES must now insert.
  insert into public.bookings
    (hall_id, customer_id, event_date, end_date, slot, base_amount, platform_fee, total_amount,
     advance_amount, platform_fee_amount, platform_fee_gst, gst_rate, customer_total_amount,
     commission_rate, commission_amount, owner_net_advance, status, terms_accepted)
  values (v_hall, custX, current_date + 90, current_date + 90, 'full_day', 100000, 200, 100000,
          25000, 200, 36, 18, 25236,
          2.5, 2500, 22500, 'pending_payment', true)
  returning id into v_b;

  delete from public.availability where hall_id = v_hall;
  delete from public.bookings where id = v_b;

  -- 2. A GENUINELY WRONG TOTAL must still be refused — the guard must not have
  --    been loosened into uselessness.
  begin
    insert into public.bookings
      (hall_id, customer_id, event_date, end_date, slot, base_amount, platform_fee, total_amount,
       advance_amount, platform_fee_amount, platform_fee_gst, gst_rate, customer_total_amount,
       commission_rate, commission_amount, owner_net_advance, status, terms_accepted)
    values (v_hall, custX, current_date + 91, current_date + 91, 'full_day', 100000, 200, 100000,
            25000, 200, 36, 18, 1,
            2.5, 2500, 22500, 'pending_payment', true);
    raise exception 'GUARD FAILED: a wrong customer_total_amount was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'GUARD FAILED%' then raise; end if;
  end;

  -- 3. The commission split invariant must still bite.
  begin
    insert into public.bookings
      (hall_id, customer_id, event_date, end_date, slot, base_amount, platform_fee, total_amount,
       advance_amount, platform_fee_amount, platform_fee_gst, gst_rate, customer_total_amount,
       commission_rate, commission_amount, owner_net_advance, status, terms_accepted)
    values (v_hall, custX, current_date + 92, current_date + 92, 'full_day', 100000, 200, 100000,
            25000, 200, 36, 18, 25236,
            2.5, 9999, 22500, 'pending_payment', true);
    raise exception 'GUARD FAILED: a broken commission split was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'GUARD FAILED%' then raise; end if;
  end;

  -- 4. A sub-standard fee without a coupon must still be refused.
  begin
    insert into public.bookings
      (hall_id, customer_id, event_date, end_date, slot, base_amount, platform_fee, total_amount,
       advance_amount, platform_fee_amount, platform_fee_gst, gst_rate, customer_total_amount,
       commission_rate, commission_amount, owner_net_advance, status, terms_accepted)
    values (v_hall, custX, current_date + 93, current_date + 93, 'full_day', 100000, 200, 100000,
            25000, 0, 0, 18, 25000,
            2.5, 2500, 22500, 'pending_payment', true);
    raise exception 'GUARD FAILED: a waived fee without a coupon was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'GUARD FAILED%' then raise; end if;
  end;

  delete from public.availability where hall_id = v_hall;
  delete from public.halls where id = v_hall;
end
$mig$;
