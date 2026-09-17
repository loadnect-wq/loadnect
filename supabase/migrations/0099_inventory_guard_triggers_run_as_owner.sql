-- ─────────────────────────────────────────────────────────────────────────────
-- 0099_inventory_guard_triggers_run_as_owner.sql — owners can accept and
-- complete paid bookings again.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE BUG (same class as 0096)
-- ════════════════════════════════════════════════════════════════════════════
-- Owner → Bookings → "Accept booking" on a paid booking returned "You don't
-- have permission to do this." (lib/errors.ts's text for Postgres 42501).
-- Found in the end-to-end sandbox payment test on a local database built from
-- these migrations, and confirmed against production's catalogue: identical
-- privileges there.
--
--   acceptBooking (owner SESSION client — RLS decides which rows it may touch)
--     → UPDATE bookings SET status = 'owner_confirmed'
--     → trg_guard_booking_against_blocks → guard_booking_against_blocks()
--         → PERFORM public.assert_inventory_free(...)          ✗ 42501
--
-- assert_inventory_free is SECURITY DEFINER with EXECUTE revoked from
-- `authenticated` (0057). guard_booking_against_blocks() is SECURITY INVOKER,
-- so its call is checked against the role that fired the trigger. The Cashfree
-- webhook and status page write as service_role, so paying never noticed; the
-- owner's own accept (→ owner_confirmed) and mark-complete (→ completed) do
-- not. Every direct booking would have stalled at "New Request" and been
-- auto-refunded when the 48-hour response window lapsed.
--
-- guard_block_against_bookings() on availability has the same shape. Today its
-- writers are SECURITY DEFINER RPCs or the service role, so it has not failed,
-- but it is fixed with its twin rather than left to break the day an owner
-- write reaches the table through the session client.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE FIX, AND WHY IT DOES NOT WEAKEN ANYTHING
-- ════════════════════════════════════════════════════════════════════════════
--   • WHO may update a booking or availability row is unchanged: RLS and
--     validate_booking_transition still decide, before and alongside this.
--   • assert_inventory_free STAYS REVOKED from anon and authenticated — the
--     /rest/v1/rpc door stays shut. Granting it back was rejected.
--   • A trigger function cannot be called through the API, and its own
--     EXECUTE is revoked below. It only checks the row being written.
--   • search_path is already pinned to public on both, which SECURITY DEFINER
--     requires. ALTER (not CREATE OR REPLACE) keeps the live bodies exactly.
--
-- VERIFIED locally with the fix: paid booking accepted by its owner →
-- owner_confirmed, calendar marked full_day_booked, owner share ₹11,500
-- recorded for payout. Without the fix the same click reproduced 42501.
--
-- ROLLBACK:
--   alter function public.guard_booking_against_blocks() security invoker;
--   alter function public.guard_block_against_bookings() security invoker;
-- ─────────────────────────────────────────────────────────────────────────────

alter function public.guard_booking_against_blocks() security definer;
alter function public.guard_block_against_bookings() security definer;

revoke all on function public.guard_booking_against_blocks() from public, anon, authenticated;
revoke all on function public.guard_block_against_bookings() from public, anon, authenticated;

do $verify$
begin
  if not (select prosecdef from pg_proc where oid = 'public.guard_booking_against_blocks()'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.guard_block_against_bookings()'::regprocedure) then
    raise exception '0099: inventory guard triggers are not SECURITY DEFINER';
  end if;
  if exists (
    select 1 from pg_proc
     where oid in ('public.guard_booking_against_blocks()'::regprocedure,
                   'public.guard_block_against_bookings()'::regprocedure)
       and not ('search_path=public' = any(coalesce(proconfig, '{}')))
  ) then
    raise exception '0099: a SECURITY DEFINER trigger function has no pinned search_path';
  end if;
  if has_function_privilege('authenticated',
       'public.assert_inventory_free(uuid,date,date,public.booking_slot,uuid,uuid)', 'execute') then
    raise exception '0099: assert_inventory_free must stay revoked from authenticated';
  end if;
end
$verify$;
