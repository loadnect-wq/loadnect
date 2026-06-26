-- ─────────────────────────────────────────────────────────────────────────────
-- 0016  Support ticket enhancements
--
-- 1. Replaces the priority CHECK to use low/medium/high/urgent
--    (was low/normal/high/urgent). Migrates any existing 'normal' rows
--    to 'medium'.
-- 2. Adds internal_notes — admin-only field NEVER shown to the user.
--    RLS table policy already restricts UPDATE to admin, so non-admin users
--    cannot write to this column. SELECT-level filtering of this column for
--    non-admin readers is handled at the app layer (the user reader/view does
--    not select internal_notes).
-- 3. Index on priority for filter performance.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Migrate existing data first, then swap the CHECK
update public.support_tickets set priority = 'medium' where priority = 'normal';

alter table public.support_tickets drop constraint if exists support_tickets_priority_check;
alter table public.support_tickets add constraint support_tickets_priority_check
  check (priority in ('low', 'medium', 'high', 'urgent'));

alter table public.support_tickets alter column priority set default 'medium';

-- 2. internal_notes
alter table public.support_tickets
  add column if not exists internal_notes text;

-- 3. priority index
create index if not exists idx_tickets_priority on public.support_tickets (priority);
