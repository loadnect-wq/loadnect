-- ─────────────────────────────────────────────────────────────────────────────
-- 0087_otp_attempts_for_anonymous_senders.sql
--
-- SIGN-IN BY MOBILE MEANS THE SENDER HAS NO ACCOUNT YET. Every OTP ceiling in
-- lib/otp-guard.ts is recorded in public.otp_attempts, and today
--
--     user_id uuid NOT NULL REFERENCES public.profiles(id)
--
-- so a login attempt CANNOT BE RECORDED AT ALL. Not "is recorded badly" —
-- the insert raises 23502 and the guard's own reasoning (write the row BEFORE
-- the SMS, then re-count) collapses. An unauthenticated send endpoint built on
-- top of that would be entirely unmetered: free SMS, billed to us, to any
-- number an attacker likes.
--
-- Two columns, and the distinction between them is the whole point.
--
-- ── user_id BECOMES NULLABLE ────────────────────────────────────────────────
-- Null means "nobody was signed in when this happened". It is not a weakening:
-- the ceilings that matter most — 10/day per PHONE and the fail-closed 300/day
-- GLOBAL fuse — never keyed on user_id in the first place, and they are SHARED
-- with the existing signed-in flows. So an attacker cannot reset a phone's
-- budget by moving from the profile-verification endpoint to the login one.
--
-- ── actor_key CARRIES THE PER-ACTOR CEILING ─────────────────────────────────
-- The per-account ceilings (15 sends/day across all numbers, 15 failed checks)
-- are the ones that stop a single actor walking a list of strangers' numbers.
-- Without a user id they have nothing to key on, so an anonymous actor gets a
-- stable label instead: a salted hash of the client address, exactly the
-- construction already used for contact_messages.sender_bucket in 0082.
--
-- NEVER THE ADDRESS ITSELF. An IP is personal data and this table is read by
-- support tooling; rate limiting only needs "same actor or not", which a keyed
-- hash answers identically. The salt is not optional: IPv4 has four billion
-- values, so an unsalted hash is reversible by brute force in seconds and would
-- store the address while appearing not to.
--
-- EXACTLY ONE OF THE TWO IS SET, enforced by a CHECK rather than left to the
-- application. A row with both would be counted twice and a row with neither is
-- an attempt nobody can be held to — both are silent holes in a rate limiter,
-- which is the kind of bug that is only discovered by being exploited.
--
-- ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
-- It does not make an anonymous actor as accountable as a signed-in one, and
-- nothing can: an address is shed by changing network. It RAISES the cost and
-- bounds the blast radius, and the per-phone and global ceilings — which no
-- attacker can shed — remain the backstop. Written down here so the next reader
-- does not mistake actor_key for an identity.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.otp_attempts
  alter column user_id drop not null;

alter table public.otp_attempts
  add column if not exists actor_key text;

-- Exactly one actor. See the header: both or neither are both rate-limiter holes.
alter table public.otp_attempts
  drop constraint if exists otp_attempts_one_actor;
alter table public.otp_attempts
  add constraint otp_attempts_one_actor
  check ((user_id is not null) <> (actor_key is not null));

comment on column public.otp_attempts.actor_key is
  'Salted, truncated hash of the client address for an attempt made while '
  'signed OUT (salt: OTP_ACTOR_SALT). Rate limiting only — never the address '
  'itself. Null whenever user_id is set; exactly one of the two is always '
  'present, enforced by otp_attempts_one_actor.';

-- The per-actor ceilings read (actor_key, kind, created_at) on every send and
-- every check, so it is the hot path for an unauthenticated endpoint.
create index if not exists idx_otp_attempts_actor_key
  on public.otp_attempts (actor_key, kind, created_at desc)
  where actor_key is not null;

-- ── Verify ──────────────────────────────────────────────────────────────────
do $mig$
declare
  known uuid;
  ok_anon boolean := false;
  ok_both boolean := false;
  ok_none boolean := false;
  probe_id uuid;
begin
  -- (a) an ANONYMOUS attempt must now be recordable. This is the whole point;
  --     if it is not, the login endpoint cannot be rate limited at all.
  begin
    insert into public.otp_attempts (user_id, actor_key, phone, kind, succeeded)
    values (null, 'zz0087probeactorkey', '+919999000001', 'send', false)
    returning id into probe_id;
    ok_anon := true;
    delete from public.otp_attempts where id = probe_id;
  exception when others then
    raise exception 'an anonymous otp_attempt could not be recorded: % %', sqlstate, sqlerrm;
  end;

  -- (b) a SIGNED-IN attempt must still work, unchanged.
  select id into known from public.profiles limit 1;
  if known is not null then
    insert into public.otp_attempts (user_id, actor_key, phone, kind, succeeded)
    values (known, null, '+919999000002', 'check', false)
    returning id into probe_id;
    delete from public.otp_attempts where id = probe_id;
  end if;

  -- (c) BOTH actors set must be refused — it would be counted twice.
  begin
    insert into public.otp_attempts (user_id, actor_key, phone, kind, succeeded)
    values (known, 'zz0087both', '+919999000003', 'send', false);
    raise exception 'GUARD FAILED: a row with both user_id and actor_key was accepted';
  exception when check_violation then
    ok_both := true;
  end;

  -- (d) NEITHER set must be refused — an attempt nobody can be held to.
  begin
    insert into public.otp_attempts (user_id, actor_key, phone, kind, succeeded)
    values (null, null, '+919999000004', 'send', false);
    raise exception 'GUARD FAILED: a row with no actor at all was accepted';
  exception when check_violation then
    ok_none := true;
  end;

  if not (ok_anon and ok_both and ok_none) then
    raise exception 'otp_attempts actor rules are not enforced as expected';
  end if;

  -- (e) the index the unauthenticated hot path depends on.
  if not exists (
    select 1 from pg_indexes
     where schemaname='public' and indexname='idx_otp_attempts_actor_key'
  ) then
    raise exception 'idx_otp_attempts_actor_key was not created';
  end if;

  -- (f) nothing may write this table from a browser. The ceilings are only
  --     meaningful if the ledger they read cannot be forged.
  if has_table_privilege('anon','public.otp_attempts','INSERT')
     or has_table_privilege('authenticated','public.otp_attempts','INSERT')
     or has_table_privilege('anon','public.otp_attempts','UPDATE')
     or has_table_privilege('authenticated','public.otp_attempts','UPDATE') then
    raise exception 'otp_attempts is client-writable - every OTP ceiling is forgeable';
  end if;

  raise notice 'otp_attempts accepts anonymous actors, exactly one actor per row';
end
$mig$;
