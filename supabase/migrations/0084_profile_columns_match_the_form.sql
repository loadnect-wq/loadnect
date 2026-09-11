-- ─────────────────────────────────────────────────────────────────────────────
-- 0084_profile_columns_match_the_form.sql
--
-- THE SELF-UPDATABLE PROFILE SURFACE WAS WIDER THAN THE PROFILE FORM. All
-- fourteen columns of public.profiles answered true to
-- has_column_privilege('authenticated', ..., 'UPDATE'), because the grant is
-- table-level. Triggers cover four of them — role (prevent_role_change),
-- is_active, phone_verified and phone_verified_at (guard_profile_privileged_
-- columns) — and RLS pins the row to auth.uid(). Everything else was writable
-- by a PATCH straight to PostgREST, whatever the form offered.
--
-- The one that matters is EMAIL. profiles.email is a COPY of auth.users.email,
-- and nothing keeps the two in step. It is what the admin user list shows, and
-- it is the value recorded as actor_email on every audit entry
-- (lib/audit.ts:42). A user could set it to anything — a colleague's address,
-- support@hallnect.com — and their own audit trail would then attribute their
-- actions to that address, in the log that exists to say who did what. Sign-in
-- is unaffected; GoTrue reads auth.users, not this table. So the damage is to
-- the record, not to access, which is why this is LOW and not higher.
--
-- created_at and updated_at are the smaller version of the same thing: a row
-- that can restate when it was made is a row whose timeline cannot be trusted.
-- updated_at is maintained by trg_set_updated_at anyway, and a BEFORE trigger
-- assigning NEW.updated_at needs no column grant from the caller — privileges
-- are checked against the columns named in the statement, not against what a
-- trigger sets. So revoking it changes nothing except who may name it.
--
-- id is already unreachable: profiles_update's WITH CHECK requires
-- auth.uid() = id, so moving a row to another id fails anyway. Revoked because
-- a privilege that is only blocked somewhere else is not a privilege worth
-- keeping.
--
-- NOT REVOKED, and each for a reason:
--   full_name, phone, notifications_enabled — the profile form writes these.
--   phone_verified, phone_verified_at      — the form CLEARS these when the
--       number changes, which the guard deliberately permits; only granting
--       verification is blocked.
--   role, is_active — the admin screens write these through the SESSION client
--       (app/admin/actions.ts), not the service role, so authenticated must
--       keep them. prevent_role_change and the guard are what make that safe.
--   avatar_url, sms_/whatsapp_notifications_enabled — unused today, but they
--       are the user's own preferences and belong to the same form.
--
-- Account deletion scrubs email and avatar_url (lib/account-deletion.ts:122)
-- with the SERVICE ROLE, which bypasses column grants entirely, so the
-- tombstone still works.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A COLUMN REVOKE CANNOT NARROW A TABLE GRANT ─────────────────────────────
-- The first draft of this migration was exactly
--     revoke update (email, created_at, updated_at, id) on public.profiles ...
-- and its own verify block failed it, because both roles hold TABLE-level
-- UPDATE here and has_column_privilege therefore answers true for every column
-- regardless. The only way to narrow a table grant is to drop it and re-grant
-- the columns you meant. (0082 hit the identical wall on contact_messages an
-- hour earlier; this is the house's most repeated mistake.)
revoke update on public.profiles from anon, authenticated;

grant update (
  full_name, phone, notifications_enabled,
  -- The form CLEARS these two when the number changes, which the guard permits;
  -- only GRANTING verification is blocked.
  phone_verified, phone_verified_at,
  -- Written by the admin screens through the SESSION client, not the service
  -- role, so authenticated must keep them. prevent_role_change and
  -- guard_profile_privileged_columns are what make that safe.
  role, is_active,
  -- The user's own preferences. Unused by the UI today, same form tomorrow.
  avatar_url, sms_notifications_enabled, whatsapp_notifications_enabled
) on public.profiles to authenticated;

-- anon gets nothing back. It cannot satisfy profiles_insert (auth.uid() = id),
-- profiles_update (auth.uid() = id or is_admin()) or profiles_delete
-- (is_admin()), so every write privilege it held here was unreachable by
-- construction — which is a reason to remove them, not a reason to keep them.
revoke insert, delete on public.profiles from anon;

-- ── Verify ──────────────────────────────────────────────────────────────────
do $mig$
declare
  custX uuid;
  outcome text;
begin
  -- (a) the four are gone...
  if has_column_privilege('authenticated','public.profiles','email','UPDATE')
     or has_column_privilege('authenticated','public.profiles','created_at','UPDATE')
     or has_column_privilege('authenticated','public.profiles','updated_at','UPDATE')
     or has_column_privilege('authenticated','public.profiles','id','UPDATE') then
    raise exception 'a client role can still rewrite an identity column';
  end if;

  -- (b) ...and everything the product actually writes is still there. Getting
  --     this wrong breaks the profile form or the admin user list, silently,
  --     with a 42501 that reads like a permissions bug somewhere else.
  if not has_column_privilege('authenticated','public.profiles','full_name','UPDATE')
     or not has_column_privilege('authenticated','public.profiles','phone','UPDATE')
     or not has_column_privilege('authenticated','public.profiles','notifications_enabled','UPDATE')
     or not has_column_privilege('authenticated','public.profiles','phone_verified','UPDATE')
     or not has_column_privilege('authenticated','public.profiles','phone_verified_at','UPDATE')
     or not has_column_privilege('authenticated','public.profiles','role','UPDATE')
     or not has_column_privilege('authenticated','public.profiles','is_active','UPDATE') then
    raise exception 'the revoke was too broad - the profile form or admin user list is now broken';
  end if;

  -- (c) behavioural: a real client must be refused on email and allowed on name.
  select id into custX from public.profiles where role='customer' and is_active limit 1;
  if custX is null then
    raise notice 'no active customer - skipping behavioural verify';
    return;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', custX)::text, true);

  begin
    update public.profiles set email = 'forged@hallnect.com' where id = custX;
    outcome := 'ACCEPTED';
  exception when others then
    outcome := 'refused ' || sqlstate;
  end;

  -- The ordinary edit must still work, and it must leave the row as it was.
  update public.profiles set full_name = full_name where id = custX;
  reset role;

  if outcome = 'ACCEPTED' then
    raise exception 'GUARD FAILED: a client rewrote its own profile email';
  end if;
  raise notice 'email write %, name write ok', outcome;
end
$mig$;
