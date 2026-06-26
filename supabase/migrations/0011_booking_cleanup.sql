-- ─────────────────────────────────────────────────────────────────────────────
-- 0011_booking_cleanup.sql
-- Timeout + cleanup strategy for unpaid pending bookings.
--
-- Design:
--   • New `expires_at` column on bookings. For a freshly-created
--     pending_payment booking, this defaults to now() + 15 minutes.
--   • pending_payment bookings DO NOT match the partial unique index
--     `uq_booking_active_slot` (which is restricted to ACTIVE statuses), so
--     they never permanently block a slot. The slot remains visible/bookable
--     to anyone else while one customer is paying.
--   • Once the customer's payment webhook flips the booking to
--     `payment_success`, the unique index activates and the slot is reserved
--     for real. The `expires_at` becomes irrelevant.
--   • If the customer never pays, `cleanup_expired_pending_bookings()` flips
--     the row to `cancelled` and stamps `cancel_reason`. Cancelled bookings
--     also don't match the unique index, so this is safe to do repeatedly.
--
-- Operations:
--   • Recommended: schedule the cleanup function via pg_cron (see bottom).
--   • Fallback: the admin dashboard exposes a "Run cleanup now" action that
--     calls the same function on demand.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. expires_at column ─────────────────────────────────────────────────────
alter table public.bookings
  add column if not exists expires_at timestamptz;

-- Backfill any existing pending_payment rows with a sensible expiry.
update public.bookings
   set expires_at = created_at + interval '15 minutes'
 where status = 'pending_payment'
   and expires_at is null;

-- Partial index — only pending rows are interesting to the cleanup job.
create index if not exists idx_bookings_pending_expires
  on public.bookings (expires_at)
  where status = 'pending_payment';

-- ── 2. Cleanup function ──────────────────────────────────────────────────────
-- Marks expired pending_payment bookings as 'cancelled' with a reason.
-- Returns the number of rows cleaned up so the caller can log / display it.
--
-- SECURITY DEFINER + is_trusted_backend() exemption built into the existing
-- triggers: this function runs as the table owner ('postgres'), so:
--   - prevent_role_change → not relevant (we don't touch role)
--   - validate_booking_transition → bypassed (is_trusted_backend = true under
--     SECURITY DEFINER + postgres role), so we can move pending → cancelled
--     directly even without a normal user session.
create or replace function public.cleanup_expired_pending_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  with expired as (
    update public.bookings
       set status        = 'cancelled',
           cancel_reason = coalesce(cancel_reason, 'Payment window expired')
     where status = 'pending_payment'
       and expires_at is not null
       and expires_at < now()
    returning id
  )
  select count(*)::int into affected from expired;
  return coalesce(affected, 0);
end;
$$;

-- Only the trusted backend / admin should call this directly. RLS doesn't
-- apply to function execution itself, so we restrict EXECUTE.
revoke all on function public.cleanup_expired_pending_bookings() from public;
grant execute on function public.cleanup_expired_pending_bookings() to service_role;

-- ── 3. Stamp expires_at automatically when a pending_payment row is inserted ─
create or replace function public.stamp_pending_expiry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'pending_payment' and new.expires_at is null then
    new.expires_at := now() + interval '15 minutes';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_pending_expiry on public.bookings;
create trigger trg_stamp_pending_expiry
  before insert on public.bookings
  for each row execute function public.stamp_pending_expiry();

-- ── 4. (Optional) schedule with pg_cron ─────────────────────────────────────
-- Run this in the Supabase SQL editor AFTER applying this migration if your
-- project has the pg_cron extension enabled (it is in Supabase by default).
--
--   select cron.schedule(
--     'hallnect-cleanup-pending-bookings',
--     '* * * * *',                          -- every minute
--     $$ select public.cleanup_expired_pending_bookings(); $$
--   );
--
-- To remove:
--   select cron.unschedule('hallnect-cleanup-pending-bookings');
