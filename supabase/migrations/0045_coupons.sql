-- ─────────────────────────────────────────────────────────────────────────────
-- 0045_coupons.sql — customer-entered codes that WAIVE the ₹200 PLATFORM FEE.
--
-- The platform fee is Hallnect's own revenue, collected ON TOP of the advance
-- and never deducted from the venue. Zeroing it costs Hallnect ₹200 and costs
-- the owner nothing.
--
-- WHAT THIS DOES NOT DO, DELIBERATELY:
--   • It does NOT touch commission. Commission is 2.5% of the FULL HALL PRICE,
--     retained out of the advance, invisible to the customer, and the venue's
--     side of the split. A coupon that reached it would silently reprice every
--     owner payout. Check (b) in guard_booking_coupon_integrity() enforces that
--     the advance still splits exactly into commission + owner_net_advance.
--   • It does NOT expose the coupons table to clients. There is no anon/
--     authenticated SELECT policy and the default Supabase grants are revoked,
--     so the live code list cannot be enumerated through PostgREST.
--   • It does NOT add per-customer or per-hall restrictions. The ask was
--     "any hall". The column layout leaves room for a partial unique on
--     (coupon_id, customer_id) later.
--   • It does NOT add column-level INSERT/UPDATE revokes on bookings. anon and
--     authenticated hold TABLE-level INSERT/UPDATE, and a column-level REVOKE
--     against a table-level grant is a silent no-op — 0032's own header
--     documents that trap. Immutability comes from the triggers below instead.
--
-- ROLLBACK:
--   drop trigger if exists trg_booking_coupon_integrity on public.bookings;
--   drop function if exists public.guard_booking_coupon_integrity();
--   drop function if exists public.coupon_usage(uuid);
--   alter table public.bookings drop column if exists coupon_id,
--                               drop column if exists coupon_code;
--   drop table if exists public.coupons;
--   -- and re-apply the 0031 body of validate_booking_transition().
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The catalogue ─────────────────────────────────────────────────────────

create table if not exists public.coupons (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,

  -- What the coupon does. One member today; the column exists so a future
  -- percentage discount is a new VALUE rather than a new nullable amount column
  -- that every reader would then have to guard.
  kind            text not null default 'zero_platform_fee'
                    check (kind in ('zero_platform_fee')),

  description     text,

  -- THE OFF SWITCH. "Until I stop it" is this going false.
  is_active       boolean not null default true,

  -- OPTIONAL, NULL by default. NULL = unlimited / never expires.
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  expires_at      timestamptz,

  created_by      uuid references public.profiles(id) on delete set null,
  stopped_at      timestamptz,
  stopped_by      uuid references public.profiles(id) on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint coupons_code_canonical check (code = upper(code)),
  -- 8–24 chars. The floor is 8, NOT 3: the coupon preview action is an
  -- un-rate-limited online oracle, and a 3-character code over a 37-symbol
  -- alphabet is only ~46k candidates. MUST stay identical to couponCodeSchema
  -- in lib/validation/schemas.ts and COUPON_CODE_PATTERN in lib/coupons.ts.
  constraint coupons_code_format
    check (code ~ '^[A-Z0-9][A-Z0-9-]{7,23}$'),
  constraint coupons_description_len
    check (description is null or char_length(description) <= 500)
);

-- Case-insensitivity lives in coupons_code_canonical, so this index is exact:
-- 'hall2026' cannot be stored at all, so it can never coexist with 'HALL2026'.
create unique index if not exists uq_coupons_code on public.coupons (code);
create index if not exists idx_coupons_active on public.coupons (is_active);

comment on table public.coupons is
  'Customer-entered promotional codes. The only kind today waives the flat ₹200 '
  'platform fee; the commission split with the venue is never affected.';
comment on column public.coupons.code is
  'Canonical UPPERCASE; normalised in TS before lookup.';
comment on column public.coupons.max_redemptions is
  'NULL = unlimited. When set, counts PAID bookings only (see the trigger).';
comment on column public.coupons.expires_at is
  'NULL = never expires — a coupon is stopped with is_active, not a date.';

alter table public.coupons enable row level security;

-- Supabase grants table-level SELECT/INSERT/UPDATE/DELETE to anon and
-- authenticated on every new public table. RLS would block them anyway;
-- defence in depth: take the grants away and re-grant only what the
-- RLS-gated admin path needs.
revoke all on public.coupons from anon, authenticated;
grant all on public.coupons to service_role;
grant select, insert, update on public.coupons to authenticated;

drop policy if exists coupons_admin_write on public.coupons;
create policy coupons_admin_write on public.coupons
  for all using (public.is_admin()) with check (public.is_admin());

drop trigger if exists trg_coupons_updated_at on public.coupons;
create trigger trg_coupons_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();

-- ── 2. How a booking records the coupon it used ──────────────────────────────

alter table public.bookings
  add column if not exists coupon_id   uuid references public.coupons(id) on delete set null,
  add column if not exists coupon_code text;

create index if not exists idx_bookings_coupon on public.bookings (coupon_id)
  where coupon_id is not null;

comment on column public.bookings.coupon_id is
  'Coupon applied at booking creation. NULL = no coupon, never a sentinel. '
  'Immutable after insert (guard_booking_coupon_integrity + '
  'validate_booking_transition).';
comment on column public.bookings.coupon_code is
  'Snapshot of the code at creation, so a receipt survives the coupon row being '
  'deleted (the FK is on delete set null).';

-- ⚠ MIGRATION 0032 TRAP: 0032 dropped the table-wide SELECT grant on bookings
-- and re-granted an enumerated column list, so a column added later is NOT
-- readable by clients until granted here. The coupon code is customer-facing —
-- they typed it — so it IS granted, unlike the internal commission columns.
grant select (coupon_id, coupon_code) on public.bookings to authenticated, anon;

-- ── 3. Usage counting (admin display only) ───────────────────────────────────

create or replace function public.coupon_usage(_coupon_id uuid)
returns table (held integer, paid integer)
language plpgsql stable security definer set search_path = public
as $$
begin
  -- is_admin() keys off auth.uid() and therefore survives the SECURITY DEFINER
  -- switch. is_trusted_backend() does NOT — it reads current_user, which under
  -- a DEFINER function becomes the function owner, making every caller look
  -- trusted (0006 documents this). It is deliberately absent here. The
  -- server-side resolver counts directly with the service-role client instead
  -- of calling this.
  if not public.is_admin() then
    raise exception 'coupon_usage: not permitted';
  end if;

  return query
    select
      count(*) filter (
        where b.status = 'pending_payment'
          and (b.expires_at is null or b.expires_at > now())
      )::int,
      count(*) filter (
        where b.status in ('payment_success','booking_requested','owner_confirmed','completed')
      )::int
    from public.bookings b
    where b.coupon_id = _coupon_id;
end;
$$;

revoke all on function public.coupon_usage(uuid) from public, anon;
grant execute on function public.coupon_usage(uuid) to authenticated;

comment on function public.coupon_usage(uuid) is
  '(held, paid) counts for a coupon. Admin-only; raises for anyone else.';

-- ── 4. Financial integrity guard ─────────────────────────────────────────────
-- Precedent: guard_plan_purchase_integrity (0040).

create or replace function public.guard_booking_coupon_integrity()
returns trigger
language plpgsql set search_path = public
as $$
declare
  c          public.coupons%rowtype;
  used_count integer;
  adv numeric(12,2);
  fee numeric(12,2);
  tot numeric(12,2);
begin
  -- UPDATE: the coupon fields are frozen for EVERYONE, including admin and the
  -- service role. validate_booking_transition() exempts trusted callers
  -- wholesale, so this is the only layer that binds them.
  if tg_op = 'UPDATE' then
    if new.coupon_id     is distinct from old.coupon_id
       or new.coupon_code is distinct from old.coupon_code then
      raise exception 'bookings: coupon fields are immutable after creation';
    end if;
    return new;
  end if;

  -- Everything below is INSERT-only ON PURPOSE. The six money columns are
  -- already immutable post-insert, so re-asserting their arithmetic on every
  -- status transition buys nothing and would permanently brick any row whose
  -- columns ever went out of sync by a paisa.
  adv := new.advance_amount;
  fee := new.platform_fee_amount;
  tot := new.customer_total_amount;

  -- (a) advance + platformFee === customerTotal, checked independently of the app.
  if adv is not null and fee is not null and tot is not null
     and round(tot, 2) is distinct from round(adv + fee, 2) then
    raise exception
      'bookings: customer_total_amount % <> advance_amount % + platform_fee_amount %',
      tot, adv, fee;
  end if;

  -- (b) THE ONE THAT MATTERS: a coupon must never reach the owner's money.
  if adv is not null and new.commission_amount is not null
     and new.owner_net_advance is not null
     and round(adv, 2) is distinct from round(new.commission_amount + new.owner_net_advance, 2) then
    raise exception
      'bookings: advance_amount % <> commission_amount % + owner_net_advance %',
      adv, new.commission_amount, new.owner_net_advance;
  end if;

  -- (c) Any REDUCED fee (not only zero) needs a coupon behind it. The 200 here
  --     mirrors PLATFORM_FEE_RUPEES in lib/booking-payment.ts — change both
  --     together.
  if fee is not null and fee < 200 and new.coupon_id is null then
    raise exception
      'bookings: platform_fee_amount % below the standard fee requires a coupon_id', fee;
  end if;

  if new.coupon_id is null then
    return new;
  end if;

  -- No FOR UPDATE. With one sitewide coupon an unconditional row lock would
  -- serialise every checkout in the system behind a single row inside the
  -- booking transaction, and an admin pressing Stop would queue behind them all.
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

  -- PAID statuses only. Counting live pending holds would let one signed-in
  -- user create N free holds and deny a capped coupon to everyone for 20
  -- minutes, repeatably — creating a pending booking costs nothing and
  -- pending_payment is excluded from uq_booking_active_slot, so the holds do
  -- not even conflict with each other. The cost of counting paid only is a
  -- bounded overshoot at the boundary, at ₹200 each.
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
$$;

revoke all on function public.guard_booking_coupon_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_booking_coupon_integrity on public.bookings;
create trigger trg_booking_coupon_integrity
  before insert or update on public.bookings
  for each row execute function public.guard_booking_coupon_integrity();

-- ── 5. Coupon fields join the 0031 immutable set ─────────────────────────────
-- The 0031 body verified verbatim against production with pg_get_functiondef
-- before this was written, re-emitted here with the two coupon clauses added.
-- create or replace swaps the body wholesale, so any drift would be silently
-- reverted — re-check before applying this to a database other than the one it
-- was authored against.

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
     or new.owner_net_advance     is distinct from old.owner_net_advance
     or new.coupon_id             is distinct from old.coupon_id
     or new.coupon_code           is distinct from old.coupon_code then
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

-- Without this, PostgREST returns PGRST204 for coupon_id until its cache
-- reloads — the exact window in which a coupon insert would otherwise fail.
notify pgrst, 'reload schema';
