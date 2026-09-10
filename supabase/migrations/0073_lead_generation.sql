-- ─────────────────────────────────────────────────────────────────────────────
-- 0073_lead_generation.sql
--
-- A second booking mode. A hall is either DIRECT_BOOKING — the existing flow,
-- where the customer pays an advance through Cashfree and Hallnect retains its
-- commission out of it — or LEAD_GENERATION, where Hallnect never touches the
-- customer's money and simply introduces them to the venue.
--
-- ═══ WHY LEADS ARE THEIR OWN TABLE ═══════════════════════════════════════════
--
-- The obvious move is a `booking_mode` column on `bookings` and one set of
-- rows. It is the wrong move here, and the reason is that `bookings` is not a
-- record — it is the hub of eight subsystems, every one of which would have to
-- learn about a mode it was never designed for:
--
--   • stamp_pending_expiry (0038) + lib/booking-expiry.ts — a row that is not
--     paid for is CANCELLED AFTER 20 MINUTES. A lead is never paid for, so a
--     lead in `bookings` is a lead that deletes itself over lunch.
--   • uq_booking_active_slot — a partial unique index that RESERVES the slot
--     for any row in an active status. A lead is explicitly not a reservation
--     (§21), so it must not enter that index.
--   • prevent_overlapping_booking (0006), the availability arbiter (0057),
--     payments, refunds, payouts, tax invoices, settlement — all keyed on a
--     bookings row and all assuming money exists.
--
-- Every one of those is a place where Direct Booking could break in a way that
-- shows up as a cancelled real booking rather than as a failing test. A lead
-- carries no money, holds no slot and has no payment, so it shares almost
-- nothing with a booking except the words "customer" and "date".
--
-- What is NOT duplicated: commission. Lead commissions go into the EXISTING
-- `commissions` table, because that table's shape is already right and a second
-- one would fragment the admin's reconciliation. See section 3.
--
-- ═══ SAFE FOR EXISTING DATA ═══════════════════════════════════════════════════
-- Additive and idempotent. Every existing hall becomes DIRECT_BOOKING by the
-- column default and nothing re-reads or rewrites a single booking, payment or
-- commission row.
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. halls.booking_mode                                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- text + CHECK rather than a Postgres enum, following 0037 (venue_types) and
-- 0017 (settlement_adjustment_status). An enum value cannot be removed and
-- cannot be added inside a transaction with its own first use — 0017 carries a
-- paragraph of commentary about working around exactly that.
--
-- The VALUES are uppercase because the brief names them explicitly and twice.
-- Lead statuses below are lowercase, matching booking_status. That inconsistency
-- is deliberate: each half follows the convention that governs it.
alter table public.halls
  add column if not exists booking_mode text not null default 'DIRECT_BOOKING';

do $mig$
begin
  alter table public.halls drop constraint if exists halls_booking_mode_allowed;
  alter table public.halls
    add constraint halls_booking_mode_allowed
    check (booking_mode in ('DIRECT_BOOKING', 'LEAD_GENERATION'));
end
$mig$;

-- ── Pricing becomes optional, but ONLY for a lead hall ───────────────────────
--
-- THE CONSTRAINT IS THE WHOLE POINT. Dropping NOT NULL on a column read in 77
-- places is how a "Contact for pricing" venue turns into a NaN on the homepage.
-- This CHECK makes it impossible for a DIRECT_BOOKING hall to carry a null
-- price, which means every existing code path — checkout, the advance
-- calculation, JSON-LD, search sorting — is reading a column that, for the rows
-- it can reach, is exactly as non-null as it was yesterday. The type widened;
-- the guarantee did not.
alter table public.halls alter column price_per_day drop not null;

do $mig$
begin
  alter table public.halls drop constraint if exists halls_direct_booking_needs_price;
  alter table public.halls
    add constraint halls_direct_booking_needs_price
    check (booking_mode <> 'DIRECT_BOOKING' or price_per_day is not null);
end
$mig$;

create index if not exists idx_halls_booking_mode on public.halls (booking_mode);

-- An owner switches their own listing between the two modes through
-- updateHall, which writes with the SESSION client — so the column needs a
-- grant. 0046 revoked the table-wide UPDATE and re-granted a named list;
-- anything not on that list is unwritable, which is why a column added later
-- has to say so here. Money columns are still absent by design.
grant update (booking_mode) on public.halls to authenticated;

-- 0072 revoked the table-wide SELECT on halls and re-granted every column by
-- name EXCEPT commission_rate. A column added after that migration therefore
-- has NO read grant at all and would 42703 the public catalogue the moment a
-- page named it. Both new-ish columns are re-granted here explicitly.
grant select (booking_mode) on public.halls to authenticated, anon;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. leads                                                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- STATUS IS THE GATE ON RULE 2 ("no lead reaches the owner before OTP").
-- A lead is born 'awaiting_verification' and is promoted to 'pending' only by
-- the server, after MSG91 has confirmed the code. The owner's SELECT policy
-- below additionally requires phone_verified — so an unverified lead is not
-- merely un-notified, it is UNREADABLE by the venue. That makes the rule a
-- database property rather than something every future call site has to
-- remember.
create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),
  hall_id       uuid not null references public.halls (id)       on delete restrict,
  -- Denormalised from halls.owner_id at creation. Not redundant: it is what
  -- lets the owner's dashboard, the commission row and the payout path find a
  -- lead without joining through a hall the caller may not be able to read.
  owner_id      uuid not null references public.hall_owners (id) on delete restrict,
  customer_id   uuid not null references public.profiles (id)    on delete restrict,

  -- Contact details AS GIVEN ON THIS ENQUIRY. Deliberately not read live from
  -- profiles: the venue is going to ring this number about this event, and a
  -- customer who later changes their profile phone must not silently redirect
  -- a call about a wedding that is already being planned.
  contact_name  text not null,
  contact_phone text not null,
  phone_verified    boolean not null default false,
  phone_verified_at timestamptz,

  event_date    date not null,
  event_type    text check (event_type is null
                            or event_type in ('wedding','reception','party','banquet')),
  guest_count   integer check (guest_count is null or guest_count > 0),
  requirements  text,

  status text not null default 'awaiting_verification'
    check (status in ('awaiting_verification','pending','confirmed','rejected','cancelled','expired')),

  -- What the venue and the customer actually settled on, entered by the OWNER
  -- at confirmation. THIS IS THE COMMISSION BASE, and it has to be entered
  -- rather than derived: a "Contact for pricing" hall has no price to derive
  -- from, and even a priced one is only a starting point in a negotiation the
  -- platform does not witness.
  agreed_amount numeric(12,2) check (agreed_amount is null or agreed_amount >= 0),

  confirmed_at  timestamptz,
  confirmed_by  uuid references public.profiles (id) on delete set null,
  responded_at  timestamptz,
  owner_notes   text,
  cancel_reason text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A confirmed lead is a commission-bearing event, so it must carry the
  -- number that commission is charged on. Enforced here rather than in the
  -- action so no future write path can produce a confirmed lead worth nothing.
  constraint leads_confirmed_has_amount
    check (status <> 'confirmed' or (agreed_amount is not null and confirmed_at is not null)),

  -- Verification and forwarding are the same event. A lead can only leave
  -- 'awaiting_verification' once the phone is verified.
  constraint leads_forwarded_is_verified
    check (status = 'awaiting_verification' or phone_verified)
);

create index if not exists idx_leads_hall     on public.leads (hall_id);
create index if not exists idx_leads_owner    on public.leads (owner_id);
create index if not exists idx_leads_customer on public.leads (customer_id);
create index if not exists idx_leads_status   on public.leads (status);
create index if not exists idx_leads_date     on public.leads (event_date);
create index if not exists idx_leads_created  on public.leads (created_at desc);

-- IDEMPOTENCY FOR SUBMISSION (§20). A double-tapped Send Enquiry, or a retried
-- server action, cannot produce two live enquiries for the same customer, hall
-- and date. Resolved leads (rejected/cancelled/expired) leave the index, so a
-- customer may legitimately enquire again later.
create unique index if not exists uq_lead_active
  on public.leads (hall_id, customer_id, event_date)
  where status in ('awaiting_verification','pending','confirmed');

drop trigger if exists trg_set_updated_at on public.leads;
create trigger trg_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. commissions learns about leads                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- EXTENDED, NOT DUPLICATED. A lead commission and a booking commission are the
-- same object — a percentage of a transaction, owed by a venue, in one of a
-- handful of states — and the admin has to reconcile them together. A parallel
-- `lead_commissions` table would mean two of every query, two summary cards
-- that must be added up by hand, and two places for the arithmetic to drift.
--
-- booking_id loses NOT NULL. Every existing row has one, and the CHECK below
-- guarantees every future row has exactly one of the two, so the column is no
-- less trustworthy than before — it is now "the booking, if this is a booking
-- commission" instead of "the booking".
alter table public.commissions
  add column if not exists lead_id uuid references public.leads (id) on delete restrict;

alter table public.commissions alter column booking_id drop not null;

do $mig$
begin
  alter table public.commissions drop constraint if exists commissions_one_source;
  alter table public.commissions
    add constraint commissions_one_source
    check (num_nonnulls(booking_id, lead_id) = 1);
end
$mig$;

-- One commission per lead, ever. This index IS the §20 guarantee against
-- duplicate commission creation — a second confirmation, a replayed action or
-- a concurrent double-click hits a unique violation instead of billing twice.
create unique index if not exists uq_commission_per_lead
  on public.commissions (lead_id)
  where lead_id is not null;

create index if not exists idx_commissions_hall_owner on public.commissions (hall_owner_id);
create index if not exists idx_commissions_status     on public.commissions (status);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. The commission settlement row can point at a lead's commission          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- owner_commission_payments needs no new columns — 0027 already gave it
-- cashfree_order_id, cashfree_payment_id, payment_session_id and raw_response,
-- and 0017 gave it the ownership/amount integrity trigger. It was retired by
-- 0039 because DIRECT BOOKING stopped billing owners. That reasoning does not
-- reach a lead: in a lead Hallnect never receives the customer's money, so
-- there is no advance to retain a commission out of, and billing the venue is
-- the only model available. 0039's decision about direct bookings stands.
--
-- WHAT IS NOT REVIVED: ocp_owner_insert, the policy 0039 dropped. Rows are
-- written by the SERVER (service role) after it has proved ownership and
-- computed the amount itself, so no client INSERT grant is needed and none is
-- restored. That is strictly tighter than the 0027 design it replaces.
comment on table public.owner_commission_payments is
  'Owner settlements of a Hallnect commission. Manual UPI rows are retired history '
  '(migration 0039). LIVE for LEAD_GENERATION commissions only (migration 0073): a '
  'lead never routes the customer money through Hallnect, so its commission is '
  'billed to the venue and paid by Cashfree order HNC_<payment id>. Direct-booking '
  'commission is still retained from the customer advance and is never billed. '
  'Written by the trusted backend only; owners may SELECT their own rows.';

-- The open-attempt index gains 'created' — the state a gateway order sits in
-- between "checkout opened" and "paid". Without it two concurrent Pay
-- Commission clicks could open two payable Cashfree orders for one debt, and
-- an owner could pay the same commission twice. A dead order is retired to
-- 'failed', which leaves the index and frees a genuine retry.
drop index if exists public.uq_ocp_open_per_commission;
create unique index if not exists uq_ocp_open_per_commission
  on public.owner_commission_payments (commission_id)
  where status in ('created','payment_submitted','payment_under_review');


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. The notification outbox learns about leads                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- notifications.booking_id is a real FK, so a lead's owner-SMS could not
-- reference its subject at all. Nullable and additive; the dedupe_key unique
-- index remains the idempotency mechanism and is untouched.
alter table public.notifications
  add column if not exists lead_id uuid references public.leads (id) on delete set null;

create index if not exists idx_notifications_lead on public.notifications (lead_id);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 6. RLS                                                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.leads enable row level security;

-- OWNER: their own halls' leads, AND ONLY ONCE VERIFIED. The phone_verified
-- clause is RULE 2 expressed as a permission — an unverified enquiry is not
-- merely un-notified, the venue cannot read it at all.
--
-- CUSTOMER: their own enquiries, verified or not (they need to see the one
-- they are part-way through verifying).
--
-- ADMIN: everything.
--
-- PUBLIC/anon: no policy, so default-deny.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select using (
    public.is_admin()
    or customer_id = auth.uid()
    or (public.owns_hall(hall_id) and phone_verified)
  );

drop policy if exists leads_admin_write on public.leads;
create policy leads_admin_write on public.leads
  for all using (public.is_admin()) with check (public.is_admin());

-- NO client INSERT or UPDATE policy, and no client write grants below.
-- Creating a lead, verifying it, confirming it and rejecting it are all server
-- actions that derive identity from the session and write with the service
-- role, which bypasses RLS. A customer cannot conjure a lead by PATCHing
-- PostgREST, and an owner cannot flip one to 'confirmed' — and therefore
-- cannot manufacture a commission, or suppress one.
revoke all on public.leads from anon, authenticated;
grant select on public.leads to authenticated;
grant all    on public.leads to service_role;

-- commissions_select could not see a lead commission: it tests ownership by
-- joining through commissions.booking_id, which is null on those rows, so an
-- owner would be shown a Commission Due page that was always empty while the
-- debt was real. Re-stated to cover both shapes.
--
-- The lead arm goes through owns_hall on the LEAD's hall rather than trusting
-- commissions.hall_owner_id, so the test is the same one the booking arm makes
-- and a mis-stamped hall_owner_id cannot widen anybody's view.
drop policy if exists commissions_select on public.commissions;
create policy commissions_select on public.commissions
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = commissions.booking_id and public.owns_hall(b.hall_id)
    )
    or exists (
      select 1 from public.leads l
      where l.id = commissions.lead_id and public.owns_hall(l.hall_id)
    )
  );


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 7. Verify                                                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Asserts the properties the application will now depend on. NO exception
-- handler: a verify block that swallows its own raise is worse than no verify
-- block, because it reports success either way.
do $mig$
declare
  offenders bigint;
begin
  -- Nothing silently changed mode.
  select count(*) into offenders from public.halls where booking_mode <> 'DIRECT_BOOKING';
  if offenders > 0 then
    raise exception 'migration changed the mode of % existing halls', offenders;
  end if;

  -- No direct-booking hall lost its price.
  select count(*) into offenders
  from public.halls
  where booking_mode = 'DIRECT_BOOKING' and price_per_day is null;
  if offenders > 0 then
    raise exception '% direct-booking halls have a null price', offenders;
  end if;

  -- Every historical commission still points at its booking.
  select count(*) into offenders
  from public.commissions where num_nonnulls(booking_id, lead_id) <> 1;
  if offenders > 0 then
    raise exception '% commission rows no longer have exactly one source', offenders;
  end if;

  -- A client must not be able to write a lead directly.
  if has_table_privilege('authenticated', 'public.leads', 'INSERT')
     or has_table_privilege('authenticated', 'public.leads', 'UPDATE') then
    raise exception 'authenticated can write public.leads directly';
  end if;
  if has_table_privilege('anon', 'public.leads', 'SELECT') then
    raise exception 'anon can read public.leads';
  end if;

  -- The catalogue must still be readable, including the column just added.
  if not has_column_privilege('anon', 'public.halls', 'booking_mode', 'SELECT') then
    raise exception 'anon cannot read halls.booking_mode - the catalogue would 42703';
  end if;
  if has_column_privilege('anon', 'public.halls', 'commission_rate', 'SELECT') then
    raise exception 'migration 0072 was undone - anon can read halls.commission_rate';
  end if;
end
$mig$;
