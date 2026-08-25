-- ─────────────────────────────────────────────────────────────────────────────
-- 0032_hide_internal_commission_columns.sql
--
-- The 2.5% commission is an internal figure between Hallnect and the venue and
-- must never reach the customer. The app never renders it customer-side, but
-- RLS is ROW-level: a customer holding their own session token could read their
-- own booking row straight from the PostgREST API and see commission_amount,
-- commission_rate and owner_net_advance anyway.
--
-- Column privileges are what actually hide a column — and a table-wide
-- `grant select on bookings` covers every column, so a column-level REVOKE
-- against it is a silent no-op (verified: the first attempt changed nothing).
-- The blanket grant must be dropped and the allowed columns re-granted.
--
-- Safe for the app: every customer/owner/admin read uses an explicit column
-- list that excludes these three (checked in lib/customer.ts, lib/owner.ts,
-- lib/admin.ts, lib/availability.ts, lib/notifications/events.ts,
-- app/admin/actions.ts), and the owner/admin commission screens read from the
-- `commissions` table, which is untouched. The only `select("*")` calls on
-- bookings are in service-role modules (payments, settlement, owner-payout,
-- refunds).
--
-- FAIL-CLOSED: a column added to `bookings` later is NOT readable by clients
-- until it is granted. That is the right default for a financial table.
--
-- ROLLBACK: grant select on public.bookings to authenticated, anon;
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  cols text;
  hidden text[] := array['commission_amount','commission_rate','owner_net_advance'];
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'bookings'
    and column_name <> all (hidden);

  execute 'revoke select on public.bookings from authenticated, anon';
  execute format('grant select (%s) on public.bookings to authenticated', cols);
  execute format('grant select (%s) on public.bookings to anon', cols);
end $$;

-- The trusted backend keeps full column access.
grant select on public.bookings to service_role;

-- Writes were already impossible for clients: migration 0031 dropped the
-- bookings_insert policy, and validate_booking_transition() rejects any
-- customer/owner UPDATE that touches a financial column. These revokes make
-- that explicit at the privilege layer too.
revoke insert (commission_amount, commission_rate, owner_net_advance,
               advance_amount, platform_fee_amount, customer_total_amount)
  on public.bookings from authenticated, anon;

revoke update (commission_amount, commission_rate, owner_net_advance,
               advance_amount, platform_fee_amount, customer_total_amount)
  on public.bookings from authenticated, anon;
