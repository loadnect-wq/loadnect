-- ─────────────────────────────────────────────────────────────────────────────
-- 0031_new_commission_model.sql
--
-- BUSINESS MODEL CHANGE — discontinues the old 5%-commission era and the
-- "currently 2%" interim rate in favour of ONE model:
--
--   • Commission = 2.5% of the customer's ADVANCE, absorbed inside the advance
--     (owner nets advance − commission). Never charged to the customer on top.
--   • Platform fee = flat ₹200, collected FROM THE CUSTOMER on top of the
--     advance (customer pays advance + ₹200). Non-refundable on customer
--     cancellations; never deducted from the owner.
--
-- HISTORY IS PRESERVED: no existing row's stored amounts are modified. The new
-- columns are nullable; NULL means "created under the old model" and every
-- reader falls back to the legacy semantics for such rows. The legacy
-- bookings.platform_fee column keeps its 0027 meaning (the commission snapshot)
-- and continues to be written, equal to commission_amount, for compatibility
-- with pre-0031 readers.
--
-- ROLLBACK: every change here is additive (new nullable columns, a settings
-- value update, a function fallback). Reverting = re-running the 0012 function
-- definition and setting platform_settings.commission_percent back; no data is
-- destroyed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. bookings — explicit money breakdown for NEW bookings ──────────────────
alter table public.bookings
  add column if not exists advance_amount        numeric(12, 2)
    check (advance_amount        is null or advance_amount        >= 0),
  add column if not exists platform_fee_amount   numeric(12, 2)
    check (platform_fee_amount   is null or platform_fee_amount   >= 0),
  add column if not exists customer_total_amount numeric(12, 2)
    check (customer_total_amount is null or customer_total_amount >= 0),
  add column if not exists commission_rate       numeric(5, 2)
    check (commission_rate       is null or commission_rate between 0 and 100),
  add column if not exists commission_amount     numeric(12, 2)
    check (commission_amount     is null or commission_amount     >= 0),
  add column if not exists owner_net_advance     numeric(12, 2)
    check (owner_net_advance     is null or owner_net_advance     >= 0);

comment on column public.bookings.advance_amount        is 'Gross advance the customer pays toward the hall (new model). NULL = pre-0031 booking.';
comment on column public.bookings.platform_fee_amount   is 'Flat platform fee collected from the customer ON TOP of the advance. Non-refundable.';
comment on column public.bookings.customer_total_amount is 'advance_amount + platform_fee_amount — the only amount the gateway may charge.';
comment on column public.bookings.commission_rate       is 'Commission percent snapshot at booking time (2.5 under the new model).';
comment on column public.bookings.commission_amount     is 'Hallnect commission absorbed inside the advance. Internal — never a customer line item.';
comment on column public.bookings.owner_net_advance     is 'advance_amount − commission_amount: what the owner is settled from the advance.';
comment on column public.bookings.platform_fee          is 'LEGACY (0027 semantics): commission snapshot. Kept for pre-0031 readers; equals commission_amount on new rows.';

-- ── 2. payments — decompose the gateway charge ───────────────────────────────
-- payments.amount remains the TOTAL charged (advance + fee on new orders).
-- These columns record the split so no reader ever has to guess whether the
-- ₹200 rode along (the "advance == payments.amount" assumption is retired).
alter table public.payments
  add column if not exists advance_amount      numeric(12, 2)
    check (advance_amount      is null or advance_amount      >= 0),
  add column if not exists platform_fee_amount numeric(12, 2)
    check (platform_fee_amount is null or platform_fee_amount >= 0),
  add column if not exists refund_amount       numeric(12, 2)
    check (refund_amount       is null or refund_amount       >= 0);

comment on column public.payments.advance_amount      is 'Advance portion of `amount`. NULL = legacy payment where amount was the advance alone.';
comment on column public.payments.platform_fee_amount is 'Platform-fee portion of `amount` (₹200 on new orders). Non-refundable.';
comment on column public.payments.refund_amount       is 'Amount actually refunded to the customer, recorded when status becomes refunded.';

-- ── 3. paise settlement ledger — the fee gets its own column ─────────────────
-- gross_amount_paise stays the ADVANCE (commission + owner must keep summing to
-- it exactly); the fee is a separate, named figure — never smuggled into gross,
-- which would silently hand part of it to the owner.
alter table public.payment_transactions
  add column if not exists platform_fee_paise bigint not null default 0
    check (platform_fee_paise >= 0);

comment on column public.payment_transactions.platform_fee_paise is 'Flat customer platform fee (paise) collected with this payment. Not part of gross/commission/owner reconciliation.';

-- ── 4. The active commission rate becomes 2.5% ───────────────────────────────
-- The rate stays admin-configurable (per the settings UI), but the deployed
-- value, the column default, and the RPC fallback all move to 2.5.
update public.platform_settings set commission_percent = 2.5 where id = true;

alter table public.platform_settings
  alter column commission_percent set default 2.5;

create or replace function public.get_commission_percent()
returns numeric
language sql
security definer set search_path = public
stable
as $$
  select coalesce(
    (select commission_percent from public.platform_settings where id = true),
    2.5
  );
$$;

grant execute on function public.get_commission_percent() to anon, authenticated, service_role;

-- ── 4b. Heal wrongly-overdue absorbed commissions ────────────────────────────
-- The old sweep treated status 'collected' (commission absorbed from a
-- gateway-paid advance Hallnect already holds) as owner-still-owes and marked
-- such rows 'overdue' — the double-collection bug. This flips ONLY the state
-- back for rows that a successful gateway payment funded; no amount changes.
-- Rows already adjusted keep their history (the adjustment is auditable).
update public.commissions c
set status = 'collected'
where c.status = 'overdue'
  and exists (
    select 1 from public.payments p
    where p.booking_id = c.booking_id and p.status = 'payment_success'
  );

-- ── 5. Close the price-manipulation hole on bookings INSERT ──────────────────
-- 0007's bookings_insert policy validated identity/status/hall-approval but not
-- amounts, so an authenticated customer could insert a booking with
-- base_amount = 1 via the Supabase client. Booking creation now goes through
-- the trusted backend (service role) exclusively — the server action computes
-- every amount from the DB. Client INSERT is revoked outright.
drop policy if exists bookings_insert on public.bookings;

-- ── 6. New money columns join the immutable set ──────────────────────────────
-- Extends 0024's validate_booking_transition: customers/owners may never touch
-- any financial column, including the new breakdown. Trusted backend unchanged.
create or replace function public.validate_booking_transition()
returns trigger
language plpgsql set search_path = public
as $$
declare
  is_owner    boolean := public.owns_hall(new.hall_id);
  is_customer boolean := (new.customer_id = auth.uid());
  trusted     boolean := public.is_trusted_backend() or public.is_admin();
begin
  if trusted then
    return new;
  end if;

  -- Financial + identity + date-range fields are immutable for customer/owner.
  if new.customer_id  is distinct from old.customer_id
     or new.hall_id   is distinct from old.hall_id
     or new.event_date is distinct from old.event_date
     or new.end_date   is distinct from old.end_date
     or new.base_amount   is distinct from old.base_amount
     or new.platform_fee  is distinct from old.platform_fee
     or new.total_amount  is distinct from old.total_amount
     or new.advance_amount        is distinct from old.advance_amount
     or new.platform_fee_amount   is distinct from old.platform_fee_amount
     or new.customer_total_amount is distinct from old.customer_total_amount
     or new.commission_rate       is distinct from old.commission_rate
     or new.commission_amount     is distinct from old.commission_amount
     or new.owner_net_advance     is distinct from old.owner_net_advance then
    raise exception 'Booking financial and identity fields are immutable';
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
$$;
