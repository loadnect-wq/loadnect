-- ─────────────────────────────────────────────────────────────────────────────
-- 0090_admin_hall_drafts.sql — a second onboarding pathway: an admin records a
-- venue before its owner has a Hallnect account, and the owner later claims it.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHY A SEPARATE TABLE AND NOT COLUMNS ON halls
-- ════════════════════════════════════════════════════════════════════════════
-- public.halls.owner_id is NOT NULL and references hall_owners(id). An
-- unclaimed listing has no owner by definition, so it cannot be a halls row
-- without making owner_id nullable — and owner_id being nullable would change
-- the meaning of every existing query, policy and component that treats an
-- owner as guaranteed. is_hall_owner() joins through it; the owner dashboard,
-- payouts and commissions all assume it resolves.
--
-- So nothing here touches halls at all. Until someone claims a draft, the halls
-- table is exactly as it was — same columns, same policies, same rows. That is
-- what makes this additive in the strict sense rather than the hopeful sense.
--
-- On claim, claim_admin_hall_draft() inserts a NORMAL halls row owned by the
-- claimant at status 'draft'. From that instant the listing is an ordinary hall:
-- the existing owner form edits it, the existing draft -> pending_approval
-- transition submits it, and the existing /admin/hall-approvals queue reviews
-- it. No parallel lifecycle, no second approval path to keep in step.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT STOPS THE WRONG PERSON CLAIMING A VENUE
-- ════════════════════════════════════════════════════════════════════════════
-- Knowing the phone number must not be enough — the brief is explicit, and it
-- is the whole security question here. Four independent layers:
--
--   1. NO WRITE PATH FOR A NON-ADMIN. Writes are granted to the `authenticated`
--      ROLE (which is what an admin authenticates as too, so a SQL grant cannot
--      separate them), and the only write policy on this table is
--      `admin_hall_drafts_admin_all`, which requires is_admin() in both USING
--      and WITH CHECK. The two claimant policies are SELECT-only. So a
--      non-admin PATCH of claim_status or claimed_by matches no rows — it
--      cannot flip a claim, and the claim itself happens only inside the
--      SECURITY DEFINER function below.
--   2. A VERIFIED PHONE. The function requires profiles.phone_verified — the
--      flag the existing MSG91 OTP flow sets — and that profiles.phone equals
--      the number the admin recorded. An unverified or mismatched phone claims
--      nothing.
--   3. AN EXISTING OWNER ACCOUNT. halls.owner_id points at hall_owners(id), so
--      the claimant must already have a business profile from the ordinary
--      owner-registration flow. This pathway does not create owners.
--   4. ONE CLAIM, ATOMICALLY. The UPDATE is guarded by
--      `where claim_status = 'unclaimed'` inside the same transaction that
--      inserts the hall, and the row is locked FOR UPDATE first. Two
--      simultaneous claims cannot both win, and a failure rolls back the hall.
--
-- ROLLBACK:
--   drop function if exists public.claim_admin_hall_draft(uuid);
--   drop table if exists public.admin_hall_drafts;
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.admin_hall_drafts (
  id uuid primary key default gen_random_uuid(),

  -- ── Provenance ────────────────────────────────────────────────────────────
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ── The venue. Mirrors public.halls column for column so the claim is a
  --    straight copy and no field can be captured that has nowhere to land.
  --    NOTE: halls has no `area` or `district` column, so neither is here —
  --    both belong in `address`, which is free text.
  name          text    not null,
  description   text,
  city          text    not null,
  state         text,
  address       text,
  pincode       text,
  latitude      numeric(9,6),
  longitude     numeric(9,6),
  capacity_min  integer,
  capacity_max  integer not null,   -- NOT NULL on halls, so required here too
  price_per_day numeric(12,2),
  price_morning numeric(12,2),
  price_evening numeric(12,2),
  venue_types   text[]  not null default '{}',

  -- LEAD_GENERATION by default, deliberately. An admin-entered listing has no
  -- availability calendar that anyone maintains, and offering online booking
  -- against a calendar nobody keeps risks double-booking a real venue on a real
  -- wedding day. The admin can change it; the owner can change it after
  -- claiming. The default is the one that cannot take a payment by mistake.
  booking_mode  text    not null default 'LEAD_GENERATION',

  -- Fanned out into hall_amenities / hall_custom_amenities / hall_images when
  -- the draft is claimed. Held flat here so a draft is self-contained and can
  -- be edited or discarded without touching any hall-shaped table.
  amenity_slugs    text[] not null default '{}',
  custom_amenities text[] not null default '{}',
  photo_urls       text[] not null default '{}',

  -- ── The person who should own it ──────────────────────────────────────────
  owner_name  text not null,
  owner_phone text not null,   -- E.164, matching profiles.phone
  owner_email text,

  -- ── Claim state ───────────────────────────────────────────────────────────
  claim_status    text not null default 'unclaimed',
  claimed_by      uuid references public.profiles(id) on delete set null,
  claimed_at      timestamptz,
  claimed_hall_id uuid references public.halls(id) on delete set null,

  admin_notes text,

  constraint admin_hall_drafts_claim_status_allowed
    check (claim_status in ('unclaimed', 'claimed', 'cancelled')),

  -- A claimed row must carry all three facts, and an unclaimed one none of
  -- them. Without this, a half-written claim leaves a row that reads as owned
  -- by nobody or owned twice.
  constraint admin_hall_drafts_claim_consistent check (
    (claim_status =  'claimed'
       and claimed_by is not null and claimed_at is not null and claimed_hall_id is not null)
    or
    (claim_status <> 'claimed'
       and claimed_by is null and claimed_at is null and claimed_hall_id is null)
  ),

  constraint admin_hall_drafts_capacity_sane
    check (capacity_max > 0 and (capacity_min is null or capacity_min <= capacity_max)),

  -- E.164. The matching in claim_admin_hall_draft is an equality test against
  -- profiles.phone, so a draft stored in any other format would silently never
  -- match and the owner would never see their hall.
  constraint admin_hall_drafts_phone_e164
    check (owner_phone ~ '^\+[1-9][0-9]{7,14}$'),

  -- Same vocabulary the halls CHECK enforces (0037).
  constraint admin_hall_drafts_venue_types_allowed
    check (venue_types <@ array['wedding', 'reception', 'party', 'banquet']::text[]),

  constraint admin_hall_drafts_booking_mode_allowed
    check (booking_mode in ('DIRECT_BOOKING', 'LEAD_GENERATION')),

  -- EVERY CONSTRAINT THE CLAIM WILL EVENTUALLY HIT BELONGS HERE TOO. halls
  -- carries halls_direct_booking_needs_price and the price_* >= 0 checks; if
  -- the draft did not, an admin could save a DIRECT_BOOKING listing with no
  -- price and the CHECK would fire weeks later on the halls INSERT inside
  -- claim_admin_hall_draft() — the owner clicks "Claim" and gets an opaque
  -- database error for someone else's mistake. Fail at the keystroke, not at
  -- the handover.
  constraint admin_hall_drafts_direct_booking_needs_price
    check (booking_mode <> 'DIRECT_BOOKING' or price_per_day is not null),

  constraint admin_hall_drafts_prices_non_negative
    check (
      (price_per_day is null or price_per_day >= 0)
      and (price_morning is null or price_morning >= 0)
      and (price_evening is null or price_evening >= 0)
    )
);

comment on table public.admin_hall_drafts is
  'Venues recorded by an admin before the owner has an account. Claimed via '
  'claim_admin_hall_draft(), which creates the real halls row. Nothing here is '
  'public: unclaimed drafts are invisible to customers and to search.';

-- The lookup the owner dashboard performs on every load: "is there an unclaimed
-- draft for my verified phone?" Partial, because claimed and cancelled rows are
-- never searched this way.
create index if not exists admin_hall_drafts_unclaimed_phone_idx
  on public.admin_hall_drafts (owner_phone)
  where claim_status = 'unclaimed';

create index if not exists admin_hall_drafts_unclaimed_email_idx
  on public.admin_hall_drafts (lower(owner_email))
  where claim_status = 'unclaimed' and owner_email is not null;

create index if not exists admin_hall_drafts_created_by_idx
  on public.admin_hall_drafts (created_by, created_at desc);

-- One draft can only ever produce one hall.
create unique index if not exists admin_hall_drafts_one_hall_idx
  on public.admin_hall_drafts (claimed_hall_id)
  where claimed_hall_id is not null;

drop trigger if exists trg_admin_hall_drafts_updated_at on public.admin_hall_drafts;
create trigger trg_admin_hall_drafts_updated_at
  before update on public.admin_hall_drafts
  for each row execute function public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.admin_hall_drafts enable row level security;

-- Admins own this table end to end: they create, edit and cancel drafts.
drop policy if exists admin_hall_drafts_admin_all on public.admin_hall_drafts;
create policy admin_hall_drafts_admin_all on public.admin_hall_drafts
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- The prospective owner may READ the draft that is waiting for them, and only
-- once their phone is VERIFIED. Without phone_verified this policy would show a
-- venue's details to anyone who typed the right number into their profile.
drop policy if exists admin_hall_drafts_claimant_read on public.admin_hall_drafts;
create policy admin_hall_drafts_claimant_read on public.admin_hall_drafts
  for select
  using (
    claim_status = 'unclaimed'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.phone_verified
        and p.phone is not null
        and p.phone = admin_hall_drafts.owner_phone
    )
  );

-- ...and afterwards, the draft they actually claimed, so the UI can explain
-- where their listing came from.
drop policy if exists admin_hall_drafts_claimed_read on public.admin_hall_drafts;
create policy admin_hall_drafts_claimed_read on public.admin_hall_drafts
  for select
  using (claimed_by = (select auth.uid()));

-- The write grants below are to the ROLE, and the ROLE is shared: an admin is an
-- `authenticated` user like anyone else, so the separation cannot live in the
-- GRANT. It lives in RLS — admin_hall_drafts_admin_all is the ONLY policy for
-- INSERT/UPDATE/DELETE and it demands is_admin() in both USING and WITH CHECK,
-- while the two claimant policies are SELECT-only. A non-admin write therefore
-- matches zero rows rather than erroring, which is the behaviour to expect when
-- probing this table.
grant select, insert, update, delete on public.admin_hall_drafts to authenticated;
revoke all on public.admin_hall_drafts from anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- claim_admin_hall_draft(uuid) — the only way a draft becomes a hall.
--
-- SECURITY DEFINER because it must insert a halls row on the caller's behalf
-- and flip claim state, neither of which the caller may do directly. Everything
-- it decides is derived from auth.uid() and the stored draft — nothing is taken
-- from the client except which draft is being claimed, and that is re-checked
-- against the caller's own verified phone before anything is written.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.claim_admin_hall_draft(_draft_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_draft     public.admin_hall_drafts%rowtype;
  v_profile   public.profiles%rowtype;
  v_owner_id  uuid;
  v_hall_id   uuid;
  v_base      text;
  v_slug      text;
  v_n         int := 1;
  v_amenity   record;
  v_photo     text;
  v_custom    text;
  v_idx       int := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Lock the draft first. Two people claiming the same venue at the same moment
  -- serialise here, and the second one finds claim_status already 'claimed'.
  select * into v_draft
  from public.admin_hall_drafts
  where id = _draft_id
  for update;

  if not found then
    raise exception 'That listing is no longer available.';
  end if;
  if v_draft.claim_status <> 'unclaimed' then
    raise exception 'That listing has already been claimed.';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    raise exception 'Not authenticated';
  end if;
  if v_profile.is_active = false then
    raise exception 'This account is not active.';
  end if;

  -- THE IDENTITY CHECK. A verified phone that equals the number the admin
  -- recorded. Email is deliberately NOT sufficient on its own: an email address
  -- can be typed by anyone, and the OTP flow is what actually proves control of
  -- a number.
  if v_profile.phone_verified is not true
     or v_profile.phone is null
     or v_profile.phone <> v_draft.owner_phone then
    raise exception 'This listing is registered to a different mobile number.';
  end if;

  -- halls.owner_id points at hall_owners(id), not profiles(id) — so the
  -- claimant needs a business profile, which the ordinary owner-registration
  -- flow creates. This pathway deliberately does not create owners.
  select ho.id into v_owner_id
  from public.hall_owners ho
  where ho.profile_id = v_uid;

  if v_owner_id is null then
    raise exception 'Complete your owner registration before claiming a listing.';
  end if;

  -- Slug: derived here rather than taken from the client. Mirrors the
  -- name-plus-city shape already in use, and counts up on collision.
  v_base := trim(both '-' from lower(regexp_replace(
              coalesce(v_draft.name, '') || '-' || coalesce(v_draft.city, ''),
              '[^a-zA-Z0-9]+', '-', 'g')));
  if v_base = '' then v_base := 'venue'; end if;
  v_slug := v_base;
  while exists (select 1 from public.halls where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  -- STATUS 'draft', NOT 'pending_approval'. The owner has not seen this listing
  -- yet; sending an admin's notes straight into the approval queue would ask a
  -- reviewer to approve something nobody has confirmed is accurate. The owner
  -- reviews it, then makes the ordinary draft -> pending_approval transition
  -- that every other hall makes.
  insert into public.halls (
    owner_id, name, slug, description, city, state, address, pincode,
    latitude, longitude, capacity_min, capacity_max,
    price_per_day, price_morning, price_evening,
    venue_types, booking_mode, status
  ) values (
    v_owner_id, v_draft.name, v_slug, v_draft.description, v_draft.city,
    v_draft.state, v_draft.address, v_draft.pincode,
    v_draft.latitude, v_draft.longitude, v_draft.capacity_min, v_draft.capacity_max,
    v_draft.price_per_day, v_draft.price_morning, v_draft.price_evening,
    v_draft.venue_types, v_draft.booking_mode, 'draft'
  )
  returning id into v_hall_id;

  -- Amenities the admin ticked, matched to the catalogue by slug. An unknown
  -- slug is skipped rather than invented.
  for v_amenity in
    select a.id from public.amenities a where a.slug = any (v_draft.amenity_slugs)
  loop
    insert into public.hall_amenities (hall_id, amenity_id)
    values (v_hall_id, v_amenity.id)
    on conflict do nothing;
  end loop;

  foreach v_custom in array v_draft.custom_amenities loop
    if length(trim(v_custom)) > 0 then
      insert into public.hall_custom_amenities (hall_id, name, sort_order)
      values (v_hall_id, trim(v_custom), v_idx)
      on conflict do nothing;   -- uq_hca_hall_name: a repeated name is not an error
      v_idx := v_idx + 1;
    end if;
  end loop;

  v_idx := 0;
  foreach v_photo in array v_draft.photo_urls loop
    if length(trim(v_photo)) > 0 then
      insert into public.hall_images (hall_id, url, is_cover, sort_order)
      values (v_hall_id, trim(v_photo), v_idx = 0, v_idx);
      v_idx := v_idx + 1;
    end if;
  end loop;

  -- The guarded flip. `where claim_status = 'unclaimed'` is belt-and-braces
  -- next to the FOR UPDATE above: if it ever matches zero rows the whole
  -- transaction rolls back, taking the halls row with it.
  update public.admin_hall_drafts
     set claim_status    = 'claimed',
         claimed_by      = v_uid,
         claimed_at      = now(),
         claimed_hall_id = v_hall_id
   where id = _draft_id
     and claim_status = 'unclaimed';

  if not found then
    raise exception 'That listing has already been claimed.';
  end if;

  return v_hall_id;
end;
$function$;

revoke all on function public.claim_admin_hall_draft(uuid) from public, anon;
grant execute on function public.claim_admin_hall_draft(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ── Self-verification ───────────────────────────────────────────────────────
do $verify$
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='admin_hall_drafts') then
    raise exception '0090: table was not created';
  end if;
  if not exists (
    select 1 from pg_tables where schemaname='public' and tablename='admin_hall_drafts' and rowsecurity
  ) then
    raise exception '0090: RLS is not enabled on admin_hall_drafts';
  end if;
  if has_table_privilege('anon', 'public.admin_hall_drafts', 'SELECT') then
    raise exception '0090: anon can read admin_hall_drafts';
  end if;
  -- halls must be untouched by this migration.
  if (select is_nullable from information_schema.columns
       where table_schema='public' and table_name='halls' and column_name='owner_id') <> 'NO' then
    raise exception '0090: halls.owner_id nullability changed — this migration must not touch halls';
  end if;
end
$verify$;
