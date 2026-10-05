-- ─────────────────────────────────────────────────────────────────────────────
-- 0112_quotes_before_number.sql
--
-- TWO DECISIONS, 2026-10-05.
--
-- 1. DIRECT BOOKING IS SWITCHED OFF. Every venue takes enquiries. The code for
--    online booking, advances, refunds and payouts stays — premium plans and
--    commission settlement still pay through Cashfree — but no hall can be in
--    DIRECT_BOOKING mode. Dropping the two *_direct_booking_switched_off
--    constraints below (and restoring the column grant) is the way back.
--
-- 2. QUOTES BEFORE THE NUMBER. An enquiry now goes:
--
--      pending   the venue has the family's requirement — name, date,
--                guests, occasion, notes — but NOT their phone number
--      quoted    the venue answered with a quote: price, what is included,
--                advance asked, how long it is valid
--      accepted  the family accepted that quote; only now does the venue get
--                their number
--      confirmed the venue marked it booked at the agreed amount, which raises
--                Hallnect's commission
--
--    "No spam calls" stops being a promise about one venue and becomes the
--    shape of the product: a business that has not been chosen never has the
--    number to call.
--
-- THE NUMBER IS HIDDEN IN THE DATABASE, NOT ONLY ON SCREEN. Until now
-- `grant select on leads to authenticated` let an owner's session read
-- contact_phone straight from PostgREST for every verified enquiry. That
-- grant becomes a column list without contact_phone. Every read the app makes
-- of the number goes through the service role in lib/leads.ts, which releases
-- it to the venue only for an accepted or confirmed enquiry, and to the
-- family for their own.
--
-- AND BOOKED REQUIRES ACCEPTED. leads_booked_after_acceptance: a lead cannot
-- be confirmed unless the family accepted a quote first. Otherwise a venue
-- could confirm any enquiry at a token amount simply to unlock the number.
--
-- No row changes meaning: there are no leads, no bookings and no drafts in
-- production at the time of writing, and the one hall is already
-- LEAD_GENERATION.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Direct booking switched off ═════════════════════════════════════════
alter table public.halls alter column booking_mode set default 'LEAD_GENERATION';
update public.halls set booking_mode = 'LEAD_GENERATION' where booking_mode <> 'LEAD_GENERATION';

alter table public.halls drop constraint if exists halls_direct_booking_switched_off;
alter table public.halls
  add constraint halls_direct_booking_switched_off check (booking_mode = 'LEAD_GENERATION');

-- Owners chose their mode through this grant (0073). There is one mode now.
revoke update (booking_mode) on public.halls from authenticated;

update public.admin_hall_drafts set booking_mode = 'LEAD_GENERATION' where booking_mode <> 'LEAD_GENERATION';
alter table public.admin_hall_drafts drop constraint if exists admin_hall_drafts_direct_booking_switched_off;
alter table public.admin_hall_drafts
  add constraint admin_hall_drafts_direct_booking_switched_off check (booking_mode = 'LEAD_GENERATION');

-- ═══ 2. Quotes ══════════════════════════════════════════════════════════════
alter table public.leads
  add column if not exists quote_amount      numeric(12, 2)
    check (quote_amount is null or (quote_amount > 0 and quote_amount <= 1000000000)),
  add column if not exists quote_advance     numeric(12, 2)
    check (quote_advance is null or quote_advance >= 0),
  add column if not exists quote_includes    text
    check (quote_includes is null or char_length(quote_includes) <= 600),
  add column if not exists quote_note        text
    check (quote_note is null or char_length(quote_note) <= 300),
  add column if not exists quote_valid_until date,
  add column if not exists quoted_at         timestamptz,
  add column if not exists accepted_at       timestamptz;

alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads
  add constraint leads_status_check check (status in (
    'awaiting_verification', 'pending', 'quoted', 'accepted', 'confirmed', 'rejected', 'cancelled', 'expired'));

-- A quote the family can see is a whole quote.
alter table public.leads drop constraint if exists leads_quote_is_complete;
alter table public.leads
  add constraint leads_quote_is_complete check (
    status not in ('quoted', 'accepted')
    or (quote_amount is not null and quote_valid_until is not null and quoted_at is not null));

alter table public.leads drop constraint if exists leads_advance_within_quote;
alter table public.leads
  add constraint leads_advance_within_quote check (
    quote_advance is null or quote_amount is null or quote_advance <= quote_amount);

alter table public.leads drop constraint if exists leads_accepted_has_time;
alter table public.leads
  add constraint leads_accepted_has_time check (status <> 'accepted' or accepted_at is not null);

-- Booked only after the family chose this venue. See the header.
alter table public.leads drop constraint if exists leads_booked_after_acceptance;
alter table public.leads
  add constraint leads_booked_after_acceptance check (status <> 'confirmed' or accepted_at is not null);

-- One live enquiry per family, hall and date — now across the new states too.
drop index if exists public.uq_lead_active;
create unique index uq_lead_active
  on public.leads (hall_id, customer_id, event_date)
  where status in ('awaiting_verification', 'pending', 'quoted', 'accepted', 'confirmed');

-- ═══ 3. The number stays out of a venue's reach until the family accepts ═══
-- Every column a session may read, by name. A column added to leads later has
-- NO read grant until it is listed here — the safe default for this table.
revoke select on public.leads from authenticated;
grant select (
  id, hall_id, owner_id, customer_id, contact_name, phone_verified, phone_verified_at,
  event_date, event_type, guest_count, requirements, status, agreed_amount,
  confirmed_at, confirmed_by, responded_at, owner_notes, cancel_reason, created_at, updated_at,
  quote_amount, quote_advance, quote_includes, quote_note, quote_valid_until, quoted_at, accepted_at
) on public.leads to authenticated;

-- ═══ 4. Verify ══════════════════════════════════════════════════════════════
do $mig$
begin
  if has_column_privilege('authenticated', 'public.leads', 'contact_phone', 'SELECT') then
    raise exception 'authenticated can still read leads.contact_phone';
  end if;
  if not has_column_privilege('authenticated', 'public.leads', 'quote_amount', 'SELECT') then
    raise exception 'authenticated cannot read leads.quote_amount';
  end if;
  if has_table_privilege('authenticated', 'public.leads', 'UPDATE')
     or has_table_privilege('authenticated', 'public.leads', 'INSERT') then
    raise exception 'authenticated can write public.leads directly';
  end if;
  if has_column_privilege('authenticated', 'public.halls', 'booking_mode', 'UPDATE') then
    raise exception 'owners can still change halls.booking_mode';
  end if;
  if exists (select 1 from public.halls where booking_mode <> 'LEAD_GENERATION') then
    raise exception 'a hall is still in direct booking mode';
  end if;
end
$mig$;
