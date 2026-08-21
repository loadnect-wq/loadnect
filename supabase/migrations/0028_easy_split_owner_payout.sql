-- ─────────────────────────────────────────────────────────────────────────────
-- 0028 — Automatic owner payout via Cashfree Easy Split
--
-- MONEY FLOW (decided with the operator):
--   customer pays advance  → funds HELD in Hallnect's Cashfree account
--   owner ACCEPTS booking  → split fires: Hallnect keeps the 5% commission,
--                            the remainder settles to the owner's vendor balance
--   owner DECLINES/expires → no split was ever created, so the customer is
--                            refunded cleanly with nothing to claw back
--
-- Splitting only on acceptance is the whole point: once a vendor share has
-- settled, Cashfree has no automatic clawback, so paying the owner before they
-- commit would make every decline a debt-collection problem.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Split state on the payment that funded the booking ──────────────────────
-- Lives on `payments` because a split applies to exactly one gateway order.
alter table public.payments
  add column if not exists split_status       text not null default 'none',
  add column if not exists split_owner_amount numeric(12,2),
  add column if not exists split_vendor_id    text,
  add column if not exists split_at           timestamptz,
  add column if not exists split_error        text;

do $mig$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_split_status_check' and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_split_status_check
      check (split_status in ('none','pending','done','failed','not_applicable'));
  end if;
end
$mig$;

-- Finding work to retry, and proving a split ran exactly once.
create index if not exists idx_payments_split_status
  on public.payments (split_status)
  where split_status in ('pending','failed');

-- ── Vendor onboarding state for owners ──────────────────────────────────────
-- hall_owners already carries cashfree_vendor_id + vendor_kyc_status (0018).
-- Record when we last synced with Cashfree so a stale KYC status is visible
-- rather than silently trusted.
alter table public.hall_owners
  add column if not exists vendor_synced_at   timestamptz,
  add column if not exists vendor_last_error  text;

-- ── Guard: a payment's split fields are trusted-backend only ────────────────
-- payments already denies all client writes via RLS, but this makes the
-- financial intent explicit and survives any future policy loosening.
create or replace function public.guard_payment_split_writes()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return coalesce(new, old);
  end if;
  raise exception 'Not allowed: split state is written only by the settlement backend';
end;
$fn$;

drop trigger if exists trg_guard_payment_split on public.payments;
create trigger trg_guard_payment_split
  before update of split_status, split_owner_amount, split_vendor_id, split_at
  on public.payments
  for each row execute function public.guard_payment_split_writes();
