-- 0058 — the PRIVATE half of an offline booking.
--
-- WHY A SEPARATE TABLE AND NOT COLUMNS ON `availability`.
-- availability_select is PUBLIC for approved halls — that is how the customer
-- calendar works at all. Putting an offline customer's name and phone on that
-- row would publish them to every visitor, and that customer never agreed to
-- appear on Hallnect. So availability stays the safe public projection
-- (hall, date, slot, status) and the identifying detail lives here.
--
-- WHY NOT A `bookings` ROW. bookings.customer_id is NOT NULL and references
-- profiles; an offline customer has no Hallnect account. Making it nullable
-- would rewrite the meaning of every bookings RLS policy, all of which key on
-- customer_id = auth.uid(). The INVENTORY RULES are shared instead — both paths
-- go through assert_inventory_free — which is what "one authoritative inventory
-- rule" actually requires. Sharing a table was never the requirement.

create table if not exists public.offline_bookings (
  id             uuid primary key default gen_random_uuid(),
  hall_id        uuid not null references public.halls(id) on delete cascade,
  event_date     date not null,
  end_date       date not null,
  slot           booking_slot not null default 'full_day',
  customer_name  text,
  customer_phone text,
  notes          text,
  reference      text,
  status         text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  created_by     uuid references public.profiles(id) on delete set null,
  cancelled_by   uuid references public.profiles(id) on delete set null,
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint offline_bookings_date_order check (end_date >= event_date),
  constraint offline_bookings_name_len  check (customer_name  is null or char_length(customer_name)  between 1 and 120),
  constraint offline_bookings_phone_len check (customer_phone is null or char_length(customer_phone) between 1 and 20),
  constraint offline_bookings_notes_len check (notes          is null or char_length(notes)          between 1 and 1000),
  constraint offline_bookings_ref_len   check (reference      is null or char_length(reference)      between 1 and 80)
);

create index if not exists idx_offline_bookings_hall_date
  on public.offline_bookings (hall_id, event_date) where status = 'confirmed';

comment on table public.offline_bookings is
  'Bookings a venue took off-platform. The PRIVATE detail; the public inventory effect is the matching availability rows (status offline_booked).';

alter table public.offline_bookings enable row level security;

drop policy if exists offline_bookings_select on public.offline_bookings;
create policy offline_bookings_select on public.offline_bookings
  for select using (public.owns_hall(hall_id) or public.is_admin());

-- No client write policy, deliberately: writes go through the RPCs in 0060,
-- which hold the inventory lock. A direct write would skip it and reintroduce
-- the race 0057 exists to close.
revoke all on public.offline_bookings from anon, authenticated;
grant select on public.offline_bookings to authenticated;

drop trigger if exists trg_offline_bookings_updated_at on public.offline_bookings;
create trigger trg_offline_bookings_updated_at
  before update on public.offline_bookings
  for each row execute function public.set_updated_at();
