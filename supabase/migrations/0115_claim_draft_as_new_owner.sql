-- ─────────────────────────────────────────────────────────────────────────────
-- 0115_claim_draft_as_new_owner.sql
--
-- A NEW OWNER CAN CLAIM A PREPARED HALL WITHOUT A TRIP TO PROFILE (2026-10-12).
--
-- An admin can prepare a listing for an owner's verified mobile number (0090,
-- Admin → Add a Hall). claim_admin_hall_draft turns it into the owner's hall,
-- but it raises 'Complete your owner registration before claiming a listing.'
-- when the caller has no hall_owners row. Only Business Details on
-- /owner/profile created that row, and its single required field is the
-- business name. So the owner the admin went out of their way to help was sent
-- away to fill in one field before they could take their own listing.
--
-- c5722e9 removed the same detour from the FIRST-HALL form; this removes it
-- from the claim. The owner types their business name on the claim card.
--
-- ── WHY A WRAPPER, AND NOT A CHANGED claim_admin_hall_draft ─────────────────
-- claim_admin_hall_draft is untouched: same signature, same body, same grants.
-- Changing its arguments would mean dropping it (and its grants), and 0094
-- already patches its body by exact text match, so a rewrite here would also
-- break that history. The wrapper creates the row and then CALLS the claim in
-- the same transaction, so every check the claim makes still runs: the verified
-- mobile number must match the draft, the draft must be unclaimed, the account
-- must be active.
--
-- ── ATOMIC ON PURPOSE ──────────────────────────────────────────────────────
-- If the claim raises (wrong number, already claimed), the whole statement is
-- rolled back, INCLUDING the hall_owners row created a moment earlier. A
-- failed claim leaves nothing behind.
--
-- ── THE ROLE CHECK IS NEW, AND REQUIRED ─────────────────────────────────────
-- claim_admin_hall_draft never checks the role. It did not need to: it relied
-- on the hall_owners row existing, and only an owner's own flow creates one.
-- This function CREATES that row as SECURITY DEFINER, which bypasses RLS, so it
-- must refuse anyone who is not owner_approved. Without that, a customer whose
-- verified number matched a draft would give themselves an owner record.
--
-- ── THE NAME IS ASKED, NEVER GUESSED ───────────────────────────────────────
-- business_name is the "Listed by" seller disclosure on every venue page
-- (app/halls/[slug]/_components/HallDetailView.tsx). It comes from the owner,
-- trimmed and 2 to 160 characters, the same rule as ownerBusinessSchema. It is
-- never copied from the draft's hall name. An owner who already has a row
-- keeps it: the name argument is then ignored, and renaming happens in Profile.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.claim_admin_hall_draft_as_new_owner(
  _draft_id      uuid,
  _business_name text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_name    text := btrim(coalesce(_business_name, ''));
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    raise exception 'Not authenticated';
  end if;
  if v_profile.is_active = false then
    raise exception 'This account is not active.';
  end if;
  if v_profile.role::text <> 'owner_approved' then
    raise exception 'Only a hall owner account can claim a listing.';
  end if;

  if not exists (select 1 from public.hall_owners where profile_id = v_uid) then
    if length(v_name) < 2 then
      raise exception 'Enter your business name — it is shown on your listing as "Listed by".';
    end if;
    if length(v_name) > 160 then
      raise exception 'Keep your business name under 160 characters.';
    end if;
    -- is_verified is left to its default (false): verification is an admin
    -- decision, exactly as on the Profile path. profile_id is UNIQUE, so a
    -- double click cannot make a second row.
    insert into public.hall_owners (profile_id, business_name)
    values (v_uid, v_name)
    on conflict (profile_id) do nothing;
  end if;

  -- Every claim check runs here. If it raises, the row above is rolled back.
  return public.claim_admin_hall_draft(_draft_id);
end;
$function$;

revoke all on function public.claim_admin_hall_draft_as_new_owner(uuid, text) from public, anon;
grant execute on function public.claim_admin_hall_draft_as_new_owner(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- ── Self-verification ───────────────────────────────────────────────────────
do $verify$
declare
  v_def text;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'claim_admin_hall_draft_as_new_owner'
       and p.prosecdef
  ) then
    raise exception '0115: wrapper missing or not SECURITY DEFINER';
  end if;

  if has_function_privilege('anon', 'public.claim_admin_hall_draft_as_new_owner(uuid, text)', 'EXECUTE') then
    raise exception '0115: anon can execute the wrapper';
  end if;
  if not has_function_privilege('authenticated', 'public.claim_admin_hall_draft_as_new_owner(uuid, text)', 'EXECUTE') then
    raise exception '0115: authenticated cannot execute the wrapper';
  end if;

  select pg_get_functiondef('public.claim_admin_hall_draft_as_new_owner(uuid, text)'::regprocedure) into v_def;
  if position('''owner_approved''' in v_def) = 0 then
    raise exception '0115: the role check is missing';
  end if;
  if position('public.claim_admin_hall_draft(_draft_id)' in v_def) = 0 then
    raise exception '0115: the wrapper does not delegate to claim_admin_hall_draft';
  end if;

  -- The original claim must be exactly as it was: still there, still callable
  -- by owners, still refusing a caller with no owner row.
  select pg_get_functiondef('public.claim_admin_hall_draft(uuid)'::regprocedure) into v_def;
  if position('Complete your owner registration before claiming a listing.' in v_def) = 0 then
    raise exception '0115: claim_admin_hall_draft changed — this migration must not touch it';
  end if;
  if not has_function_privilege('authenticated', 'public.claim_admin_hall_draft(uuid)', 'EXECUTE') then
    raise exception '0115: claim_admin_hall_draft lost its grant';
  end if;
end
$verify$;
