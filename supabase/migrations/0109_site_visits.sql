-- ─────────────────────────────────────────────────────────────────────────────
-- 0109_site_visits.sql
--
-- BOOK A SITE VISIT. Families always see a hall before they pay for it. A
-- family picks a day and a time of day ("Saturday, morning") on the venue
-- page; the hall's owner sees the request on their dashboard and confirms or
-- declines it, with an optional message ("use the side gate"). It works for
-- both booking modes: an enquiry-only hall and a hall that takes advances.
--
-- A VISIT IS NOT A BOOKING OR AN ENQUIRY, and has its own table for the same
-- reason leads do (0073): bookings hold money and a slot, leads carry a
-- commission once confirmed. A visit holds neither — confirming one promises
-- the hall will be open for the family at that time, nothing more — so it
-- touches no availability, no payment and no commission.
--
-- ONLY A VERIFIED NUMBER REACHES THE HALL. The server action copies the
-- family's name and phone from their profile, and only when the profile's
-- phone is verified (the same MSG91 check that guards enquiries), so a visit
-- request can never put a stranger's number in front of a venue. The number
-- goes to that hall alone — the promise printed under every phone box.
--
-- READS: the family who asked, the hall's owner (owns_hall) and admins.
-- WRITES: none from clients. The server inserts and updates with the service
-- role after proving who the caller is — the customer from the session, the
-- owner through hall_owners.profile_id — exactly as lib/leads.ts does.
--
-- GRANTS ARE EXPLICIT, including service_role (see 0104).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.site_visits (
  id             uuid primary key default gen_random_uuid(),
  hall_id        uuid not null references public.halls(id) on delete cascade,
  customer_id    uuid not null references public.profiles(id) on delete cascade,
  visit_date     date not null,
  -- A time of day, not a clock time: owners keep their own hours, and the
  -- confirmation message is where a precise time is agreed.
  visit_window   text not null check (visit_window in ('morning', 'afternoon', 'evening')),
  party_size     smallint not null default 2 check (party_size between 1 and 20),
  note           text check (note is null or char_length(note) <= 300),
  -- Snapshots from the verified profile at request time, so a later profile
  -- edit does not rewrite who asked.
  contact_name   text not null check (char_length(contact_name) between 1 and 120),
  contact_phone  text not null check (contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  status         text not null default 'requested'
                 check (status in ('requested', 'confirmed', 'declined', 'cancelled')),
  owner_message  text check (owner_message is null or char_length(owner_message) <= 300),
  responded_at   timestamptz,
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now()
);

comment on table public.site_visits is
  'A family asking to see a hall on a day and time of day; the owner confirms or declines. No money, slot or commission attached.';

-- One live request per family, hall and day: a double tap cannot create two.
-- (One per family and hall across days is enforced by the server, which can
-- tell a past visit from an upcoming one.)
create unique index if not exists uq_site_visit_live_day
  on public.site_visits (hall_id, customer_id, visit_date)
  where status in ('requested', 'confirmed');
create index if not exists idx_site_visits_hall on public.site_visits (hall_id, visit_date);
create index if not exists idx_site_visits_customer on public.site_visits (customer_id, visit_date desc);

alter table public.site_visits enable row level security;

drop policy if exists site_visits_select on public.site_visits;
create policy site_visits_select on public.site_visits
  for select using (
    customer_id = auth.uid()
    or public.owns_hall(hall_id)
    or public.is_admin()
  );
-- No insert, update or delete policy: the server writes, after its own checks.

revoke all on public.site_visits from anon, authenticated;
grant select on public.site_visits to authenticated;
grant all on public.site_visits to service_role;
