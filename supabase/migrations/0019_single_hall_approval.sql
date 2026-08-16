-- ─────────────────────────────────────────────────────────────────────────────
-- 0019_single_hall_approval.sql
-- Remove the OWNER-JOINING approval gate. The HALL becomes the single approval
-- (publishing) gate.
--
-- BUSINESS RULE:
--   Hallnect does not approve owners for joining the marketplace. Hallnect
--   approves individual HALLS before they are published to customers.
--
-- DESIGN — why the enum is left alone:
--   `user_role` keeps all four values. `owner_approved` now simply means
--   "active owner"; `owner_pending` becomes a legacy value that nothing assigns.
--   Dropping an enum value is destructive and would require rewriting every
--   dependent policy/function, so we do NOT drop it. Keeping the value means
--   every existing guard keeps working unchanged:
--     • RLS halls_insert  → is_owner_approved()
--     • route guards      → requireRole(["owner_approved"])
--   i.e. the HALL publishing gate is untouched by this migration.
--
-- WHAT IS NOT CHANGED (deliberately):
--   • hall_owners.is_verified — this is business/KYC verification shown as a
--     badge. It is NOT a gate: halls_insert never reads it. Legitimate
--     verification is preserved.
--   • halls_insert / halls_select / hall_images policies — the publishing
--     boundary. Draft/pending/rejected halls stay invisible to customers.
--   • Account suspension controls (profiles.is_active).
--
-- Additive + idempotent. No table/column/data is dropped.
-- ─────────────────────────────────────────────────────────────────────────────

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. New signups that ask to be an owner become ACTIVE owners immediately    ║
-- ║    (previously mapped to owner_pending, which required admin approval).    ║
-- ║    Still privilege-safe: a client can only ever request 'owner'; 'admin'   ║
-- ║    remains unassignable here.                                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  requested text := lower(coalesce(new.raw_user_meta_data ->> 'role', 'customer'));
  safe_role user_role;
begin
  -- 'owner' → owner_approved (active). Anything else → customer.
  -- NOTE: 'admin' and any unknown value can never be self-assigned here.
  safe_role := case
    when requested = 'owner' then 'owner_approved'::user_role
    else 'customer'::user_role
  end;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'name',
    safe_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. Migrate existing accounts stuck in the removed joining queue.          ║
-- ║    Per the new model every legitimate owner account becomes ACTIVE.       ║
-- ║    Their HALLS keep their own individual statuses — nothing is published   ║
-- ║    by this migration.                                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
update public.profiles
   set role = 'owner_approved'
 where role = 'owner_pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- End 0019. Hall approval is now the only publishing gate.
-- No hall status was modified: draft/pending/rejected halls remain unpublished.
-- ─────────────────────────────────────────────────────────────────────────────
