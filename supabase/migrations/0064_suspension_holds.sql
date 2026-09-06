-- 0064 — suspension becomes a state only Hallnect can leave.
--
-- prevent_hall_self_approve blocked transitions INTO approved/rejected/suspended
-- and said nothing about transitions OUT of them. So a venue an admin had
-- SUSPENDED could be put straight back into the review queue by its own owner:
--
--   PATCH /rest/v1/halls?id=eq.<hall>   {"status":"pending_approval"}
--
-- Proved against production with a rolled-back probe: rows=1. Self-approval was
-- still blocked, so the listing could not go live directly — but suspension
-- stopped being a state that holds, and a later admin could re-approve a hall
-- without ever learning it had been suspended for cause.
--
-- WHERE IT CAME FROM. Migration 0048 restored `grant update (status) on halls to
-- authenticated` so an owner could move their own draft into the queue. That
-- grant was tested from `draft`, and only from `draft`. The same grant is what
-- makes this reachable from `suspended`.
--
-- WHY THE EXISTING GUARD DID NOT COVER IT. submitHallForApproval already refuses
-- this, and its comment names the hole exactly. But that guard is in a SERVER
-- ACTION, so it only protects the button. The table is reachable directly
-- through PostgREST with the anon/authenticated key. An application-layer check
-- on a client-writable table is a courtesy, not a control.
--
-- REJECTED IS DELIBERATELY STILL ESCAPABLE. `rejected -> pending_approval` is the
-- remediation loop: the owner is shown rejection_reason precisely so they can fix
-- the listing and resubmit, and an earlier fix restored that path after it was
-- found broken. Sealing it here would re-break it. Only SUSPENDED is punitive,
-- so only suspended is sealed.
--
-- VERIFIED after applying, in one rolled-back transaction:
--   owner: suspended -> pending_approval   BLOCKED (P0001)
--   owner: suspended -> draft              BLOCKED (P0001)
--   owner: rejected  -> pending_approval   ALLOWED   <- remediation intact
--   owner: draft     -> pending_approval   ALLOWED   <- the point of 0048 intact
--   admin: suspended -> approved           ALLOWED   <- restore still works
create or replace function public.prevent_hall_self_approve()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return new;
  end if;

  -- Cannot move a hall INTO a moderation decision.
  if new.status is distinct from old.status
     and new.status in ('approved', 'rejected', 'suspended') then
    raise exception 'Not allowed: only an administrator can approve, reject or suspend a hall';
  end if;

  -- Cannot move a hall OUT of suspension either. Only Hallnect lifts it.
  if old.status = 'suspended' and new.status is distinct from old.status then
    raise exception 'Not allowed: this listing is suspended and only Hallnect can restore it';
  end if;

  return new;
end;
$function$;
