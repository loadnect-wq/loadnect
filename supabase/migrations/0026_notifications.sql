-- ─────────────────────────────────────────────────────────────────────────────
-- 0026_notifications.sql — SMS notification outbox + booking contact phone
--
-- Additive only: no drops, no data changes, no RLS weakening.
--
-- Design:
--  • notifications is an OUTBOX: every SMS the platform intends to send gets a
--    row FIRST (status pending), then the sender updates it to sent/failed/
--    skipped. With TWILIO_ENABLED=false rows are recorded as 'skipped' so the
--    whole pipeline is observable before credentials exist.
--  • dedupe_key is UNIQUE — the idempotency backbone. Webhook redelivery,
--    double-clicked buttons and re-run server actions hit 23505 and become
--    no-ops instead of duplicate SMS.
--  • Rows are inserted by the TRUSTED BACKEND only (service role / admin).
--    A customer session must never be able to forge a notification row —
--    the server composes recipients and content, never the client.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.notifications (
  id                  uuid primary key default gen_random_uuid(),
  dedupe_key          text not null unique,
  event_type          text not null,            -- 'booking.requested', 'payment.success', …
  recipient_type      text not null check (recipient_type in ('customer','owner','admin')),
  recipient_user_id   uuid references public.profiles (id) on delete set null,
  recipient_phone     text,                     -- E.164 snapshot at send time (may be null when missing)
  booking_id          uuid references public.bookings (id) on delete set null,
  hall_id             uuid references public.halls (id) on delete set null,
  message             text not null,
  channel             text not null default 'sms',
  provider            text not null default 'twilio',
  status              text not null default 'pending'
                      check (status in ('pending','processing','sent','failed','skipped','cancelled')),
  provider_message_id text,
  error_message       text,
  attempt_count       integer not null default 0,
  is_read             boolean not null default false,   -- admin notification center
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  failed_at           timestamptz,
  constraint notif_message_len    check (char_length(message) between 1 and 800),
  constraint notif_event_len      check (char_length(event_type) between 3 and 64),
  constraint notif_dedupe_len     check (char_length(dedupe_key) between 3 and 200),
  constraint notif_attempts_sane  check (attempt_count between 0 and 10),
  -- Never a place for credentials: phone must look like E.164 when present.
  constraint notif_phone_format   check (recipient_phone is null or recipient_phone ~ '^\+[1-9][0-9]{7,14}$')
);

create index if not exists idx_notif_created   on public.notifications (created_at desc);
create index if not exists idx_notif_status    on public.notifications (status);
create index if not exists idx_notif_recipient on public.notifications (recipient_user_id);
create index if not exists idx_notif_booking   on public.notifications (booking_id);
create index if not exists idx_notif_event     on public.notifications (event_type);
-- Rate-limit lookups: recent sends to one phone.
create index if not exists idx_notif_phone_created on public.notifications (recipient_phone, created_at desc);

alter table public.notifications enable row level security;

-- Read: admins see everything; a user sees only rows addressed to them.
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications
  for select using (
    public.is_admin()
    or recipient_user_id = auth.uid()
  );

-- Write: trusted backend (service role) or admin sessions only. Customers and
-- owners can NEVER insert or update notification rows — recipients and content
-- are decided server-side.
drop policy if exists notif_insert on public.notifications;
create policy notif_insert on public.notifications
  for insert with check (public.is_trusted_backend() or public.is_admin());

drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications
  for update using (public.is_trusted_backend() or public.is_admin())
  with check (public.is_trusted_backend() or public.is_admin());

-- No delete policy: the outbox is history. (Admins can archive via is_read.)

-- ── Booking contact phone ────────────────────────────────────────────────────
-- The booking form already requires a phone but only embedded it in free-text
-- customer_notes. Store it structurally, normalized to E.164, so notifications
-- can reach the customer who actually made THIS booking (profiles.phone may
-- change later). Nullable: pre-existing rows have no structured phone.
alter table public.bookings
  add column if not exists contact_phone text;

do $mig$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_contact_phone_format' and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint booking_contact_phone_format
      check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$');
  end if;
end
$mig$;

-- ── SMS preference ───────────────────────────────────────────────────────────
-- Controls NON-critical SMS only (premium marketing-adjacent notices). Critical
-- transactional messages (booking/payment/cancellation) are always sent — a
-- customer must not miss "your booking is confirmed" because of a toggle.
alter table public.profiles
  add column if not exists sms_notifications_enabled boolean not null default true;
