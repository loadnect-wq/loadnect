-- ─────────────────────────────────────────────────────────────────────────────
-- 0076_guard_support_ticket_privileged_columns.sql
--
-- VAPT FINDING (confirmed by a rolled-back probe as a real customer account):
-- a customer could INSERT a support ticket with the ADMIN's own fields already
-- filled in. All four persisted:
--
--     admin_response = 'FORGED: Refund approved by admin'
--     internal_notes = 'FORGED internal note'
--     status         = 'resolved'
--     assigned_to    = <any profile id>
--
-- WHY IT WAS POSSIBLE — the recurring shape in this schema. Two independent
-- layers have to agree and they did not:
--   • tickets_insert (RLS) checks ONLY `user_id = auth.uid()`. It says who may
--     file a ticket, and nothing about what the row may contain.
--   • the COLUMN GRANT from migration 0046 left `authenticated` holding INSERT
--     on every column, including the four above.
-- Grants are evaluated BEFORE RLS, and RLS is row-level, so neither layer was
-- ever going to catch a bad column. That is exactly what
-- guard_hall_privileged_columns and guard_profile_privileged_columns already
-- do for halls and profiles; support_tickets simply never got its equivalent.
--
-- WHAT THE FORGERY BUYS AN ATTACKER, in order of seriousness:
--   1. status='resolved' at creation — the ticket never appears in the admin's
--      open queue. A customer can file a complaint that is invisible by
--      construction; worse, so can someone building a paper trail ("I raised
--      it, nobody answered").
--   2. admin_response — the ticket renders a fabricated Hallnect reply to the
--      customer. "Refund approved by admin" in the platform's own voice, on the
--      platform's own page, is evidence in a payment dispute.
--   3. internal_notes — text the admin believes a colleague wrote.
--   4. assigned_to — routes the ticket to an arbitrary profile.
--
-- WHAT IS DELIBERATELY STILL ALLOWED: `priority`. The customer genuinely picks
-- it in the support form (app/_actions/tickets.ts:37, `v.priority ?? 'medium'`),
-- so constraining it here would break the feature. It is a queue-ordering hint
-- an admin can override, not an authorisation claim.
--
-- UPDATE is guarded too, though tickets_update is already admin-only. The
-- guard is the layer that does not depend on a policy staying correct: if a
-- future migration widens that policy the way tickets_insert was widened, this
-- still holds.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.guard_support_ticket_privileged_columns()
returns trigger
language plpgsql
-- SECURITY INVOKER (the default), NOT security definer — and this is the whole
-- correctness of the guard, not a style choice. is_trusted_backend() reads
-- current_user; inside a SECURITY DEFINER function current_user is the function
-- OWNER (postgres), which is in the trusted list, so the first branch would
-- return new for EVERY caller and the guard would never fire once. The first
-- attempt at this migration was written definer and its own verify block caught
-- it. Every sibling guard — guard_hall_privileged_columns,
-- guard_profile_privileged_columns, validate_booking_transition,
-- prevent_role_change — is likewise invoker.
set search_path = public
as $fn$
begin
  -- The admin and the trusted backend are the parties these columns belong to.
  if public.is_trusted_backend() or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.admin_response is not null
       or new.internal_notes is not null
       or new.assigned_to is not null then
      raise exception
        'support_tickets: the response, internal notes and assignee are written by Hallnect, not by the person filing the ticket';
    end if;

    -- A new ticket is an OPEN ticket. Anything else lets the filer decide
    -- whether Hallnect ever sees it.
    if new.status is distinct from 'open'::ticket_status then
      raise exception 'support_tickets: a new ticket always starts open';
    end if;

    return new;
  end if;

  -- UPDATE: same columns, same owner. Defence in depth behind an admin-only
  -- policy — see the header.
  if new.admin_response is distinct from old.admin_response
     or new.internal_notes is distinct from old.internal_notes
     or new.assigned_to    is distinct from old.assigned_to
     or new.status         is distinct from old.status then
    raise exception
      'support_tickets: the response, internal notes, assignee and status are set by Hallnect';
  end if;

  return new;
end;
$fn$;

-- The function must not be callable as an RPC; it is a trigger body only.
revoke all on function public.guard_support_ticket_privileged_columns() from public, anon, authenticated;

drop trigger if exists trg_guard_support_ticket_privileged_columns on public.support_tickets;
create trigger trg_guard_support_ticket_privileged_columns
  before insert or update on public.support_tickets
  for each row execute function public.guard_support_ticket_privileged_columns();

-- ── Verify: the forgery is refused, an honest ticket still works ────────────
-- No exception handler around the assertions: a verify block that swallows its
-- own raise reports success either way.
do $mig$
declare
  v_user uuid;
  v_id   uuid;
begin
  select id into v_user from public.profiles where role = 'customer' limit 1;
  if v_user is null then
    raise notice 'no customer profile - skipping behavioural verify';
    return;
  end if;

  -- Impersonate that customer exactly as the probe did.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- 1. The forgery must now be refused.
  begin
    insert into public.support_tickets (user_id, subject, message, category, admin_response)
    values (v_user, 'zz verify 0076', 'zz', 'other', 'FORGED');
    raise exception 'GUARD FAILED: admin_response was accepted from a customer';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'GUARD FAILED%' then raise; end if;
  end;

  begin
    insert into public.support_tickets (user_id, subject, message, category, status)
    values (v_user, 'zz verify 0076', 'zz', 'other', 'resolved');
    raise exception 'GUARD FAILED: a customer opened a ticket already resolved';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'GUARD FAILED%' then raise; end if;
  end;

  -- 2. An ordinary ticket must still be filed, priority included.
  insert into public.support_tickets (user_id, subject, message, category, priority, status)
  values (v_user, 'zz verify 0076 ok', 'zz', 'other', 'urgent', 'open')
  returning id into v_id;

  reset role;
  delete from public.support_tickets where id = v_id;
end
$mig$;
