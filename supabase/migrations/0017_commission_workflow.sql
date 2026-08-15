-- ─────────────────────────────────────────────────────────────────────────────
-- 0017_commission_workflow.sql
-- Advance-booking + owner-commission + UPI-payment + auto-settlement-adjustment.
--
-- This migration is ADDITIVE and IDEMPOTENT. It never drops columns or data.
-- It extends the existing `commissions` and `platform_settings` tables (do NOT
-- create the duplicate `commission_records` / `platform_payment_settings` tables
-- named in the brief — the existing ones already serve those roles) and adds two
-- new tables: `owner_commission_payments` (manual UPI submissions) and
-- `owner_settlement_adjustments` (auto-deduction from the owner payout).
--
-- CUSTOMER-SAFETY INVARIANT (do not violate in any future change):
--   Nothing in this workflow ever mutates bookings.* amounts or any customer
--   record. An unpaid commission is recovered ONLY by an owner_settlement_
--   adjustment that reduces what Hallnect releases to the OWNER. The customer's
--   advance always remains recorded as paid toward their booking.
--
-- SECURITY MODEL (layered, matching the rest of the schema):
--   • RLS: owner sees only their own rows; customer sees none; admin sees all.
--   • Guard triggers: owners may SUBMIT a UPI payment but can NEVER self-mark it
--     verified/paid, and can never write settlement adjustments. Only an admin or
--     the trusted backend (service-role) can verify a payment or apply an
--     adjustment. This is defense-in-depth on top of RLS.
--   • Idempotency: owner_settlement_adjustments.commission_id is UNIQUE, so the
--     auto-adjustment can never deduct twice for the same commission.
-- ─────────────────────────────────────────────────────────────────────────────

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. Extend the commission_status enum with the workflow states               ║
-- ║    (existing values: pending, collected, paid_out, refunded)                ║
-- ║    ADD VALUE IF NOT EXISTS is safe to re-run. In Supabase/PG15 these commit  ║
-- ║    with the surrounding statement; the new values are NOT used as literals   ║
-- ║    elsewhere in THIS migration, so no "unsafe use of new enum value" error.  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter type commission_status add value if not exists 'paid';
alter type commission_status add value if not exists 'overdue';
alter type commission_status add value if not exists 'payment_submitted';
alter type commission_status add value if not exists 'payment_under_review';
alter type commission_status add value if not exists 'rejected';
alter type commission_status add value if not exists 'adjusted_from_owner_settlement';
alter type commission_status add value if not exists 'waived';
alter type commission_status add value if not exists 'disputed';

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1b. Record the customer's terms acceptance on the booking                   ║
-- ║     (advance/cancellation/remaining-balance consent). Nullable + additive.  ║
-- ║     No customer amount is ever changed by this workflow — these columns are  ║
-- ║     consent metadata only.                                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.bookings
  add column if not exists terms_accepted     boolean not null default false,
  add column if not exists terms_accepted_at  timestamptz;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. Extend `commissions` with the fields the brief requires                  ║
-- ║    (booking_id, hall_owner_id, hall_id, booking_amount, commission_rate,    ║
-- ║     commission_amount, owner_payout_amount, status already exist)           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.commissions
  add column if not exists customer_id             uuid references public.profiles (id) on delete set null,
  add column if not exists advance_amount          numeric(12, 2) check (advance_amount is null or advance_amount >= 0),
  add column if not exists due_date                timestamptz,
  add column if not exists paid_at                 timestamptz,
  add column if not exists payment_method          text,
  add column if not exists payment_reference       text,
  add column if not exists payment_screenshot_url  text,
  add column if not exists admin_note              text,
  -- Denormalised marker so the owner dashboard can show "adjusted" without a
  -- join. Mirrors commissions.status transitions but is a plain text flag.
  add column if not exists settlement_adjustment_status text
    check (settlement_adjustment_status is null
           or settlement_adjustment_status in ('none','adjusted','reversed'));

-- Backfill due_date for any pre-existing commission rows (created_at + 7 days).
update public.commissions
   set due_date = created_at + interval '7 days'
 where due_date is null;

-- Backfill customer_id from the linked booking.
update public.commissions c
   set customer_id = b.customer_id
  from public.bookings b
 where c.booking_id = b.id
   and c.customer_id is null;

create index if not exists idx_commissions_due_date on public.commissions (due_date);

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. Extend `platform_settings` with payment / advance / feature-flag config  ║
-- ║    (single-row table; commission_percent already exists)                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.platform_settings
  add column if not exists hallnect_upi_id                text,
  add column if not exists hallnect_upi_qr_url            text,
  add column if not exists commission_due_days            integer not null default 7
    check (commission_due_days between 1 and 90),
  add column if not exists default_advance_percentage     numeric(5, 2) not null default 20
    check (default_advance_percentage between 0 and 100),
  add column if not exists enable_online_customer_payment boolean not null default false,
  add column if not exists enable_owner_upi_payment       boolean not null default true,
  add column if not exists enable_auto_commission_adjustment boolean not null default false;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. Public-safe settings reader (SECURITY DEFINER)                           ║
-- ║    platform_settings RLS is admin-only. Owners need the UPI id/QR to pay,   ║
-- ║    and the booking flow needs the advance % + enable flags. This returns    ║
-- ║    ONLY the non-sensitive fields (never commission_percent, never           ║
-- ║    updated_by) to any authenticated caller, without exposing the row.       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.get_public_payment_settings()
returns table (
  hallnect_upi_id                text,
  hallnect_upi_qr_url            text,
  commission_due_days            integer,
  default_advance_percentage     numeric,
  enable_online_customer_payment boolean,
  enable_owner_upi_payment       boolean,
  enable_auto_commission_adjustment boolean
)
language sql stable security definer set search_path = public
as $$
  select
    s.hallnect_upi_id,
    s.hallnect_upi_qr_url,
    s.commission_due_days,
    s.default_advance_percentage,
    s.enable_online_customer_payment,
    s.enable_owner_upi_payment,
    s.enable_auto_commission_adjustment
  from public.platform_settings s
  where s.id = true;
$$;

grant execute on function public.get_public_payment_settings() to authenticated, service_role;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. owner_commission_payments — manual UPI submissions                       ║
-- ║    An owner records "I paid commission X via UPI, ref Y". This is a CLAIM,  ║
-- ║    not proof: it starts as 'payment_submitted' and only an admin can move   ║
-- ║    it to 'verified' (which marks the commission paid) or 'rejected'.        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.owner_commission_payments (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.hall_owners (id) on delete cascade,
  commission_id    uuid not null references public.commissions (id) on delete cascade,
  amount           numeric(12, 2) not null check (amount >= 0),
  method           text not null default 'upi_manual'
                     check (method in ('upi_manual','upi_gateway','other')),
  upi_id           text,
  upi_reference    text,
  screenshot_url   text,
  status           text not null default 'payment_submitted'
                     check (status in ('payment_submitted','payment_under_review','verified','rejected')),
  submitted_at     timestamptz not null default now(),
  verified_at      timestamptz,
  verified_by      uuid references public.profiles (id) on delete set null,
  admin_note       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_ocp_owner      on public.owner_commission_payments (owner_id);
create index if not exists idx_ocp_commission on public.owner_commission_payments (commission_id);
create index if not exists idx_ocp_status     on public.owner_commission_payments (status);

-- At most ONE pending (not-yet-resolved) submission per commission — prevents an
-- owner spamming duplicate claims. Rejected/verified rows don't block a re-try.
create unique index if not exists uq_ocp_open_per_commission
  on public.owner_commission_payments (commission_id)
  where status in ('payment_submitted','payment_under_review');

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 6. owner_settlement_adjustments — deduction from the OWNER payout           ║
-- ║    commission_id is UNIQUE ⇒ the auto-adjuster is idempotent by construction ║
-- ║    (a second run hits the unique constraint and inserts nothing new).       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.owner_settlement_adjustments (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid references public.hall_owners (id) on delete set null,
  booking_id       uuid references public.bookings (id) on delete set null,
  commission_id    uuid not null unique references public.commissions (id) on delete cascade,
  adjustment_type  text not null default 'commission_deduction'
                     check (adjustment_type in ('commission_deduction','reversal','manual')),
  amount           numeric(12, 2) not null check (amount >= 0),
  reason           text,
  source           text not null default 'overdue_commission'
                     check (source in ('overdue_commission','manual_admin')),
  status           text not null default 'applied'
                     check (status in ('applied','reversed')),
  applied_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_osa_owner      on public.owner_settlement_adjustments (owner_id);
create index if not exists idx_osa_commission on public.owner_settlement_adjustments (commission_id);
create index if not exists idx_osa_status     on public.owner_settlement_adjustments (status);

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 7. updated_at automation for the two new tables                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop trigger if exists trg_set_updated_at on public.owner_commission_payments;
create trigger trg_set_updated_at
  before update on public.owner_commission_payments
  for each row execute function public.set_updated_at();

drop trigger if exists trg_set_updated_at on public.owner_settlement_adjustments;
create trigger trg_set_updated_at
  before update on public.owner_settlement_adjustments
  for each row execute function public.set_updated_at();

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 8. RLS — owner_commission_payments                                          ║
-- ║   • Owner: SELECT + INSERT only their own rows (owner_id must be theirs).   ║
-- ║   • Owner: NO update/delete policy → cannot self-verify (also guarded).     ║
-- ║   • Admin: full access.                                                     ║
-- ║   • Customer / public: no policy → default-deny.                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.owner_commission_payments enable row level security;

drop policy if exists ocp_owner_select on public.owner_commission_payments;
create policy ocp_owner_select on public.owner_commission_payments
  for select using (public.is_admin() or public.owns_owner_row(owner_id));

drop policy if exists ocp_owner_insert on public.owner_commission_payments;
create policy ocp_owner_insert on public.owner_commission_payments
  for insert with check (
    public.owns_owner_row(owner_id)
    -- Owner may only ever create a fresh submission, never pre-mark it verified.
    and status in ('payment_submitted','payment_under_review')
  );

drop policy if exists ocp_admin_write on public.owner_commission_payments;
create policy ocp_admin_write on public.owner_commission_payments
  for all using (public.is_admin()) with check (public.is_admin());

-- Guard: block owners from flipping their submission to verified/paid even if a
-- future policy accidentally allows the update. Only admin/trusted-backend may
-- change status once submitted, or set verification fields.
create or replace function public.guard_commission_payment_writes()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return coalesce(new, old);
  end if;
  -- Non-admin path (owner): only INSERT of a submitted claim is allowed;
  -- any UPDATE/DELETE by a non-admin is refused.
  if tg_op = 'INSERT'
     and new.status in ('payment_submitted','payment_under_review')
     and new.verified_at is null
     and new.verified_by is null then
    return new;
  end if;
  raise exception 'Not allowed: only an administrator can verify a commission payment';
end;
$$;

drop trigger if exists trg_guard_commission_payment_writes on public.owner_commission_payments;
create trigger trg_guard_commission_payment_writes
  before insert or update or delete on public.owner_commission_payments
  for each row execute function public.guard_commission_payment_writes();

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 9. RLS — owner_settlement_adjustments                                        ║
-- ║   • Owner: SELECT only their own adjustments (read-only transparency).      ║
-- ║   • Owner: NO insert/update/delete → cannot create/alter deductions.        ║
-- ║   • Admin: full access. Trusted backend bypasses RLS for the auto-adjuster. ║
-- ║   • Customer / public: no policy → default-deny (never see owner finances). ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.owner_settlement_adjustments enable row level security;

drop policy if exists osa_owner_select on public.owner_settlement_adjustments;
create policy osa_owner_select on public.owner_settlement_adjustments
  for select using (public.is_admin() or public.owns_owner_row(owner_id));

drop policy if exists osa_admin_write on public.owner_settlement_adjustments;
create policy osa_admin_write on public.owner_settlement_adjustments
  for all using (public.is_admin()) with check (public.is_admin());

-- Guard: only admin / trusted backend may ever write a settlement adjustment.
create or replace function public.guard_settlement_adjustment_writes()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return coalesce(new, old);
  end if;
  raise exception 'Not allowed: only an administrator can write settlement adjustments';
end;
$$;

drop trigger if exists trg_guard_settlement_adjustment_writes on public.owner_settlement_adjustments;
create trigger trg_guard_settlement_adjustment_writes
  before insert or update or delete on public.owner_settlement_adjustments
  for each row execute function public.guard_settlement_adjustment_writes();

-- ─────────────────────────────────────────────────────────────────────────────
-- End 0017. No booking / customer row is ever written by this workflow.
-- ─────────────────────────────────────────────────────────────────────────────
