-- ─────────────────────────────────────────────────────────────────────────────
-- 0110_event_plans.sql
--
-- THE FAMILY'S EVENT PLAN (Event Platform plan, phase 1). One plan per
-- function: the occasion, date, city, guests and budget, a board with one item
-- per category (hall, catering, decoration, photo and video, …) and a
-- checklist. Hallnect stops being "find a hall" and becomes the place the
-- family runs the whole function from — useful with halls alone, and the
-- place every vendor category lands in later.
--
-- PRIVATE TO THE FAMILY. A plan holds amounts, dates and the names and numbers
-- of vendors the family deals with outside Hallnect. Nobody else reads it: not
-- venues, and not Hallnect admins either — there is no admin policy, because
-- no support task needs another family's budget.
--
-- ACCESS GOES THROUGH ONE FUNCTION, plan_access(plan). Today it answers
-- 'owner' for the plan's owner and nothing for anyone else. Family sharing
-- (the next slice) will add 'editor' and 'viewer' members by changing that
-- function alone, so the policies below are written for those roles already:
-- any role may read, only owner and editor may write.
--
-- WRITES ARE THE FAMILY'S OWN, through RLS, from the session client. Nothing
-- here involves a second party, so — unlike leads and site visits — there is
-- no service-role write path to prove a caller through.
--
-- CATEGORIES ARE A FIXED LIST FOR NOW. Phase 2 introduces vendor_categories
-- as a table; this check constraint is then swapped for a foreign key. The
-- labels and the per-occasion defaults live in lib/plan.ts.
--
-- GRANTS ARE EXPLICIT, including service_role (see 0104).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.event_plans (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  -- A venue_categories slug, checked against the catalogue by the server.
  occasion    text not null check (char_length(occasion) between 1 and 60),
  -- Null until the family fixes the date (often waiting on the astrologer).
  event_date  date,
  city        text check (city is null or char_length(city) between 1 and 80),
  guests      integer check (guests is null or guests between 1 and 10000),
  budget      numeric(12, 0) check (budget is null or budget between 0 and 10000000000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_event_plans_owner on public.event_plans (owner_id, created_at desc);

comment on table public.event_plans is
  'A family''s plan for one function. Private to its owner (and, later, people it is shared with).';

create table if not exists public.event_plan_items (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references public.event_plans(id) on delete cascade,
  category        text not null check (category in (
                    'hall', 'catering', 'decoration', 'photo_video', 'makeup', 'music',
                    'invitations', 'return_gifts', 'priest', 'transport', 'other')),
  status          text not null default 'todo' check (status in (
                    'not_needed', 'todo', 'shortlisted', 'asked', 'visited', 'booked')),
  -- The chosen hall, for the hall item only. A delisted hall clears it rather
  -- than blocking the hall's deletion.
  hall_id         uuid references public.halls(id) on delete set null,
  -- A vendor the family deals with outside Hallnect: as typed, for their own use.
  vendor_name     text check (vendor_name is null or char_length(vendor_name) <= 120),
  vendor_phone    text check (vendor_phone is null or char_length(vendor_phone) <= 20),
  notes           text check (notes is null or char_length(notes) <= 1000),
  planned_amount  numeric(12, 0) check (planned_amount is null or planned_amount between 0 and 10000000000),
  quoted_amount   numeric(12, 0) check (quoted_amount is null or quoted_amount between 0 and 10000000000),
  paid_amount     numeric(12, 0) check (paid_amount is null or paid_amount between 0 and 10000000000),
  -- The next payment the family owes this vendor: the source of reminders later.
  next_due_date   date,
  next_due_amount numeric(12, 0) check (next_due_amount is null or next_due_amount between 0 and 10000000000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint event_plan_items_one_per_category unique (plan_id, category),
  constraint event_plan_items_hall_only_on_hall check (hall_id is null or category = 'hall')
);

create table if not exists public.event_plan_tasks (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.event_plans(id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 140),
  category      text check (category is null or category in (
                  'hall', 'catering', 'decoration', 'photo_video', 'makeup', 'music',
                  'invitations', 'return_gifts', 'priest', 'transport', 'other')),
  -- Template tasks are due a number of days before the function, so moving the
  -- date moves them. A task the family adds has its own date instead.
  offset_days   integer check (offset_days is null or offset_days between 0 and 730),
  due_date      date,
  done_at       timestamptz,
  -- Which template line created it; null for the family's own tasks.
  template_key  text check (template_key is null or char_length(template_key) <= 60),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  constraint event_plan_tasks_one_template_line unique (plan_id, template_key)
);

create index if not exists idx_event_plan_tasks_plan on public.event_plan_tasks (plan_id, sort_order);

drop trigger if exists trg_event_plans_updated_at on public.event_plans;
create trigger trg_event_plans_updated_at before update on public.event_plans
  for each row execute function public.set_updated_at();
drop trigger if exists trg_event_plan_items_updated_at on public.event_plan_items;
create trigger trg_event_plan_items_updated_at before update on public.event_plan_items
  for each row execute function public.set_updated_at();

-- ═══ plan_access ════════════════════════════════════════════════════════════
-- The caller's role on a plan: 'owner', or null. Family sharing extends this
-- one function with 'editor' and 'viewer'. SECURITY DEFINER so the items and
-- tasks policies can consult event_plans without a policy loop.
create or replace function public.plan_access(_plan uuid)
returns text language sql stable security definer set search_path to 'public' as $function$
  select 'owner'::text
  from public.event_plans p
  where p.id = _plan and p.owner_id = auth.uid();
$function$;

revoke all on function public.plan_access(uuid) from public, anon;
grant execute on function public.plan_access(uuid) to authenticated, service_role;

-- ═══ Row level security ═════════════════════════════════════════════════════
alter table public.event_plans      enable row level security;
alter table public.event_plan_items enable row level security;
alter table public.event_plan_tasks enable row level security;

-- The OWNER is recognised from the row itself, not only through plan_access:
-- an INSERT ... RETURNING (what creating a plan does) checks the select policy
-- against the new row, and plan_access cannot see a row its own statement is
-- still inserting. The dry run caught exactly that. Shared access still goes
-- through plan_access.
drop policy if exists event_plans_select on public.event_plans;
create policy event_plans_select on public.event_plans
  for select using (owner_id = auth.uid() or public.plan_access(id) is not null);
drop policy if exists event_plans_insert on public.event_plans;
create policy event_plans_insert on public.event_plans
  for insert with check (owner_id = auth.uid());
drop policy if exists event_plans_update on public.event_plans;
create policy event_plans_update on public.event_plans
  for update using (owner_id = auth.uid() or public.plan_access(id) in ('owner', 'editor'))
  with check (owner_id = auth.uid() or public.plan_access(id) in ('owner', 'editor'));
drop policy if exists event_plans_delete on public.event_plans;
create policy event_plans_delete on public.event_plans
  for delete using (owner_id = auth.uid());

drop policy if exists event_plan_items_select on public.event_plan_items;
create policy event_plan_items_select on public.event_plan_items
  for select using (public.plan_access(plan_id) is not null);
drop policy if exists event_plan_items_write on public.event_plan_items;
create policy event_plan_items_write on public.event_plan_items
  for all using (public.plan_access(plan_id) in ('owner', 'editor'))
  with check (public.plan_access(plan_id) in ('owner', 'editor'));

drop policy if exists event_plan_tasks_select on public.event_plan_tasks;
create policy event_plan_tasks_select on public.event_plan_tasks
  for select using (public.plan_access(plan_id) is not null);
drop policy if exists event_plan_tasks_write on public.event_plan_tasks;
create policy event_plan_tasks_write on public.event_plan_tasks
  for all using (public.plan_access(plan_id) in ('owner', 'editor'))
  with check (public.plan_access(plan_id) in ('owner', 'editor'));

-- An owner cannot hand a plan to someone else by rewriting owner_id, and it is
-- the COLUMN GRANT below that stops it, not the update policy. The policy's
-- check runs plan_access, which reads the row as it was before the update, so
-- a rewritten owner_id would still pass it. owner_id is left out of the grant,
-- so the attempt fails before any policy runs; the dry run confirmed that the
-- refusal comes from the grant. Never add owner_id to it without a policy
-- that checks the new owner.
revoke all on public.event_plans      from anon, authenticated;
revoke all on public.event_plan_items from anon, authenticated;
revoke all on public.event_plan_tasks from anon, authenticated;
grant select, insert, delete on public.event_plans to authenticated;
grant update (title, occasion, event_date, city, guests, budget) on public.event_plans to authenticated;
grant select, insert, update, delete on public.event_plan_items to authenticated;
grant select, insert, update, delete on public.event_plan_tasks to authenticated;
grant all on public.event_plans      to service_role;
grant all on public.event_plan_items to service_role;
grant all on public.event_plan_tasks to service_role;
