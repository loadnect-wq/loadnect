-- ─────────────────────────────────────────────────────────────────────────────
-- 0117_hall_page_views.sql
--
-- HOW MANY PEOPLE OPENED A VENUE'S PAGE, PER DAY (2026-10-14). For the owner's
-- monthly Insights page. Until now the only page-view data was Google
-- Analytics, which loads only for visitors who accept the consent banner and is
-- not broken down per hall, so an owner could not be told how many families
-- looked at their venue.
--
-- A COUNTER ONLY, exactly like hall_qr_scans (0107): one row per hall per day
-- holding a number. No visitor data of any kind: no IP, no cookie, no id, no
-- user agent. The page sends one signal per browser per hall per day
-- (de-duplicated in the browser's own storage); the server ignores bots and
-- the hall's own owner and admins, and only then calls the function below.
--
-- ONLY APPROVED HALLS COUNT. The function checks the hall is live before it
-- writes, so a crafted call cannot create rows for a hidden or rejected hall.
-- Only the service role may call it; the owner reads their own halls' rows
-- through RLS (owns_hall), as with QR scans.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.hall_page_views (
  hall_id    uuid not null references public.halls(id) on delete cascade,
  view_date  date not null,
  views      integer not null default 0 check (views >= 0),
  updated_at timestamptz not null default now(),
  primary key (hall_id, view_date)
);

comment on table public.hall_page_views is
  'Daily count of browsers that opened each live venue page (one per browser per day). A counter only: no visitor data.';

alter table public.hall_page_views enable row level security;

drop policy if exists hall_page_views_select on public.hall_page_views;
create policy hall_page_views_select on public.hall_page_views
  for select using (public.owns_hall(hall_id) or public.is_admin());

revoke all on public.hall_page_views from anon, authenticated;
grant select on public.hall_page_views to authenticated;
grant all on public.hall_page_views to service_role;

-- ═══ record_hall_page_view ══════════════════════════════════════════════════
-- India's day, as for QR scans: a view at 2 a.m. IST belongs to that morning.
-- Returns whether a view was counted (false for a hall that is not live).
create or replace function public.record_hall_page_view(_hall_id uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from public.halls h where h.id = _hall_id and h.status = 'approved') then
    return false;
  end if;
  insert into public.hall_page_views (hall_id, view_date, views)
  values (_hall_id, (now() at time zone 'Asia/Kolkata')::date, 1)
  on conflict (hall_id, view_date)
  do update set views = public.hall_page_views.views + 1, updated_at = now();
  return true;
end;
$function$;

revoke all on function public.record_hall_page_view(uuid) from public, anon, authenticated;
grant execute on function public.record_hall_page_view(uuid) to service_role;

-- ═══ Verify ═════════════════════════════════════════════════════════════════
do $verify$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'hall_page_views' and rowsecurity
  ) then
    raise exception '0117: table missing or RLS not enabled';
  end if;
  if has_function_privilege('anon', 'public.record_hall_page_view(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.record_hall_page_view(uuid)', 'execute') then
    raise exception '0117: a client role can record views';
  end if;
  if not has_function_privilege('service_role', 'public.record_hall_page_view(uuid)', 'execute') then
    raise exception '0117: service_role cannot record views';
  end if;
  if has_table_privilege('anon', 'public.hall_page_views', 'SELECT') then
    raise exception '0117: anon can read view counts';
  end if;
  if has_table_privilege('authenticated', 'public.hall_page_views', 'INSERT')
     or has_table_privilege('authenticated', 'public.hall_page_views', 'UPDATE') then
    raise exception '0117: authenticated can write view counts';
  end if;
  if not has_table_privilege('authenticated', 'public.hall_page_views', 'SELECT')
     or not has_table_privilege('service_role', 'public.hall_page_views', 'INSERT') then
    raise exception '0117: owners or the service role lost the access they need';
  end if;
end
$verify$;
