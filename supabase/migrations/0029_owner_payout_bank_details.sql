-- ─────────────────────────────────────────────────────────────────────────────
-- 0029 — Owner payout bank details
--
-- These columns were applied directly to the live database while wiring Easy
-- Split, but never captured in a migration file. Any freshly provisioned
-- environment (new staging project, db reset) therefore lacked them, and every
-- Business Details save failed with an unactionable "Something went wrong".
--
-- Cashfree Easy Split settles vendor payouts to a BANK ACCOUNT. Verified
-- against the live gateway: this merchant has UPI settlements disabled
-- ("UPI settlements are not enabled for your account"), so payout_upi alone
-- cannot onboard an owner as a vendor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.hall_owners
  add column if not exists payout_account_number text,
  add column if not exists payout_ifsc           text,
  add column if not exists payout_account_holder text;

do $mig$
begin
  -- IFSC: 4 letters, '0', then 6 alphanumerics. Rejecting a malformed code
  -- here stops a failed payout much later.
  if not exists (
    select 1 from pg_constraint
    where conname = 'hall_owners_ifsc_format' and conrelid = 'public.hall_owners'::regclass
  ) then
    alter table public.hall_owners
      add constraint hall_owners_ifsc_format
      check (payout_ifsc is null or payout_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'hall_owners_account_format' and conrelid = 'public.hall_owners'::regclass
  ) then
    alter table public.hall_owners
      add constraint hall_owners_account_format
      check (payout_account_number is null or payout_account_number ~ '^[0-9]{6,20}$');
  end if;
end
$mig$;
