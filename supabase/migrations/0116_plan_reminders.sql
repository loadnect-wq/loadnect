-- ─────────────────────────────────────────────────────────────────────────────
-- 0116_plan_reminders.sql
--
-- REMINDERS FOR A FAMILY'S EVENT PLAN (2026-10-14). The last slice of phase 1
-- of the event platform: a phone notification the morning a vendor payment or
-- a checklist task is due, and three days before a payment.
--
-- WEB PUSH, NOT SMS, for the reasons date alerts (0108) gave: a new SMS needs a
-- DLT template only the owner can register, and push needs no phone number. It
-- reuses the same VAPID key pair and the same service worker (public/sw.js).
--
-- ONE ROW PER PERSON, PER PLAN, PER PHONE. Turning reminders on is a choice each
-- member of a shared plan makes for their own device: the owner, an editor or a
-- viewer. user_id is kept so the sender can check, every morning, that the
-- person still has the plan (a removed family member stops hearing about it)
-- and that their account is active.
--
-- SERVER-ONLY TABLE. No policies and no grants to anon or authenticated: the
-- server action checks plan_access() with the caller's own session and then
-- writes with the service role, exactly as date_alert_subscriptions does. A
-- push address and its keys are the only things stored besides the ids.
--
-- last_sent_on is the once-a-day guard. The sender claims a row by setting it
-- to today before sending (two cron runs cannot both send), and clears it again
-- after a transient failure so the second run of the morning retries.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.event_plan_reminder_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.event_plans(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  -- The browser's push service URL. The server action allows only the known
  -- push services' hosts (lib/date-alerts.ts isAllowedPushEndpoint); this is
  -- the backstop, as in 0108.
  endpoint      text not null check (endpoint ~ '^https://' and char_length(endpoint) between 20 and 1000),
  p256dh        text not null check (char_length(p256dh) between 40 and 200),
  auth          text not null check (char_length(auth) between 10 and 100),
  created_at    timestamptz not null default now(),
  last_sent_on  date,
  failure_count integer not null default 0 check (failure_count between 0 and 100),
  constraint event_plan_reminder_subs_one_per_device unique (plan_id, user_id, endpoint)
);

create index if not exists idx_event_plan_reminder_subs_plan
  on public.event_plan_reminder_subscriptions (plan_id);
create index if not exists idx_event_plan_reminder_subs_user
  on public.event_plan_reminder_subscriptions (user_id);

comment on table public.event_plan_reminder_subscriptions is
  'Phones that get a morning reminder when a payment or task on an event plan is due. Push address and keys only. Server-only.';

alter table public.event_plan_reminder_subscriptions enable row level security;
-- No policies: nothing but the service role touches this table.
revoke all on public.event_plan_reminder_subscriptions from anon, authenticated;
grant all on public.event_plan_reminder_subscriptions to service_role;

-- ── Self-verification ───────────────────────────────────────────────────────
do $verify$
begin
  if not exists (
    select 1 from pg_tables
     where schemaname = 'public' and tablename = 'event_plan_reminder_subscriptions' and rowsecurity
  ) then
    raise exception '0116: table missing or RLS not enabled';
  end if;
  if has_table_privilege('anon', 'public.event_plan_reminder_subscriptions', 'SELECT')
     or has_table_privilege('authenticated', 'public.event_plan_reminder_subscriptions', 'SELECT')
     or has_table_privilege('authenticated', 'public.event_plan_reminder_subscriptions', 'INSERT') then
    raise exception '0116: a client role can read or write reminder subscriptions';
  end if;
  if not has_table_privilege('service_role', 'public.event_plan_reminder_subscriptions', 'INSERT') then
    raise exception '0116: service_role cannot write reminder subscriptions';
  end if;
  if exists (select 1 from pg_policies where tablename = 'event_plan_reminder_subscriptions') then
    raise exception '0116: the table must have no policies';
  end if;
end
$verify$;
