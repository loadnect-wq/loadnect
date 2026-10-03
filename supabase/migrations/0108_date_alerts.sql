-- ─────────────────────────────────────────────────────────────────────────────
-- 0108_date_alerts.sql
--
-- "TELL ME IF A HALL FREES UP ON MY DATE." A date search hides every hall
-- with a full-day booking that day. When a family's date is taken at some of
-- them, the search page offers a browser alert: if one of those bookings is
-- removed, this browser is told, by name, which hall no longer has the date
-- booked. The growth plan's rule still holds — the alert never says "free";
-- it says the booking on Hallnect is gone and the hall confirms the date.
--
-- THE CHANNEL IS WEB PUSH, NOT SMS. A new SMS needs a DLT template that only
-- a person can register, and carriers have already refused one of ours. A
-- push alert needs no account and no phone number: the family taps once and
-- grants the browser permission. What is stored is the browser's push
-- address — an opaque URL at Google, Mozilla, Apple or Microsoft — and its
-- two encryption keys. No name, no phone, no IP, no user id.
--
-- THREE TABLES, all server-only (service role). No client reads or writes any
-- of them; the search page's server action validates and inserts, and the
-- cron sends.
--   date_alert_subscriptions  one browser watching one date (optionally one city)
--   date_alert_events         a (hall, date) whose last full-day block was removed
--   date_alert_deliveries     which hall each subscription was already told about
--
-- THE TRIGGER MUST NEVER BREAK AN OWNER'S DIARY. It fires on every delete and
-- every status/date/hall change on availability — the path that cancels a
-- booking, edits a diary entry and cascades a hall deletion. So:
--   * it returns before touching anything unless the OLD row was a full-day
--     block on a date someone is watching (one indexed lookup, usually false);
--   * events.hall_id has NO foreign key, because a cascading hall delete runs
--     this trigger for rows whose hall is already gone, and an FK would turn
--     that delete into an error;
--   * the body is wrapped in an exception block that downgrades any failure to
--     a WARNING. A missed alert is a lost nicety; a failed diary edit is a
--     broken product.
-- The sender re-checks everything at send time (the hall is approved, the
-- date is still not blocked), so the trigger only has to be cheap, not right
-- about the future.
--
-- GRANTS ARE EXPLICIT, including service_role (see 0104).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.date_alert_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  -- The browser's push service URL. The server action allows only the known
  -- push services' hosts, so the sender can never be pointed at an arbitrary
  -- URL; the check here is the backstop.
  endpoint         text not null check (endpoint ~ '^https://' and char_length(endpoint) between 20 and 1000),
  p256dh           text not null check (char_length(p256dh) between 40 and 200),
  auth             text not null check (char_length(auth) between 10 and 100),
  date             date not null,
  -- Exactly the search's city filter (halls.city), or null for every city.
  city             text check (city is null or char_length(city) between 1 and 80),
  created_at       timestamptz not null default now(),
  last_notified_at timestamptz,
  failure_count    integer not null default 0 check (failure_count between 0 and 100)
);

create unique index if not exists uq_date_alert_sub
  on public.date_alert_subscriptions (endpoint, date, coalesce(city, ''));
create index if not exists idx_date_alert_sub_date on public.date_alert_subscriptions (date);

comment on table public.date_alert_subscriptions is
  'Browsers waiting to hear that a booked hall frees up on a date. Push address and keys only: no personal data. Deleted once the date passes.';

create table if not exists public.date_alert_events (
  id           uuid primary key default gen_random_uuid(),
  hall_id      uuid not null,   -- deliberately no FK: see the header
  date         date not null,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);

-- One OPEN event per hall and date: a statement that removes a morning and an
-- evening row fires the trigger twice, and the second insert is a no-op.
create unique index if not exists uq_date_alert_event_open
  on public.date_alert_events (hall_id, date) where processed_at is null;
create index if not exists idx_date_alert_event_open
  on public.date_alert_events (created_at) where processed_at is null;

create table if not exists public.date_alert_deliveries (
  subscription_id uuid not null references public.date_alert_subscriptions(id) on delete cascade,
  hall_id         uuid not null,
  sent_at         timestamptz not null default now(),
  primary key (subscription_id, hall_id)
);

alter table public.date_alert_subscriptions enable row level security;
alter table public.date_alert_events        enable row level security;
alter table public.date_alert_deliveries    enable row level security;
-- No policies: nothing but the service role touches these tables.

revoke all on public.date_alert_subscriptions from anon, authenticated;
revoke all on public.date_alert_events        from anon, authenticated;
revoke all on public.date_alert_deliveries    from anon, authenticated;
grant all on public.date_alert_subscriptions to service_role;
grant all on public.date_alert_events        to service_role;
grant all on public.date_alert_deliveries    to service_role;

-- ═══ enqueue_date_alert ═════════════════════════════════════════════════════
-- The full-day set is lib/availability-status.ts's HARD_BLOCK_STATUSES — the
-- same statuses the date search excludes a hall for. An event means "this
-- hall would now appear in a search for this date again".
create or replace function public.enqueue_date_alert()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  full_day constant text[] := array['booked','blocked','full_day_booked','maintenance','offline_booked'];
begin
  if not (old.status::text = any (full_day)) then
    return null;
  end if;
  -- Still the same full-day claim on the same hall and day: nothing freed.
  if tg_op = 'UPDATE'
     and new.status::text = any (full_day)
     and new.date = old.date
     and new.hall_id = old.hall_id then
    return null;
  end if;
  if old.date < (now() at time zone 'Asia/Kolkata')::date then
    return null;
  end if;

  begin
    if exists (select 1 from public.date_alert_subscriptions s where s.date = old.date)
       and not exists (
         select 1 from public.availability a
         where a.hall_id = old.hall_id
           and a.date = old.date
           and a.status::text = any (full_day)
       ) then
      insert into public.date_alert_events (hall_id, date)
      values (old.hall_id, old.date)
      on conflict do nothing;
    end if;
  exception when others then
    raise warning 'enqueue_date_alert skipped (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$function$;

revoke all on function public.enqueue_date_alert() from public, anon, authenticated;

drop trigger if exists trg_availability_date_alert on public.availability;
create trigger trg_availability_date_alert
  after delete or update of status, date, hall_id on public.availability
  for each row execute function public.enqueue_date_alert();
