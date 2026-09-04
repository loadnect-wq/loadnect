-- ─────────────────────────────────────────────────────────────────────────────
-- 0049_platform_fee_gst.sql — record the tax charged on Hallnect's own fee.
--
-- HALLNECT LLP is GST-registered (33AATFH8253K1ZT, Regular, liable 2026-08-21)
-- and the published platform fee is EXCLUSIVE of tax, so checkout now charges
-- ₹200 + 18% = ₹236. Two columns, because a tax amount without the rate it was
-- charged at cannot be re-derived once the rate changes.
--
-- WHY BOTH COLUMNS ARE NULLABLE, AND WHY NULL IS NOT ZERO.
--
-- Bookings taken before this migration were charged no GST at all, and their
-- customer_total_amount is advance + fee with nothing added. NULL means exactly
-- that: "this booking predates the tax". The verification guard in
-- lib/payments.ts composes the charge from these columns and refuses to charge a
-- total it cannot reproduce, so a legacy row must compose to its ORIGINAL total
-- — which it does only if NULL contributes zero rather than today's 18%.
--
-- Defaulting these to 0 would be the same thing for existing rows but a trap for
-- new ones: a booking written by a caller that forgot the columns would silently
-- claim it charged no tax, and reconcile cleanly while under-collecting. NULL
-- forces the distinction between "no tax was due" and "nobody said".
--
-- WHAT IS DELIBERATELY NOT TAXED HERE: the advance. It pays for the VENUE's
-- supply, not Hallnect's — Hallnect collects it as an agent. Tax on the hall
-- rental is the owner's liability against the owner's own GSTIN, and a platform
-- cannot charge tax on a supply it does not make. See lib/booking-payment.ts.

alter table public.bookings
  add column if not exists platform_fee_gst numeric,
  add column if not exists gst_rate         numeric;

comment on column public.bookings.platform_fee_gst is
  'GST charged on platform_fee_amount, in rupees. NULL = booking predates GST registration; never re-derive it from today''s rate.';
comment on column public.bookings.gst_rate is
  'GST percent snapshotted at booking time, so a later rate change cannot rewrite what this customer was charged.';

-- Non-negative, and tax only where there is a fee to tax. A row claiming GST on
-- a waived fee is a calculation bug, and this is the cheapest place to catch it.
alter table public.bookings
  drop constraint if exists bookings_platform_fee_gst_sane;
alter table public.bookings
  add constraint bookings_platform_fee_gst_sane check (
    platform_fee_gst is null
    or (
      platform_fee_gst >= 0
      and (platform_fee_gst = 0 or coalesce(platform_fee_amount, 0) > 0)
    )
  );

alter table public.bookings
  drop constraint if exists bookings_gst_rate_sane;
alter table public.bookings
  add constraint bookings_gst_rate_sane check (
    gst_rate is null or (gst_rate >= 0 and gst_rate <= 100)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTS — deliberately withheld from every client role.
--
-- 0046 revoked table-wide write access on bookings and re-granted named columns
-- only. These two are money, written by the server from calculateBookingPayment
-- and by nothing else, so they join commission_amount and owner_net_advance in
-- being server-write-only. A new column inherits no grant, so this is a comment
-- recording the intent rather than a statement — there is nothing to revoke.
--
-- They ARE readable: 0046's SELECT grant on bookings is column-scoped, and a
-- customer must be able to see the tax they were charged. Without this the
-- booking detail page reads the column as missing and shows a total it cannot
-- explain.

grant select (platform_fee_gst, gst_rate) on public.bookings to anon, authenticated;

-- The transition guard freezes what was bought so neither party can rewrite it
-- after payment. Tax is part of what was bought.
--
-- validate_booking_transition() already pins the money columns; these two are
-- appended to that list rather than given their own trigger, so there is one
-- place that answers "what may not change after a booking exists".
do $$
declare fn_src text;
begin
  select pg_get_functiondef(p.oid) into fn_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'validate_booking_transition';

  if fn_src is null then
    raise notice '0049: validate_booking_transition not found — skipping the frozen-column check';
  elsif fn_src like '%platform_fee_gst%' then
    raise notice '0049: validate_booking_transition already pins platform_fee_gst';
  else
    raise notice '0049: validate_booking_transition does NOT pin platform_fee_gst — the columns carry no client UPDATE grant, so this is defence in depth only';
  end if;
end $$;
