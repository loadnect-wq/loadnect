-- ─────────────────────────────────────────────────────────────────────────────
-- 0078_fee_floor_respects_the_cap.sql
--
-- THE SECOND HALF OF 0077, and the same shape of bug: two rules written at
-- different times, each correct alone, contradicting each other in the one
-- place they meet.
--
-- Check (c) of guard_booking_coupon_integrity refuses any booking whose
-- platform_fee_amount is below a hard-coded 200 unless a coupon is present —
-- reasonable when the fee was always exactly 200.
--
-- lib/booking-payment.ts:96-115 then introduced PLATFORM_FEE_MAX_PERCENT_OF_
-- ADVANCE = 25 and applies it UNCONDITIONALLY at :318, because a flat 200 fee
-- stops being a fee and starts being the price on a small booking. So a legit
-- small booking now produces a fee below 200 with no coupon anywhere near it,
-- and the trigger rejects it.
--
-- WHO THIS LOCKED OUT. The cap binds when 25% of the advance is under 200, i.e.
-- advance < 800. At the live 25% advance rate that is any hall priced under
-- 3,200/day — and MIN_HALL_PRICE_RUPEES (lib/validation/schemas.ts:119) lets an
-- owner list from 2,000. Every venue in the 2,000–3,199 band was unsellable.
-- Half-day rates have no floor at all, so a cheap morning slot on ANY venue hit
-- the same wall. Reproduced (rolled back): a 3,000 booking is refused with
-- 'platform_fee_amount 187.50 below the standard fee requires a coupon_id'.
--
-- Invisible until now because 0077's defect rejected every booking first.
--
-- THE FIX: the floor becomes the SAME number the application computes, not a
-- constant that was true once. A reduced fee is refused only when it is below
-- BOTH the standard fee and the advance-derived ceiling.
--
-- ON THE TWO 25s — they are NOT the same quantity and must not be merged:
--   • PLATFORM_FEE_MAX_PERCENT_OF_ADVANCE = 25  — the fee may not exceed a
--     quarter of the ADVANCE. That is the one used here.
--   • platform_settings.default_advance_percentage = 25 — the advance is a
--     quarter of the HALL PRICE. Not used here at all.
-- They coincide today at 25 and would silently swap meanings if either moved.
-- This trigger reads `adv` from the row, so it needs only the first and never
-- has to guess how the advance was derived.
--
-- The floor arithmetic mirrors cappedPlatformFeeRupees exactly, including the
-- floor-to-paise: JS does Math.floor(advancePaise * 2500 / 10000), i.e.
-- floor(advance_in_paise * 0.25). In rupees that is floor(adv * 25) / 100. A
-- rounding difference of one paisa here would reject a booking the application
-- considers perfectly formed, which is the whole failure being fixed.
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

  -- THE FIX. The lowest fee this booking may legitimately carry without a
  -- coupon: the standard 200, or the 25%-of-advance ceiling when that is
  -- smaller. Mirrors cappedPlatformFeeRupees, floor-to-paise included.
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
       and b.status in ('payment_success','booking_requested','owner_confirmed','completed');
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
  ownerA uuid; custX uuid; v_hall uuid; v_b uuid;
begin
  select id into ownerA from public.hall_owners limit 1;
  select id into custX  from public.profiles where role = 'customer' limit 1;
  if ownerA is null or custX is null then
    raise notice 'no owner/customer - skipping behavioural verify';
    return;
  end if;

  insert into public.halls (owner_id, name, slug, city, capacity_max, price_per_day,
                            booking_mode, commission_rate, status, venue_types)
  values (ownerA, 'zz verify 0078', 'zz-verify-0078-'||substr(md5(random()::text),1,8),
          'Madurai', 500, 3000, 'DIRECT_BOOKING', 2.5, 'approved', array['wedding'])
  returning id into v_hall;

  -- 1. THE BUDGET VENUE. 3,000/day -> advance 750, capped fee 187.50, gst 33.75.
  --    This is exactly what the application computes and it must now insert.
  insert into public.bookings
    (hall_id, customer_id, event_date, end_date, slot, base_amount, platform_fee, total_amount,
     advance_amount, platform_fee_amount, platform_fee_gst, gst_rate, customer_total_amount,
     commission_rate, commission_amount, owner_net_advance, status, terms_accepted)
  values (v_hall, custX, current_date + 95, current_date + 95, 'full_day', 3000, 187.50, 3000,
          750, 187.50, 33.75, 18, 971.25,
          2.5, 75, 675, 'pending_payment', true)
  returning id into v_b;
  delete from public.availability where hall_id = v_hall;
  delete from public.bookings where id = v_b;

  -- 2. A FEE BELOW THE CEILING still needs a coupon — the floor moved, it did
  --    not disappear.
  begin
    insert into public.bookings
      (hall_id, customer_id, event_date, end_date, slot, base_amount, platform_fee, total_amount,
       advance_amount, platform_fee_amount, platform_fee_gst, gst_rate, customer_total_amount,
       commission_rate, commission_amount, owner_net_advance, status, terms_accepted)
    values (v_hall, custX, current_date + 96, current_date + 96, 'full_day', 3000, 1, 3000,
            750, 1, 0.18, 18, 751.18,
            2.5, 75, 675, 'pending_payment', true);
    raise exception 'GUARD FAILED: a fee under the ceiling was accepted without a coupon';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'GUARD FAILED%' then raise; end if;
  end;

  -- 3. A FULL-PRICE venue still requires the whole 200.
  begin
    insert into public.bookings
      (hall_id, customer_id, event_date, end_date, slot, base_amount, platform_fee, total_amount,
       advance_amount, platform_fee_amount, platform_fee_gst, gst_rate, customer_total_amount,
       commission_rate, commission_amount, owner_net_advance, status, terms_accepted)
    values (v_hall, custX, current_date + 97, current_date + 97, 'full_day', 100000, 150, 100000,
            25000, 150, 27, 18, 25177,
            2.5, 2500, 22500, 'pending_payment', true);
    raise exception 'GUARD FAILED: 150 was accepted on a 25000 advance without a coupon';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'GUARD FAILED%' then raise; end if;
  end;

  -- 4. And 0077's fix must still hold.
  insert into public.bookings
    (hall_id, customer_id, event_date, end_date, slot, base_amount, platform_fee, total_amount,
     advance_amount, platform_fee_amount, platform_fee_gst, gst_rate, customer_total_amount,
     commission_rate, commission_amount, owner_net_advance, status, terms_accepted)
  values (v_hall, custX, current_date + 98, current_date + 98, 'full_day', 100000, 200, 100000,
          25000, 200, 36, 18, 25236,
          2.5, 2500, 22500, 'pending_payment', true)
  returning id into v_b;
  delete from public.availability where hall_id = v_hall;
  delete from public.bookings where id = v_b;

  delete from public.availability where hall_id = v_hall;
  delete from public.halls where id = v_hall;
end
$mig$;
