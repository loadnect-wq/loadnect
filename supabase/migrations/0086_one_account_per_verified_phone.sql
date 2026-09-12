-- ─────────────────────────────────────────────────────────────────────────────
-- 0086_one_account_per_verified_phone.sql
--
-- THE FOUNDATION OF ACCOUNT LINKING: a verified mobile number identifies ONE
-- Hallnect account. Without this, "sign in with your mobile" has no answer to
-- the question "whose account is this?", and the dual-authentication feature
-- cannot be built on top of it safely.
--
-- profiles.phone has never had a uniqueness rule. Until today three accounts
-- shared one number — a customer, an owner and the admin — because they were
-- the same person's test logins. Only one of the three was verified, which is
-- exactly why the rule below is scoped to VERIFIED numbers.
--
-- ── WHY PARTIAL, NOT A PLAIN UNIQUE INDEX ───────────────────────────────────
-- Measured before writing this: a unique index over ALL non-null phones FAILS
-- today with 23505. An unverified phone is a string somebody typed into a
-- profile form; it is a claim, not an identity, and two people may honestly
-- type the same wrong number. A VERIFIED phone is different in kind — an OTP
-- proved possession of it — and that is the only thing that may resolve to an
-- account at sign-in.
--
-- So the constraint follows the meaning: claims may collide, proofs may not.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
-- It does not merge anything, and it must not. Supabase Auth has NO merge
-- primitive: linkIdentity() is declared only for OAuth and ID-token credentials
-- (@supabase/auth-js 2.108.2, GoTrueClient.d.ts:2168 and :2172) — there is no
-- linkIdentity({phone}) and no linkIdentity({email}). If a number were ever to
-- become verified on a second account, joining the two afterwards would mean
-- repointing every foreign key that references profiles(id) by hand, several of
-- which are ON DELETE RESTRICT. The only safe design is to make the second
-- verification IMPOSSIBLE rather than reversible, which is what this index does.
--
-- ── THE ERROR IS PART OF THE FEATURE ────────────────────────────────────────
-- A 23505 here is not a bug to be swallowed. It is the signal that this number
-- already belongs to somebody, and the application must turn it into the
-- account-linking conversation rather than a generic failure. app/verify-phone/
-- actions.ts and the enquiry flow both translate it; a caller that does not is
-- a caller that will show a stack-trace-shaped message to a real person.
--
-- Numbers are stored E.164 by normalizePhoneE164 before they ever reach this
-- column — all live rows were confirmed to match ^\+[1-9][0-9]{7,14}$ — so the
-- index compares like with like without needing a functional expression.
-- ─────────────────────────────────────────────────────────────────────────────

create unique index if not exists uq_profiles_verified_phone
  on public.profiles (phone)
  where phone_verified and phone is not null;

comment on index public.uq_profiles_verified_phone is
  'One account per VERIFIED mobile number. Unverified duplicates are permitted '
  'on purpose: an unverified phone is a claim, a verified one is a proof, and '
  'only a proof may resolve to an account at sign-in. A 23505 on this index '
  'means the number belongs to another account and must start the linking flow.';

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Behavioural, against real rows, and everything is put back. No handler
-- swallows an assertion.
do $mig$
declare
  owner_id_v  uuid;
  other_id_v  uuid;
  taken_phone text;
  outcome     text;
  restored    boolean;
  -- The second account's ORIGINAL state. This block edits a real production row
  -- to prove the constraint bites, so it must put back exactly what it found —
  -- an earlier draft nulled the phone unconditionally and would have quietly
  -- erased the admin's number.
  orig_phone     text;
  orig_verified  boolean;
  orig_verified_at timestamptz;
begin
  -- (a) the index exists and is unique + partial.
  if not exists (
    select 1 from pg_indexes
     where schemaname='public' and indexname='uq_profiles_verified_phone'
  ) then
    raise exception 'uq_profiles_verified_phone was not created';
  end if;

  -- (b) it must not have silently matched nothing. Confirm it really is partial
  --     on phone_verified, or an all-rows unique index would have been created
  --     and would block legitimate unverified duplicates.
  if (select indexdef from pg_indexes
       where schemaname='public' and indexname='uq_profiles_verified_phone')
     not like '%WHERE%phone_verified%' then
    raise exception 'the index is not partial on phone_verified';
  end if;

  select id, phone into owner_id_v, taken_phone
    from public.profiles where phone_verified and phone is not null limit 1;
  if owner_id_v is null then
    raise notice 'no verified phone on file - skipping behavioural verify';
    return;
  end if;

  -- A different account that does NOT already hold that number.
  select id into other_id_v
    from public.profiles
   where id <> owner_id_v and (phone is distinct from taken_phone or phone is null)
   limit 1;
  if other_id_v is null then
    raise notice 'no second account to test against - skipping behavioural verify';
    return;
  end if;

  select phone, phone_verified, phone_verified_at
    into orig_phone, orig_verified, orig_verified_at
    from public.profiles where id = other_id_v;

  -- (c) A SECOND ACCOUNT MUST NOT BE ABLE TO VERIFY THE SAME NUMBER.
  --     Run as the trusted backend, which is how the OTP success path writes it
  --     — so this proves the constraint stops even the privileged writer, not
  --     merely a client that RLS would have stopped anyway.
  begin
    update public.profiles
       set phone = taken_phone, phone_verified = true, phone_verified_at = now()
     where id = other_id_v;
    outcome := 'ACCEPTED';
  exception when unique_violation then
    outcome := 'refused 23505';
  end;

  if outcome = 'ACCEPTED' then
    -- Restore BEFORE failing, so a failed assertion cannot leave two accounts
    -- holding one verified number in production.
    update public.profiles
       set phone = orig_phone, phone_verified = orig_verified, phone_verified_at = orig_verified_at
     where id = other_id_v;
    raise exception 'GUARD FAILED: a second account verified an already-verified number';
  end if;

  -- (d) ...but an UNVERIFIED duplicate must still be allowed, because that is
  --     the case this index deliberately tolerates.
  update public.profiles
     set phone = taken_phone, phone_verified = false
   where id = other_id_v;
  select (phone = taken_phone and not phone_verified) into restored
    from public.profiles where id = other_id_v;

  -- Put the row back EXACTLY as it was found, whatever the assertion says.
  update public.profiles
     set phone = orig_phone, phone_verified = orig_verified, phone_verified_at = orig_verified_at
   where id = other_id_v;

  if not restored then
    raise exception 'GUARD TOO BROAD: an unverified duplicate was refused';
  end if;

  -- And prove the restore actually happened.
  if (select phone is distinct from orig_phone or phone_verified is distinct from orig_verified
        from public.profiles where id = other_id_v) then
    raise exception 'the verify block did not restore the second account';
  end if;

  raise notice 'verified-phone uniqueness holds: second verification %, unverified duplicate allowed', outcome;
end
$mig$;
