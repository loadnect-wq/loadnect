-- ─────────────────────────────────────────────────────────────────────────────
-- 0003_booking_tables.sql
-- Transactional tables: bookings, payments, availability.
-- bookings is created before availability/payments because they reference it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 8. bookings ───────────────────────────────────────────────────────────────
-- NOTE: financial amounts are stored on the booking at creation time so that
-- later price changes on the hall never retroactively alter past bookings.
create table if not exists public.bookings (
  id            uuid primary key default gen_random_uuid(),
  hall_id       uuid not null references public.halls (id)    on delete restrict,
  customer_id   uuid not null references public.profiles (id) on delete restrict,
  event_date    date not null,
  slot          booking_slot   not null default 'full_day',
  guest_count   integer check (guest_count is null or guest_count > 0),
  base_amount   numeric(12, 2) not null check (base_amount  >= 0),
  platform_fee  numeric(12, 2) not null default 0 check (platform_fee >= 0),
  total_amount  numeric(12, 2) not null check (total_amount >= 0),
  status        booking_status not null default 'pending_payment',
  customer_notes text,
  owner_notes    text,
  cancel_reason  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint event_date_not_past check (event_date >= '2024-01-01')
);

create index if not exists idx_bookings_hall     on public.bookings (hall_id);
create index if not exists idx_bookings_customer on public.bookings (customer_id);
create index if not exists idx_bookings_date     on public.bookings (event_date);
create index if not exists idx_bookings_status   on public.bookings (status);

-- DOUBLE-BOOKING PREVENTION (hard constraint):
-- Only one ACTIVE booking may hold a given (hall, date, slot). Pending-payment,
-- cancelled, rejected and refunded bookings do NOT reserve the slot, so the
-- index is partial. Full-day vs half-day overlap is additionally enforced by the
-- prevent_overlapping_booking trigger in 0006.
create unique index if not exists uq_booking_active_slot
  on public.bookings (hall_id, event_date, slot)
  where status in ('payment_success', 'booking_requested', 'owner_confirmed', 'completed');

-- ── 9. payments (Cashfree) ────────────────────────────────────────────────────
-- Written ONLY by the trusted server (service-role). No client write policy exists,
-- so RLS denies all client inserts/updates by default.
create table if not exists public.payments (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references public.bookings (id) on delete restrict,
  customer_id        uuid not null references public.profiles (id) on delete restrict,
  amount             numeric(12, 2) not null check (amount >= 0),
  currency           text not null default 'INR',
  status             payment_status not null default 'pending',
  -- Cashfree integration fields
  cashfree_order_id   text unique,
  cashfree_payment_id text,
  payment_session_id  text,
  payment_method      text,
  payment_message     text,
  raw_response        jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_payments_booking  on public.payments (booking_id);
create index if not exists idx_payments_customer on public.payments (customer_id);
create index if not exists idx_payments_status   on public.payments (status);

-- ── 7. availability ───────────────────────────────────────────────────────────
-- Per-hall calendar. Unique on (hall, date, slot) prevents duplicate rows.
create table if not exists public.availability (
  id         uuid primary key default gen_random_uuid(),
  hall_id    uuid not null references public.halls (id) on delete cascade,
  date       date not null,
  slot       booking_slot        not null default 'full_day',
  status     availability_status not null default 'available',
  booking_id uuid references public.bookings (id) on delete set null,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_availability_hall_date_slot unique (hall_id, date, slot)
);

create index if not exists idx_availability_hall_date on public.availability (hall_id, date);
create index if not exists idx_availability_status    on public.availability (status);
