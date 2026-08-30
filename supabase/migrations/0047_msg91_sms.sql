-- ─────────────────────────────────────────────────────────────────────────────
-- 0047_msg91_sms.sql — the notification channel becomes SMS over MSG91.
--
-- Additive and non-destructive: no table is dropped, no history is rewritten,
-- no RLS is weakened. The outbox from 0026/0030 is REUSED rather than replaced,
-- because it already carries everything this channel needs — a UNIQUE
-- dedupe_key for idempotency, service-role-only writes, admin-or-own-row reads,
-- an attempt counter and a delivery-status column.
--
-- WHAT CHANGES, AND WHY
--
--  1. template_sid -> provider_template_id.
--     The column held a Twilio Content SID (HX + 32 hex) and a CHECK enforced
--     that shape. An MSG91 template id is 24 hex characters, so the constraint
--     would reject every new row. RENAMED rather than added-alongside: one
--     column means the admin dashboard cannot show one value while the sender
--     used another. Existing HX values are kept and still permitted by the new
--     constraint, so history stays truthful about how it was actually sent.
--
--  2. Channel and provider defaults.
--     New rows are SMS via MSG91. Existing rows keep whatever they recorded.
--
--  3. platform_settings.admin_alert_phone.
--     A new column rather than a rename, because admin_whatsapp_phone is the
--     record of a real setting and the two names mean different things. The
--     value is copied once; the old column is left in place, frozen.
--
--  4. profiles.notifications_enabled.
--     Third and LAST name for this preference: 0026 called it
--     sms_notifications_enabled, 0030 called it whatsapp_notifications_enabled,
--     and both encoded a channel that then changed. This one does not name a
--     channel, so it survives the next one.
--
--     Seeded from whatsapp_notifications_enabled — the column the profile forms
--     have actually been writing — so nobody who opted out is silently opted
--     back in. The backfill runs ONCE, on first application, using the same
--     "did this column already exist?" guard 0030 documented: on a re-run,
--     people have since set this preference directly, and copying the frozen
--     old column over it would resurrect stale choices.
--
--  5. otp_attempts.
--     Phone-verification rate limiting was a module-level Map. On serverless
--     that resets on every cold start and is not shared between instances, so
--     "5 sends per hour" was really "5 per hour per lambda" — no ceiling at all
--     against anyone willing to retry until they landed on a fresh instance.
--     Attempts are now rows, so the limit holds across instances and restarts.
--     The table records THAT an attempt happened, never the code.
--
-- ROLLBACK:
--   alter table public.notifications rename column provider_template_id to template_sid;
--   alter table public.notifications drop constraint notif_provider_template_format;
--   alter table public.notifications alter column channel set default 'whatsapp';
--   alter table public.notifications alter column provider set default 'twilio';
--   alter table public.platform_settings drop column admin_alert_phone;
--   alter table public.profiles drop column notifications_enabled;
--   drop table public.otp_attempts;
--   drop function public.cleanup_otp_attempts();
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The template reference column ─────────────────────────────────────────
do $mig$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications'
      and column_name = 'template_sid'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications'
      and column_name = 'provider_template_id'
  ) then
    alter table public.notifications rename column template_sid to provider_template_id;
  end if;
end
$mig$;

alter table public.notifications
  add column if not exists provider_template_id text;

-- The old shape check named the old column and only allowed HX ids.
alter table public.notifications
  drop constraint if exists notif_template_sid_format;

do $mig$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'notif_provider_template_format'
      and conrelid = 'public.notifications'::regclass
  ) then
    -- Two shapes are legal: a 24-hex MSG91 template id (current), and an
    -- HX + 32-hex Twilio Content SID (history that must stay readable).
    -- Constraining the shape stops a mistyped environment variable being
    -- recorded as if it were a real template.
    alter table public.notifications
      add constraint notif_provider_template_format
      check (
        provider_template_id is null
        or provider_template_id ~ '^[0-9a-fA-F]{24}$'
        or provider_template_id ~ '^HX[0-9a-fA-F]{32}$'
      );
  end if;
end
$mig$;

-- ── 2. New rows are SMS over MSG91 ───────────────────────────────────────────
alter table public.notifications alter column channel  set default 'sms';
alter table public.notifications alter column provider set default 'msg91';

-- MSG91 returns a request id; delivery reports arrive keyed by it. The lookup
-- index from 0030 already covers provider_message_id, so nothing to add.

-- ── 3. Admin alert number ────────────────────────────────────────────────────
alter table public.platform_settings
  add column if not exists admin_alert_phone text;

do $mig$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'platform_admin_alert_phone_format'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      add constraint platform_admin_alert_phone_format
      check (admin_alert_phone is null or admin_alert_phone ~ '^\+[1-9][0-9]{7,14}$');
  end if;
end
$mig$;

-- Copy the number across ONLY where the new column is still empty, so a value
-- an admin has already set here is never overwritten by the frozen old one.
do $mig$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'platform_settings'
      and column_name = 'admin_whatsapp_phone'
  ) then
    update public.platform_settings
       set admin_alert_phone = admin_whatsapp_phone
     where admin_alert_phone is null
       and admin_whatsapp_phone is not null;
  end if;
end
$mig$;

-- ── 4. Channel-neutral notification preference ───────────────────────────────
do $mig$
declare
  already_existed boolean;
  legacy_exists   boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'notifications_enabled'
  ) into already_existed;

  alter table public.profiles
    add column if not exists notifications_enabled boolean not null default true;

  if already_existed then
    return;  -- re-run: leave live preferences alone
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'whatsapp_notifications_enabled'
  ) into legacy_exists;

  if legacy_exists then
    update public.profiles
       set notifications_enabled = whatsapp_notifications_enabled
     where whatsapp_notifications_enabled is distinct from notifications_enabled;
  end if;
end
$mig$;

-- ── 5. Durable OTP rate limiting ─────────────────────────────────────────────
-- NO OTP VALUE IS EVER STORED HERE. A row records that an attempt was made,
-- for which number, by which account, and whether it succeeded. That is all
-- the rate limiter needs, and storing more would turn a throttle into a
-- credential store.
create table if not exists public.otp_attempts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  phone      text not null,
  kind       text not null check (kind in ('send', 'check')),
  succeeded  boolean not null default false,
  created_at timestamptz not null default now(),
  constraint otp_attempt_phone_format check (phone ~ '^\+[1-9][0-9]{7,14}$')
);

-- The three lookups the limiter performs, in the order it performs them.
create index if not exists idx_otp_attempts_user_phone
  on public.otp_attempts (user_id, phone, kind, created_at desc);
create index if not exists idx_otp_attempts_phone
  on public.otp_attempts (phone, kind, created_at desc);
create index if not exists idx_otp_attempts_created
  on public.otp_attempts (created_at);

alter table public.otp_attempts enable row level security;

-- No policy grants anything to anon or authenticated. This table is written and
-- read ONLY by the trusted backend: a user who could read it would learn which
-- numbers other people are verifying, and a user who could DELETE from it could
-- erase their own failures and brute-force the code without limit.
drop policy if exists otp_attempts_backend on public.otp_attempts;
create policy otp_attempts_backend on public.otp_attempts
  for all using (public.is_trusted_backend())
  with check (public.is_trusted_backend());

revoke all on public.otp_attempts from anon, authenticated;

-- Retention. These rows are worthless once outside the longest window the
-- limiter looks back over (24 hours), and keeping them would slowly turn a
-- record of who verified which phone into a permanent one.
create or replace function public.cleanup_otp_attempts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.otp_attempts where created_at < now() - interval '7 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.cleanup_otp_attempts() from public, anon, authenticated;

notify pgrst, 'reload schema';
