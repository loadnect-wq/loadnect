-- ─────────────────────────────────────────────────────────────────────────────
-- 0025_admin_audit_log.sql
-- Admin audit trail + moderation reasons.
--
-- WHY: 23 admin server actions existed but NONE of them recorded who did what.
-- A hall could be approved, a user suspended or a commission marked paid with no
-- attributable trail. Spec §9 requires every approval to record admin/timestamp/
-- previous status/new status/reason; §32 requires rejection reasons to be stored.
--
-- APPEND-ONLY BY DESIGN: there is deliberately NO update or delete policy, and a
-- guard trigger rejects both even for admins and the service role. An audit log
-- an admin can quietly rewrite is not an audit log.
--
-- Additive + idempotent. No existing table/column/policy is dropped.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.admin_audit_log (
  id              uuid primary key default gen_random_uuid(),
  -- Actor is ALWAYS derived from the authenticated session server-side and is
  -- never accepted from a client payload.
  actor_id        uuid references public.profiles (id) on delete set null,
  actor_email     text,
  action          text not null,          -- e.g. 'hall.approve', 'user.suspend'
  entity_type     text not null,          -- 'hall' | 'user' | 'advertisement' | …
  entity_id       uuid,
  previous_status text,
  new_status      text,
  reason          text,
  metadata        jsonb,
  created_at      timestamptz not null default now(),
  constraint audit_action_len check (char_length(action) between 3 and 64),
  constraint audit_reason_len check (reason is null or char_length(reason) <= 1000)
);

create index if not exists idx_audit_created  on public.admin_audit_log (created_at desc);
create index if not exists idx_audit_actor    on public.admin_audit_log (actor_id);
create index if not exists idx_audit_entity   on public.admin_audit_log (entity_type, entity_id);
create index if not exists idx_audit_action   on public.admin_audit_log (action);

alter table public.admin_audit_log enable row level security;

-- Admins read the trail; nobody else can see it at all (default-deny).
drop policy if exists audit_admin_select on public.admin_audit_log;
create policy audit_admin_select on public.admin_audit_log
  for select using (public.is_admin());

-- Only an admin (or the trusted backend) may append.
drop policy if exists audit_admin_insert on public.admin_audit_log;
create policy audit_admin_insert on public.admin_audit_log
  for insert with check (public.is_admin() or public.is_trusted_backend());

-- APPEND-ONLY: block UPDATE/DELETE unconditionally, including for admins and
-- the service role. Tamper-evidence is the whole point of the table.
create or replace function public.guard_audit_log_immutable()
returns trigger
language plpgsql set search_path = public
as $$
begin
  raise exception 'The admin audit log is append-only and cannot be modified or deleted';
end;
$$;

drop trigger if exists trg_audit_log_immutable on public.admin_audit_log;
create trigger trg_audit_log_immutable
  before update or delete on public.admin_audit_log
  for each row execute function public.guard_audit_log_immutable();

-- ── Moderation reason on halls (spec §32) ────────────────────────────────────
-- Lets the owner see WHY a hall was rejected instead of a bare status flip.
alter table public.halls
  add column if not exists rejection_reason text,
  add column if not exists moderated_at     timestamptz,
  add column if not exists moderated_by     uuid references public.profiles (id) on delete set null;
