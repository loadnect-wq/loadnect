-- ─────────────────────────────────────────────────────────────────────────────
-- 0107_hall_qr_scans.sql
--
-- COUNTING THE STANDEE. Every listed hall can print a QR standee for its
-- reception desk (/owner/halls/[id]/standee). The code points at /q/<slug>,
-- which records the scan here and redirects to the venue page. An owner who
-- sees "scanned 23 times this month" keeps the standee on the desk; one who
-- sees nothing has no reason to.
--
-- ONE ROW PER HALL PER DAY, a counter — not a row per scan. Nothing about the
-- person scanning is stored: no IP, no user agent, no session. The question
-- this answers is "is the standee being used", and a daily count answers it
-- without holding anything that could identify a visitor.
--
-- WRITES: only record_hall_qr_scan, and only the service role may call it —
-- the /q route runs it server-side. No client can write the table, so the
-- count cannot be inflated from a browser console.
--
-- READS: the hall's owner (owns_hall) and admins, through RLS.
--
-- GRANTS ARE EXPLICIT, including service_role. From 30 October 2026 Supabase
-- no longer grants Data API access to new tables automatically; 0104 records
-- why every table in this schema states its own.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.hall_qr_scans (
  hall_id    uuid not null references public.halls(id) on delete cascade,
  scan_date  date not null,
  scans      integer not null default 0 check (scans >= 0),
  updated_at timestamptz not null default now(),
  primary key (hall_id, scan_date)
);

comment on table public.hall_qr_scans is
  'Daily scan count of each hall''s printed QR standee (/q/<slug>). A counter only: no visitor data.';

alter table public.hall_qr_scans enable row level security;

drop policy if exists hall_qr_scans_select on public.hall_qr_scans;
create policy hall_qr_scans_select on public.hall_qr_scans
  for select using (public.owns_hall(hall_id) or public.is_admin());

revoke all on public.hall_qr_scans from anon, authenticated;
grant select on public.hall_qr_scans to authenticated;
grant all on public.hall_qr_scans to service_role;

-- ═══ record_hall_qr_scan ════════════════════════════════════════════════════
-- The day is India's day, not UTC's: a scan at 2 a.m. IST belongs to that
-- morning, which is what an owner reading "today" means.
create or replace function public.record_hall_qr_scan(_hall_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  insert into public.hall_qr_scans (hall_id, scan_date, scans)
  values (_hall_id, (now() at time zone 'Asia/Kolkata')::date, 1)
  on conflict (hall_id, scan_date)
  do update set scans = public.hall_qr_scans.scans + 1, updated_at = now();
end;
$function$;

revoke all on function public.record_hall_qr_scan(uuid) from public, anon, authenticated;
grant execute on function public.record_hall_qr_scan(uuid) to service_role;

-- ═══ Verify ═════════════════════════════════════════════════════════════════
do $$
begin
  if has_function_privilege('anon', 'public.record_hall_qr_scan(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.record_hall_qr_scan(uuid)', 'execute') then
    raise exception '0107: a client role can record scans';
  end if;
  if not has_function_privilege('service_role', 'public.record_hall_qr_scan(uuid)', 'execute') then
    raise exception '0107: service_role cannot record scans';
  end if;
  if has_table_privilege('anon', 'public.hall_qr_scans', 'SELECT') then
    raise exception '0107: anon can read scan counts';
  end if;
  if has_table_privilege('authenticated', 'public.hall_qr_scans', 'INSERT')
     or has_table_privilege('authenticated', 'public.hall_qr_scans', 'UPDATE') then
    raise exception '0107: authenticated can write scan counts';
  end if;
  if not has_table_privilege('authenticated', 'public.hall_qr_scans', 'SELECT')
     or not has_table_privilege('service_role', 'public.hall_qr_scans', 'INSERT') then
    raise exception '0107: owners or the service role lost the access they need';
  end if;
  raise notice '0107: hall_qr_scans verified';
end $$;
