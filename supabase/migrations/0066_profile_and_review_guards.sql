-- 0066 — two self-service escalations, closed with triggers rather than grants.
--
-- WHY TRIGGERS AND NOT REVOKES. Column and table grants are role-wide and are
-- NOT is_admin()-aware — this project has been bitten by that twice. Revoking
-- UPDATE on profiles.phone_verified would break the profile forms (which clear
-- it when the phone changes); revoking DELETE on reviews would break the admin's
-- own deleteReview, because an admin is `authenticated` too. A trigger can tell
-- the cases apart. Grants stay; the trigger is the gate.

-- ── 1. A USER COULD FLIP THEIR OWN SUSPENSION AND VERIFICATION ───────────────
--
-- profiles_update is USING (auth.uid() = id OR is_admin()) with a CHECK pinning
-- `role` to its current value — so role escalation was already blocked. Nothing
-- pinned is_active or phone_verified, and `authenticated` holds UPDATE on both.
-- So, straight through PostgREST:
--
--   PATCH /rest/v1/profiles?id=eq.<self>  {"is_active": true}       -- unsuspend
--   PATCH /rest/v1/profiles?id=eq.<self>  {"phone_verified": true}  -- skip the OTP
--
-- The first lies to every admin screen and to requireAuth (the auth-level ban
-- added in cc28452 still stops sign-in, so it is a false record rather than a
-- way back in). The second is the sharper one: it grants the status the OTP
-- exists to confer, and an OTP-verified profile phone OUTRANKS the booking's
-- contact_phone when notifications are routed.
create or replace function public.guard_profile_privileged_columns()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return new;
  end if;

  if new.is_active is distinct from old.is_active then
    raise exception 'profiles: account status is set by Hallnect, not by the account holder';
  end if;

  -- Asymmetric ON PURPOSE. Dropping your own verification is allowed, because
  -- changing your phone number must do exactly that and the profile forms rely
  -- on it. Granting it to yourself is the thing the OTP is for.
  if coalesce(new.phone_verified, false)
     and new.phone_verified is distinct from old.phone_verified then
    raise exception 'profiles: phone verification is granted by the OTP check, not by the client';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_guard_profile_privileged_columns on public.profiles;
create trigger trg_guard_profile_privileged_columns
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();

-- CONSEQUENCE, and it is a code change, not a schema one: the OTP success path
-- in app/verify-phone/actions.ts wrote phone_verified through the SESSION
-- client, which this trigger now refuses. It writes with the service role
-- instead — correct, because the flag is the OUTCOME of a check the server just
-- performed. Same single row, same user.id filter, authority moved to the side
-- that actually verified something.

-- ── 2. A MODERATED REVIEW COULD BE DELETED AND RE-POSTED ─────────────────────
--
-- reviews_delete is USING (customer_id = auth.uid() OR is_admin()), so an author
-- could delete a review an admin had hidden (is_visible=false, guarded since
-- 0048) and immediately insert a fresh one, which starts visible. Hiding a
-- review was undoable by the person it was applied to.
--
-- Deletion is an admin action in this product — /admin/reviews is the only UI
-- for it — so authors lose it. Editing their own review is untouched.
create or replace function public.guard_review_delete()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return old;
  end if;
  raise exception 'reviews: a published review is removed by Hallnect, not by its author'
    using errcode = 'insufficient_privilege';
end;
$function$;

drop trigger if exists trg_guard_review_delete on public.reviews;
create trigger trg_guard_review_delete
  before delete on public.reviews
  for each row execute function public.guard_review_delete();

-- ── 3. ONE REVIEW PER BOOKING ────────────────────────────────────────────────
--
-- Nothing stopped a customer inserting many reviews against the same completed
-- booking, each one moving the hall's rating average. booking_id is nullable
-- (older rows predate it), so the index is partial and touches none of them.
create unique index if not exists uq_review_one_per_booking
  on public.reviews (booking_id) where booking_id is not null;

-- VERIFIED after applying, in rolled-back transactions:
--   self: is_active flip           BLOCKED
--   self: phone_verified -> true   BLOCKED
--   self: phone_verified -> false  ALLOWED   <- the profile form still works
--   self: ordinary profile edit    ALLOWED
--   service role: is_active        ALLOWED   <- the admin path still works
--   service role: OTP success write ALLOWED  <- verification still works
