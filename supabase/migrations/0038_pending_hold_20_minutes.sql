-- RECOVERED 2026-09-06 from supabase_migrations.schema_migrations, version
-- 20260827114700 "pending_hold_20_minutes". Applied to production but never
-- committed, so supabase/migrations/ could not rebuild the schema. Exported
-- verbatim; not re-run.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 0038: the pending-payment hold becomes 20 minutes.
--
-- WHY. Cashfree refuses an order_expiry_time that is not MORE than 15 minutes
-- out. With a 15-minute hold, the remaining window was at best exactly 15
-- minutes and always less in practice, so the gateway expiry had to be floored
-- ABOVE the hold — meaning every order outlived the booking it was paying for.
-- A 20-minute hold matches that floor, so a customer who pays promptly now has
-- an order that expires exactly when their hold does.
--
-- This trigger is a BACKSTOP: app/book/[slug]/actions.ts supplies expires_at on
-- every insert, and this only fires when it is null. It is updated all the same
-- so the two cannot disagree — a booking created by any other path (a repair
-- script, a future code path) must get the same window the app promises.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.stamp_pending_expiry()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if new.status = 'pending_payment' and new.expires_at is null then
    new.expires_at := now() + interval '20 minutes';
  end if;
  return new;
end;
$fn$;
