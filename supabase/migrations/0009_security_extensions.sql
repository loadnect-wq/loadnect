-- ─────────────────────────────────────────────────────────────────────────────
-- 0009_security_extensions.sql
-- Schema patches that complete the security spec:
--   1. halls.status default → 'pending_approval' (was 'draft')
--   2. Booking state-machine trigger — enforces which role can perform which
--      status transition. RLS controls who can SEE/TOUCH a row; this trigger
--      controls which (old_status → new_status) edges are legal per role.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Owner-created halls default to pending_approval ────────────────────────
alter table public.halls alter column status set default 'pending_approval';

-- ── 2. Booking state-machine trigger ──────────────────────────────────────────
-- Allowed transitions:
--   Customer (own booking):
--     pending_payment    → cancelled
--     payment_success    → cancelled
--     booking_requested  → cancelled
--     owner_confirmed    → cancelled         (subject to cancellation policy)
--   Owner (booking on their hall):
--     booking_requested  → owner_confirmed
--     booking_requested  → owner_rejected
--     owner_confirmed    → completed
--   Trusted backend / admin: any transition.
--
-- The trigger ALSO blocks customers and owners from rewriting financial fields
-- (amounts, customer_id, hall_id) — only the trusted backend or an admin may.
create or replace function public.validate_booking_transition()
returns trigger
language plpgsql set search_path = public
as $$
declare
  is_owner    boolean := public.owns_hall(new.hall_id);
  is_customer boolean := (new.customer_id = auth.uid());
  trusted     boolean := public.is_trusted_backend() or public.is_admin();
begin
  -- Trusted backends / admins bypass the state machine.
  if trusted then
    return new;
  end if;

  -- Lock financial + identity fields against tampering by customer/owner.
  if new.customer_id  is distinct from old.customer_id
     or new.hall_id   is distinct from old.hall_id
     or new.base_amount   is distinct from old.base_amount
     or new.platform_fee  is distinct from old.platform_fee
     or new.total_amount  is distinct from old.total_amount then
    raise exception 'Booking financial and identity fields are immutable';
  end if;

  -- If status didn't change, allow the (non-financial) update.
  if new.status = old.status then
    return new;
  end if;

  -- Customer-driven transitions.
  if is_customer and not is_owner then
    if not (
      (old.status = 'pending_payment'    and new.status = 'cancelled')
      or (old.status = 'payment_success' and new.status = 'cancelled')
      or (old.status = 'booking_requested' and new.status = 'cancelled')
      or (old.status = 'owner_confirmed' and new.status = 'cancelled')
    ) then
      raise exception
        'Customer cannot transition booking from % to %', old.status, new.status;
    end if;
    return new;
  end if;

  -- Owner-driven transitions.
  if is_owner then
    if not (
      (old.status = 'booking_requested' and new.status = 'owner_confirmed')
      or (old.status = 'booking_requested' and new.status = 'owner_rejected')
      or (old.status = 'owner_confirmed'  and new.status = 'completed')
    ) then
      raise exception
        'Owner cannot transition booking from % to %', old.status, new.status;
    end if;
    return new;
  end if;

  raise exception 'Not allowed: only customer, owner, or admin may transition this booking';
end;
$$;

drop trigger if exists trg_validate_booking_transition on public.bookings;
create trigger trg_validate_booking_transition
  before update on public.bookings
  for each row execute function public.validate_booking_transition();
