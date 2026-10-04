-- ─────────────────────────────────────────────────────────────────────────────
-- 0111_event_plan_sharing.sql
--
-- FAMILY SHARING AND VOTES (Event Platform plan, phase 1, slice 2). A plan's
-- owner shares it with the family through a link. The people who join see the
-- plan and vote on the options the family is choosing between in each
-- category — three halls, two caterers. The owner decides who may change
-- things.
--
-- WHO CAN DO WHAT
--   owner   everything, and the only one who invites, changes roles, removes
--           people and deletes the plan. Ownership stays event_plans.owner_id;
--           the owner is never a member row.
--   editor  changes the plan as the owner does — details, board, checklist,
--           options — but cannot invite, remove people or delete the plan.
--   viewer  sees everything and votes. Everyone joins as a viewer; the owner
--           makes a member an editor.
-- All of it still goes through plan_access(), which now also answers for
-- members. 0110's policies were written for these roles, so they cover
-- members without being touched.
--
-- JOINING GOES THROUGH ONE FUNCTION. A joiner cannot read the invite — only
-- the owner can — so join_event_plan(token), SECURITY DEFINER, checks the
-- token and adds the caller as a viewer. The token is 128 random bits made by
-- the server. Turning the link off deletes it, so a link sent to the wrong
-- group can be killed; people who already joined stay until the owner removes
-- them. Twenty people besides the owner, at most.
--
-- NAMES. Members see each other's names, and only names, through
-- event_plan_people(plan), which answers only to someone with access to that
-- plan. No policy on profiles changes.
--
-- VOTES. One favourite per person per category, so a family vote has a
-- winner. A vote must name an option of the same plan and category (composite
-- foreign key). It goes when the option goes, and when its voter leaves or is
-- removed from the plan.
--
-- SUSPENDED ACCOUNTS CANNOT WRITE. 0081 put a restrictive "active writer" rule
-- on every table a client writes; 0110 missed it for the three plan tables.
-- This adds it to those three and to the four new ones.
--
-- GRANTS ARE EXPLICIT, including service_role (see 0104).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.event_plan_members (
  plan_id    uuid not null references public.event_plans(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'viewer' check (role in ('editor', 'viewer')),
  joined_at  timestamptz not null default now(),
  primary key (plan_id, user_id)
);

create index if not exists idx_event_plan_members_user on public.event_plan_members (user_id);

comment on table public.event_plan_members is
  'People a plan is shared with, besides its owner. Rows are added only by join_event_plan().';

-- One live invite link per plan. A new link replaces the token; turning the
-- link off deletes the row.
create table if not exists public.event_plan_invites (
  plan_id    uuid primary key references public.event_plans(id) on delete cascade,
  token      text not null unique check (token ~ '^[A-Za-z0-9_-]{22,64}$'),
  created_at timestamptz not null default now()
);

-- What the family is choosing between in a category: a hall on Hallnect, or
-- any vendor typed by name, with the price they were given.
create table if not exists public.event_plan_options (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.event_plans(id) on delete cascade,
  category   text not null check (category in (
               'hall', 'catering', 'decoration', 'photo_video', 'makeup', 'music',
               'invitations', 'return_gifts', 'priest', 'transport', 'other')),
  hall_id    uuid references public.halls(id) on delete set null,
  name       text not null check (char_length(name) between 1 and 120),
  price      numeric(12, 0) check (price is null or price between 0 and 10000000000),
  note       text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  constraint event_plan_options_hall_only_on_hall check (hall_id is null or category = 'hall'),
  -- The target of the votes' composite foreign key.
  constraint event_plan_options_vote_target unique (id, plan_id, category)
);

create index if not exists idx_event_plan_options_plan on public.event_plan_options (plan_id, category, created_at);
create unique index if not exists uq_event_plan_options_hall
  on public.event_plan_options (plan_id, hall_id) where hall_id is not null;

create table if not exists public.event_plan_votes (
  plan_id    uuid not null,
  category   text not null,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  option_id  uuid not null,
  voted_at   timestamptz not null default now(),
  primary key (plan_id, category, user_id),
  constraint event_plan_votes_option foreign key (option_id, plan_id, category)
    references public.event_plan_options (id, plan_id, category) on delete cascade
);

create index if not exists idx_event_plan_votes_option on public.event_plan_votes (option_id);

-- ═══ plan_access, now with members ══════════════════════════════════════════
-- 'owner', 'editor', 'viewer' or null. Its grants are 0110's and are kept by
-- create or replace.
create or replace function public.plan_access(_plan uuid)
returns text language sql stable security definer set search_path to 'public' as $function$
  select coalesce(
    (select 'owner'::text from public.event_plans p where p.id = _plan and p.owner_id = auth.uid()),
    (select m.role from public.event_plan_members m where m.plan_id = _plan and m.user_id = auth.uid())
  );
$function$;

-- ═══ Joining ════════════════════════════════════════════════════════════════
-- Returns {outcome, plan}. Outcomes: joined, member, owner (already in),
-- invalid (no such link, or it was turned off), full, suspended, signed_out.
-- The plan row is locked so two people joining at once cannot pass the cap
-- together.
create or replace function public.join_event_plan(_token text)
returns jsonb
language plpgsql volatile security definer set search_path to 'public'
as $function$
declare
  _uid   uuid := auth.uid();
  _plan  uuid;
  _owner uuid;
begin
  if _uid is null then
    return jsonb_build_object('outcome', 'signed_out');
  end if;
  if not public.is_active_user() then
    return jsonb_build_object('outcome', 'suspended');
  end if;
  select p.id, p.owner_id into _plan, _owner
    from public.event_plan_invites i
    join public.event_plans p on p.id = i.plan_id
   where i.token = _token
     for update of p;
  if _plan is null then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if _owner = _uid then
    return jsonb_build_object('outcome', 'owner', 'plan', _plan);
  end if;
  if exists (select 1 from public.event_plan_members where plan_id = _plan and user_id = _uid) then
    return jsonb_build_object('outcome', 'member', 'plan', _plan);
  end if;
  if (select count(*) from public.event_plan_members where plan_id = _plan) >= 20 then
    return jsonb_build_object('outcome', 'full');
  end if;
  insert into public.event_plan_members (plan_id, user_id, role) values (_plan, _uid, 'viewer');
  return jsonb_build_object('outcome', 'joined', 'plan', _plan);
end;
$function$;

revoke all on function public.join_event_plan(text) from public, anon;
grant execute on function public.join_event_plan(text) to authenticated, service_role;

-- What the invite page shows before someone joins: the plan's name, occasion
-- and date, the owner's name, how many people are in it, and the caller's own
-- role if they are in it already. Signed-in callers only; null for a dead link.
create or replace function public.event_plan_invite_preview(_token text)
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'plan',       p.id,
    'title',      p.title,
    'occasion',   p.occasion,
    'event_date', p.event_date,
    'owner_name', nullif(btrim(pr.full_name), ''),
    'people',     1 + (select count(*) from public.event_plan_members m where m.plan_id = p.id),
    'my_role',    public.plan_access(p.id)
  )
  from public.event_plan_invites i
  join public.event_plans p on p.id = i.plan_id
  left join public.profiles pr on pr.id = p.owner_id
  where i.token = _token and auth.uid() is not null;
$function$;

revoke all on function public.event_plan_invite_preview(text) from public, anon;
grant execute on function public.event_plan_invite_preview(text) to authenticated, service_role;

-- The owner and the members, with names, for someone who has access to the plan.
create or replace function public.event_plan_people(_plan uuid)
returns table (user_id uuid, name text, role text, joined_at timestamptz)
language sql stable security definer set search_path to 'public'
as $function$
  select x.user_id, x.name, x.role, x.joined_at
  from (
    select p.owner_id as user_id, nullif(btrim(pr.full_name), '') as name, 'owner'::text as role, p.created_at as joined_at
      from public.event_plans p
      left join public.profiles pr on pr.id = p.owner_id
     where p.id = _plan
    union all
    select m.user_id, nullif(btrim(pr.full_name), ''), m.role, m.joined_at
      from public.event_plan_members m
      left join public.profiles pr on pr.id = m.user_id
     where m.plan_id = _plan
  ) x
  where public.plan_access(_plan) is not null
  order by x.joined_at;
$function$;

revoke all on function public.event_plan_people(uuid) from public, anon;
grant execute on function public.event_plan_people(uuid) to authenticated, service_role;

-- A member who leaves or is removed takes their votes with them. SECURITY
-- DEFINER because the owner removing someone has no right to delete that
-- person's votes directly.
create or replace function public.event_plan_member_left()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  delete from public.event_plan_votes where plan_id = old.plan_id and user_id = old.user_id;
  return old;
end;
$function$;

revoke all on function public.event_plan_member_left() from public, anon, authenticated;

drop trigger if exists trg_event_plan_member_left on public.event_plan_members;
create trigger trg_event_plan_member_left after delete on public.event_plan_members
  for each row execute function public.event_plan_member_left();

-- ═══ Row level security ═════════════════════════════════════════════════════
alter table public.event_plan_members enable row level security;
alter table public.event_plan_invites enable row level security;
alter table public.event_plan_options enable row level security;
alter table public.event_plan_votes   enable row level security;

-- Members: everyone in the plan sees who is in it. Only the owner changes a
-- role; the owner removes anyone, and anyone can leave. No insert policy —
-- joining is join_event_plan's job.
drop policy if exists event_plan_members_select on public.event_plan_members;
create policy event_plan_members_select on public.event_plan_members
  for select using (public.plan_access(plan_id) is not null);
drop policy if exists event_plan_members_update on public.event_plan_members;
create policy event_plan_members_update on public.event_plan_members
  for update using (public.plan_access(plan_id) = 'owner')
  with check (public.plan_access(plan_id) = 'owner');
drop policy if exists event_plan_members_delete on public.event_plan_members;
create policy event_plan_members_delete on public.event_plan_members
  for delete using (public.plan_access(plan_id) = 'owner' or user_id = auth.uid());

-- Invites: the owner's alone. Editors cannot read the link, so only the owner
-- decides who else gets in.
drop policy if exists event_plan_invites_owner on public.event_plan_invites;
create policy event_plan_invites_owner on public.event_plan_invites
  for all using (public.plan_access(plan_id) = 'owner')
  with check (public.plan_access(plan_id) = 'owner');

-- Options: everyone sees them; owner and editors add, change and remove them.
drop policy if exists event_plan_options_select on public.event_plan_options;
create policy event_plan_options_select on public.event_plan_options
  for select using (public.plan_access(plan_id) is not null);
drop policy if exists event_plan_options_write on public.event_plan_options;
create policy event_plan_options_write on public.event_plan_options
  for all using (public.plan_access(plan_id) in ('owner', 'editor'))
  with check (public.plan_access(plan_id) in ('owner', 'editor'));

-- Votes: everyone sees them; each person casts, moves and withdraws only their
-- own, and only in a plan they are in.
drop policy if exists event_plan_votes_select on public.event_plan_votes;
create policy event_plan_votes_select on public.event_plan_votes
  for select using (public.plan_access(plan_id) is not null);
drop policy if exists event_plan_votes_own on public.event_plan_votes;
create policy event_plan_votes_own on public.event_plan_votes
  for all using (user_id = auth.uid() and public.plan_access(plan_id) is not null)
  with check (user_id = auth.uid() and public.plan_access(plan_id) is not null);

-- Suspended accounts cannot write to any plan table (see 0081). Restrictive,
-- so it only adds "and the account is active" to the rules above.
do $mig$
declare
  t text;
begin
  foreach t in array array[
    'event_plans', 'event_plan_items', 'event_plan_tasks',
    'event_plan_members', 'event_plan_invites', 'event_plan_options', 'event_plan_votes'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_active_writer_ins', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated '
      'with check (public.is_active_user())', t || '_active_writer_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_active_writer_upd', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated '
      'using (public.is_active_user()) with check (public.is_active_user())', t || '_active_writer_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_active_writer_del', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated '
      'using (public.is_active_user())', t || '_active_writer_del', t);
  end loop;
end
$mig$;

-- ═══ Grants ═════════════════════════════════════════════════════════════════
-- A member's role is the only member column anyone updates, and only the
-- owner, by the policy above. Options keep their category and hall: a vote for
-- one hall must never become a vote for another. Votes and invites are
-- upserted, which updates every column it sends, so they take whole-row
-- update; their policies keep each one to its own row and its own plan.
revoke all on public.event_plan_members from anon, authenticated;
revoke all on public.event_plan_invites from anon, authenticated;
revoke all on public.event_plan_options from anon, authenticated;
revoke all on public.event_plan_votes   from anon, authenticated;
grant select, delete on public.event_plan_members to authenticated;
grant update (role) on public.event_plan_members to authenticated;
grant select, insert, update, delete on public.event_plan_invites to authenticated;
grant select, insert, delete on public.event_plan_options to authenticated;
grant update (name, price, note) on public.event_plan_options to authenticated;
grant select, insert, update, delete on public.event_plan_votes to authenticated;
grant all on public.event_plan_members to service_role;
grant all on public.event_plan_invites to service_role;
grant all on public.event_plan_options to service_role;
grant all on public.event_plan_votes   to service_role;
