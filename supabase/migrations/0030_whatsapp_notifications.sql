-- ─────────────────────────────────────────────────────────────────────────────
-- 0030_whatsapp_notifications.sql — WhatsApp becomes the notification channel.
--
-- Additive only: no drops, no data loss, no RLS weakening. The existing
-- notifications outbox from 0026 is EXTENDED rather than replaced, because it
-- already carries the properties WhatsApp needs — a UNIQUE dedupe_key for
-- idempotency, service-role-only writes, admin-or-own-row reads, and an
-- attempt counter. A parallel whatsapp_notifications table would have
-- duplicated all of that and split the admin dashboard in two.
--
-- WHAT WHATSAPP ADDS OVER SMS
--   • A message is a TEMPLATE reference plus positional variables, not a free
--     string. template_key / template_sid / template_variables record exactly
--     what was sent, so a failed send can be reproduced and audited.
--   • Delivery is asynchronous and multi-stage: Twilio accepts the message,
--     then reports queued → sent → delivered → read (or failed/undelivered)
--     over a webhook. delivery_status tracks that independently of our own
--     send-side status.
--   • Failures divide into permanent (not a WhatsApp user, template not
--     approved, bad credentials) and transient (rate limit, timeout). Retrying
--     a permanent failure just burns attempts, so it is recorded.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Outbox: WhatsApp columns ─────────────────────────────────────────────────
alter table public.notifications
  add column if not exists template_key         text,
  add column if not exists template_sid         text,
  add column if not exists template_variables   jsonb,
  add column if not exists delivery_status      text,
  add column if not exists delivery_updated_at  timestamptz,
  add column if not exists error_code           text,
  add column if not exists permanent_failure    boolean not null default false,
  add column if not exists test_mode            boolean not null default false;

-- New rows are WhatsApp. Existing rows keep whatever channel they recorded, so
-- history stays truthful about how it was actually sent.
alter table public.notifications
  alter column channel set default 'whatsapp';

do $mig$
begin
  -- Delivery status must be one of Twilio's documented message states.
  if not exists (
    select 1 from pg_constraint
    where conname = 'notif_delivery_status_valid'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications
      add constraint notif_delivery_status_valid
      check (
        delivery_status is null
        or delivery_status in ('queued','sending','sent','delivered','read','undelivered','failed','accepted','scheduled')
      );
  end if;

  -- A Content SID is HX + 32 hex characters. Constraining the shape here stops
  -- a mistyped environment variable from being recorded as if it were real.
  if not exists (
    select 1 from pg_constraint
    where conname = 'notif_template_sid_format'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications
      add constraint notif_template_sid_format
      check (template_sid is null or template_sid ~ '^HX[0-9a-fA-F]{32}$');
  end if;

  -- template_variables is an ORDERED positional list; anything else would make
  -- {{1}} ambiguous. Enforce that it is a JSON array when present.
  if not exists (
    select 1 from pg_constraint
    where conname = 'notif_template_vars_is_array'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications
      add constraint notif_template_vars_is_array
      check (template_variables is null or jsonb_typeof(template_variables) = 'array');
  end if;
end
$mig$;

-- The status callback arrives keyed by Twilio's Message SID, so that lookup
-- must be indexed. Partial: only sent rows ever carry one.
create index if not exists idx_notif_provider_msg
  on public.notifications (provider_message_id)
  where provider_message_id is not null;

-- Admin dashboard filters.
create index if not exists idx_notif_template_key on public.notifications (template_key);
create index if not exists idx_notif_delivery     on public.notifications (delivery_status);

-- ── Admin alert number lives in the existing settings row ────────────────────
-- platform_settings is already the single-row, admin-only configuration table
-- (0012/0017). The admin WhatsApp number belongs there rather than being
-- hardcoded, so it can be changed without a redeploy. The env var
-- ADMIN_WHATSAPP_NUMBER remains a deployment-level override for environments
-- whose database has not been configured yet.
alter table public.platform_settings
  add column if not exists admin_whatsapp_phone text;

do $mig$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'platform_admin_whatsapp_format'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      add constraint platform_admin_whatsapp_format
      check (admin_whatsapp_phone is null or admin_whatsapp_phone ~ '^\+[1-9][0-9]{7,14}$');
  end if;
end
$mig$;

-- ── Recipient preference ─────────────────────────────────────────────────────
-- Controls NON-critical messages only. Critical transactional messages
-- (booking/payment/cancellation) are always sent — a customer must not miss
-- "your booking is confirmed" because of a toggle.
--
-- Seeded from the existing sms_notifications_enabled so nobody who already
-- opted out of messages silently gets opted back in. That column is left in
-- place: it is the historical record of a choice, and dropping it would
-- destroy the evidence that the opt-out was ever made.
-- The backfill runs ONCE, on first application only.
--
-- Re-running this migration must not touch the column again: by then people
-- have set their WhatsApp preference directly, and copying the frozen
-- sms_notifications_enabled over it would silently resurrect old opt-ins for
-- anyone who has since opted out. So the "did this column already exist?"
-- check is taken BEFORE the ALTER, and the backfill is conditional on it.
do $mig$
declare
  already_existed boolean;
  legacy_exists   boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'whatsapp_notifications_enabled'
  ) into already_existed;

  alter table public.profiles
    add column if not exists whatsapp_notifications_enabled boolean not null default true;

  if already_existed then
    return;  -- re-run: leave live preferences alone
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'sms_notifications_enabled'
  ) into legacy_exists;

  if legacy_exists then
    update public.profiles
       set whatsapp_notifications_enabled = sms_notifications_enabled
     where sms_notifications_enabled is distinct from whatsapp_notifications_enabled;
  end if;
end
$mig$;
