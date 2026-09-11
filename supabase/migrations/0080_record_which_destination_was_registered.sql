-- ─────────────────────────────────────────────────────────────────────────────
-- 0080_record_which_destination_was_registered.sql
--
-- A VENUE OWNER'S PAYOUT BANK ACCOUNT COULD NEVER BE CHANGED, and both the
-- database and the owner's own screen said otherwise.
--
-- THE CHAIN, all four links verified in code:
--   1. toBeneficiaryId() derived the Cashfree beneficiary_id from the
--      hall_owners row id alone, so it was STABLE for the life of the owner.
--   2. Cashfree's POST /beneficiary only CREATES. There is no update verb.
--   3. So a second registration returned 409 beneficiary_id_already_exists, and
--      upsertBeneficiary fell through to GET /beneficiary — which answers with
--      the status of the destination registered FIRST. The new account number
--      never reached Cashfree and no error was raised.
--   4. registerBeneficiary then wrote payout_beneficiary_status = 'VERIFIED',
--      payout_beneficiary_synced_at = now() and last_error = null, and
--      savePayoutDetails returned { state: "verified" }.
--
-- The owner's row held the NEW account. Cashfree held the OLD one. Every payout
-- would have gone to the account the owner had just left, and nothing in the
-- product would have said so.
--
-- IT ALSO DISARMED THE ANTI-REDIRECTION INTERLOCK, which is the part that makes
-- this a security finding rather than only a correctness one. dispatchOwnerPayout
-- refuses when payout_details_changed_at > payout_beneficiary_synced_at — the
-- control against a compromised owner account redirecting payouts. Because
-- registerBeneficiary stamped synced_at on EVERY outcome, including the silent
-- no-op above and including outright failures, the stamp always landed after
-- the edit and the interlock never fired. The guard was reduced to asserting
-- that somebody had recently called Cashfree.
--
-- NOT EXPLOITED, AND NOT EXPLOITABLE FOR THEFT AS IT STOOD: because Cashfree
-- kept the ORIGINAL destination, an attacker who changed the bank details on a
-- stolen owner account would have redirected the money to the legitimate owner.
-- The loss is the reverse — a real owner switching banks is paid into an
-- account they no longer control, or one that now belongs to somebody else.
-- Rated HIGH on that basis, not on a theft scenario.
--
-- NO PRODUCTION IMPACT TO REPAIR: at the time of this migration hall_owners
-- holds 2 rows, 0 with a payout_beneficiary_id and 0 with any beneficiary
-- status — no beneficiary has ever been registered, so there is no stale
-- Cashfree state to reconcile and no back-compatibility burden. This is being
-- fixed before the first payout, not after one went astray.
--
-- THE FIX, in two halves. The application half binds the beneficiary_id to the
-- destination (account + IFSC digest suffix), so a changed account produces a
-- genuinely new registration and an unchanged one still collides harmlessly —
-- which is what finally makes the 409-then-GET fallback honest. This migration
-- is the other half: somewhere to record WHICH destination the stored
-- beneficiary_id was actually registered with.
--
-- Why a digest and not the account number: this column is compared, logged and
-- read by admin screens. A bank account number should be none of those things.
-- Same construction as the destination_digest already stored on owner_payouts,
-- so the two are directly comparable.
--
-- Why this and not the timestamp check: a timestamp records WHEN we last spoke
-- to Cashfree. It cannot record WHAT WE SAID. Only a value derived from the
-- destination itself can answer "is the account Cashfree holds the account this
-- row claims", and that is the question dispatch actually needs answered.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.hall_owners
  add column if not exists payout_beneficiary_digest text;

comment on column public.hall_owners.payout_beneficiary_digest is
  'sha256(account|IFSC), first 32 hex — WHICH destination payout_beneficiary_id '
  'was registered with at Cashfree. dispatchOwnerPayout refuses when this does '
  'not equal the digest of the row''s current payout_account_number and '
  'payout_ifsc. Never the raw account number: this value is compared and logged.';

-- Same treatment as the destination columns in 0068: a client must never write
-- the record of where money is registered to go. Only the service role does,
-- inside registerBeneficiary, immediately after Cashfree confirms.
revoke update (payout_beneficiary_digest) on public.hall_owners from authenticated, anon;
revoke insert (payout_beneficiary_digest) on public.hall_owners from authenticated, anon;

-- ── Verify ──────────────────────────────────────────────────────────────────
do $mig$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='hall_owners'
       and column_name='payout_beneficiary_digest'
  ) then
    raise exception 'payout_beneficiary_digest was not created';
  end if;

  -- A client must not be able to write it, by either verb.
  if has_column_privilege('authenticated','public.hall_owners','payout_beneficiary_digest','UPDATE')
     or has_column_privilege('authenticated','public.hall_owners','payout_beneficiary_digest','INSERT')
     or has_column_privilege('anon','public.hall_owners','payout_beneficiary_digest','UPDATE') then
    raise exception 'a client role can still write payout_beneficiary_digest';
  end if;

  -- The 0068 destination lock must still hold; this migration is meaningless
  -- if the account number itself became writable again.
  if has_column_privilege('authenticated','public.hall_owners','payout_account_number','UPDATE')
     or has_column_privilege('authenticated','public.hall_owners','payout_ifsc','UPDATE') then
    raise exception 'the 0068 destination lock has regressed';
  end if;

  -- And the owner must still be able to maintain the ordinary business fields,
  -- or this has quietly broken the profile form.
  if not has_column_privilege('authenticated','public.hall_owners','business_name','UPDATE') then
    raise exception 'the revoke was too broad - business_name is no longer writable';
  end if;

  raise notice 'payout_beneficiary_digest created and locked to the service role';
end
$mig$;
