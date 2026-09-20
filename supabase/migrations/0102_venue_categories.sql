-- ─────────────────────────────────────────────────────────────────────────────
-- 0102_venue_categories.sql — Hallnect becomes a multi-purpose venue
-- marketplace: one catalogue of occasions, editable by an admin, replacing
-- three hard-coded four-value CHECK constraints.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHY A CATALOGUE TABLE AND *NOT* A JUNCTION TABLE
-- ════════════════════════════════════════════════════════════════════════════
-- The obvious normalised shape is categories + hall_category_map. It was
-- rejected on purpose, and this is the one architectural decision in this
-- migration worth arguing with later.
--
-- halls.venue_types is ALREADY a many-to-many: a text[] of slugs, `not null
-- default '{}'`, GIN-indexed (0037), read by the search filter through a single
-- `overlaps`, by the venue page, by the owner form, by the admin draft claim,
-- by the JSON-LD builder and by the sitemap. It carries live production data.
--
-- Moving that to a junction table would mean:
--   • rewriting the one query that every public listing page runs, turning an
--     index-only array overlap into a join or an `in (subquery)` — the exact
--     "existing performance must not regress" risk;
--   • inventing row-level security for a NEW table whose owner must be
--     re-derived through halls.owner_id, where today the mapping simply IS a
--     column on the hall row and inherits the hall's policies verbatim. A new
--     writable table is a new attack surface on the listing that earns money;
--   • a data migration on live rows for no behavioural gain.
--
-- What the junction shape actually buys is an editable vocabulary — admins
-- adding an occasion without a deploy. That is bought here instead by making
-- the VOCABULARY a table while leaving the MEMBERSHIP where it already lives.
-- Adding "Baby Shower" is now one INSERT into venue_categories; no hall row,
-- no query, no policy and no component changes.
--
-- The cost is honest and small: membership is not itself referentially
-- constrained by a foreign key, so it is enforced by the trigger below instead.
-- That trigger is the equivalent of the FK, and it does something an FK cannot
-- (see "DEACTIVATION IS NOT DELETION").
--
-- ════════════════════════════════════════════════════════════════════════════
-- DEACTIVATION IS NOT DELETION
-- ════════════════════════════════════════════════════════════════════════════
-- An admin may deactivate a category. Halls that already declared it keep it:
-- the slug stays in their array, their venue page keeps saying so, and the
-- owner can still save the form. What deactivation does is stop it being
-- OFFERED — it leaves the owner's picker, the search chips and the category
-- pages, and no hall may newly ADD it.
--
-- So the rule the trigger enforces is asymmetric, and deliberately so:
--     every slug must EXIST in the catalogue;
--     every slug being ADDED must additionally be ACTIVE.
-- A plain foreign key gives the first half and cannot express the second. Had
-- this been `check (... in (select slug from ... where is_active))`, the first
-- deactivation would have frozen every hall that used that category out of its
-- own edit form — a silent, total lockout discovered by an owner, not by us.
--
-- There is no DELETE grant on this table for that reason. Categories go
-- inactive; they do not disappear from under historical data.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHY THE CHECKS HAD TO GO, AND WHAT REPLACES THEM
-- ════════════════════════════════════════════════════════════════════════════
-- A CHECK constraint cannot read another table — its expression must be
-- immutable. Three of them pinned the same four values:
--   halls_venue_types_allowed             (0037)
--   admin_hall_drafts_venue_types_allowed (0090)
--   leads.event_type's inline check        (0073)
-- Each is replaced by a BEFORE trigger calling the same validator, so the
-- vocabulary is defined in exactly one place and the three surfaces cannot
-- drift apart.
--
-- The trigger functions are SECURITY DEFINER. That is not decoration: it is the
-- lesson of 0096 and 0099. A SECURITY INVOKER trigger function that reads a
-- table the calling role cannot read raises 42501 for session-client writes
-- (an owner saving their hall) while service-role writes sail through — a
-- defect that only shows up for real users. venue_categories IS readable by
-- `authenticated`, so INVOKER would work today; DEFINER means it keeps working
-- if that grant is ever tightened. EXECUTE is revoked (0092): a trigger
-- function is not an API.
--
-- ════════════════════════════════════════════════════════════════════════════
-- BACKWARD COMPATIBILITY
-- ════════════════════════════════════════════════════════════════════════════
-- The four existing slugs — wedding, reception, party, banquet — are seeded
-- first and active. Every existing hall therefore validates unchanged, and NO
-- EXISTING ROW IS READ OR WRITTEN by this migration. There is no backfill:
-- halls that declared nothing still declare nothing, because 0037's rule
-- ("empty = not specified by the owner", not "all of them") is still the rule.
-- Assigning "wedding" to every existing hall would be inventing a claim about
-- a real business, which is what this codebase keeps refusing to do.
--
-- bookings.event_type is added NULLABLE with no default. Every historical
-- booking keeps meaning exactly what it meant; "we did not ask" stays
-- distinguishable from "the customer chose wedding".
--
-- ROLLBACK:
--   drop trigger if exists trg_bookings_event_type      on public.bookings;
--   drop trigger if exists trg_leads_event_type         on public.leads;
--   drop trigger if exists trg_hall_drafts_venue_types  on public.admin_hall_drafts;
--   drop trigger if exists trg_halls_venue_types        on public.halls;
--   drop function if exists public.validate_booking_event_type();
--   drop function if exists public.validate_lead_event_type();
--   drop function if exists public.validate_hall_draft_venue_types();
--   drop function if exists public.validate_hall_venue_types();
--   drop function if exists public.assert_venue_categories(text[], text[]);
--   alter table public.bookings drop column if exists event_type;
--   alter table public.halls add constraint halls_venue_types_allowed
--     check (venue_types <@ array['wedding','reception','party','banquet']::text[]);
--   alter table public.admin_hall_drafts add constraint admin_hall_drafts_venue_types_allowed
--     check (venue_types <@ array['wedding','reception','party','banquet']::text[]);
--   alter table public.leads add constraint leads_event_type_check
--     check (event_type is null or event_type in ('wedding','reception','party','banquet'));
--   drop table if exists public.venue_categories;
-- ─────────────────────────────────────────────────────────────────────────────

-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE CATALOGUE
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.venue_categories (
  id            uuid primary key default gen_random_uuid(),

  -- The stored value. This is what lands in halls.venue_types, leads.event_type
  -- and bookings.event_type, and what appears in a URL, so it is immutable in
  -- practice: renaming a slug orphans every hall that declared it and breaks
  -- every indexed /venues/<slug> page. The admin UI edits `name`, never this.
  slug          text not null,

  -- What a human reads. Safe to rename at any time; nothing keys on it.
  name          text not null,

  -- The lower-case plural used inside a sentence: "NS Mahal hosts weddings and
  -- birthday parties in Madurai." Stored rather than derived because English
  -- plurals are not a function of the singular ("Naming Ceremony" ->
  -- "naming ceremonies") and that sentence is on an indexed page.
  plural_noun   text not null,

  description   text,

  -- A lucide-react icon NAME, resolved through a lookup in the UI with a
  -- fallback. Deliberately not a URL or an SVG: an admin-editable field that
  -- reaches the DOM as markup is an XSS hole, and a remote asset on every tile
  -- is a third-party request on the homepage.
  icon          text,

  -- Which heading the category sits under in the owner's picker and the
  -- discovery grid. Pinned: these four organise the UI, so a typo would create
  -- an orphan group that renders nowhere.
  category_group text not null default 'other',

  -- Soft deactivation. See DEACTIVATION IS NOT DELETION above.
  is_active     bool not null default true,

  display_order int  not null default 1000,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint venue_categories_slug_shape
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 48),
  constraint venue_categories_name_len        check (char_length(name)        between 2 and 60),
  constraint venue_categories_plural_len      check (char_length(plural_noun) between 2 and 80),
  constraint venue_categories_description_len check (description is null or char_length(description) <= 400),
  constraint venue_categories_icon_shape
    check (icon is null or icon ~ '^[A-Za-z][A-Za-z0-9]{0,39}$'),
  constraint venue_categories_group_allowed
    check (category_group in ('celebrations', 'corporate', 'community', 'other')),
  constraint venue_categories_display_order_range
    check (display_order between 0 and 100000)
);

create unique index if not exists uq_venue_categories_slug
  on public.venue_categories (slug);

-- The catalogue is read on every render of the homepage, /halls, the owner
-- form and each category page, always in this order and almost always filtered
-- to the active rows.
create index if not exists idx_venue_categories_active_order
  on public.venue_categories (is_active, display_order, name);

comment on table public.venue_categories is
  'The occasions a venue can host. The single source of the vocabulary stored in halls.venue_types, admin_hall_drafts.venue_types, leads.event_type and bookings.event_type. Admin-editable; rows are deactivated, never deleted.';
comment on column public.venue_categories.slug is
  'Stored on halls/leads/bookings and used in /venues/<slug> URLs. Treat as immutable — renaming orphans existing halls and breaks indexed pages.';
comment on column public.venue_categories.is_active is
  'false = no longer offered. Halls that already declared it KEEP it and stay editable; it simply cannot be newly added. See 0102.';

-- ── updated_at ───────────────────────────────────────────────────────────────
-- Reuses the trigger function every other table here uses (0006).
drop trigger if exists trg_venue_categories_updated on public.venue_categories;
create trigger trg_venue_categories_updated
  before update on public.venue_categories
  for each row execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 2. SEED
-- ════════════════════════════════════════════════════════════════════════════
-- The first four rows are the 0037 vocabulary, unchanged, so every existing
-- hall validates. The rest are the expansion.
--
-- `on conflict (slug) do nothing` — re-running this migration must not undo an
-- admin's renames, reordering or deactivations.

insert into public.venue_categories (slug, name, plural_noun, category_group, icon, display_order, description) values
  -- ── Events & celebrations ────────────────────────────────────────────────
  ('wedding',            'Wedding',            'weddings',            'celebrations', 'Heart',          110, 'Marriage halls and mahals for the wedding day itself.'),
  ('reception',          'Reception',          'receptions',          'celebrations', 'Sparkles',       120, 'Evening reception venues with stage and dining.'),
  ('engagement',         'Engagement',         'engagements',         'celebrations', 'Gem',            130, 'Smaller halls for engagement and betrothal ceremonies.'),
  ('banquet',            'Banquet',            'banquets',            'celebrations', 'Building2',      140, 'Banquet halls for seated dining functions.'),
  ('birthday-party',     'Birthday Party',     'birthday parties',    'celebrations', 'Cake',           150, 'Party halls for birthdays, from first birthdays to milestones.'),
  ('anniversary',        'Anniversary',        'anniversaries',       'celebrations', 'HeartHandshake', 160, 'Venues for wedding anniversary celebrations.'),
  ('baby-shower',        'Baby Shower',        'baby showers',        'celebrations', 'Baby',           170, 'Intimate halls for valaikappu and baby showers.'),
  ('naming-ceremony',    'Naming Ceremony',    'naming ceremonies',   'celebrations', 'Baby',           180, 'Halls for naming ceremonies and cradle functions.'),
  ('family-function',    'Family Function',    'family functions',    'celebrations', 'Users',          190, 'General-purpose halls for family gatherings.'),
  ('party',              'Party',              'parties',             'celebrations', 'PartyPopper',    200, 'Party halls with music, lighting and open floor space.'),
  ('private-event',      'Private Event',      'private events',      'celebrations', 'Lock',           210, 'Venues available for private, invitation-only events.'),

  -- ── Corporate & business ─────────────────────────────────────────────────
  ('meeting',            'Meeting',            'meetings',            'corporate',    'Users',          310, 'Meeting rooms and small halls for business meetings.'),
  ('conference',         'Conference',         'conferences',         'corporate',    'Presentation',   320, 'Conference halls with seating, stage and projection.'),
  ('seminar',            'Seminar',            'seminars',            'corporate',    'GraduationCap',  330, 'Seminar halls for talks and presentations.'),
  ('workshop',           'Workshop',           'workshops',           'corporate',    'Wrench',         340, 'Rooms laid out for hands-on workshops.'),
  ('training',           'Training Programme', 'training programmes', 'corporate',    'BookOpen',       350, 'Training rooms for multi-day programmes.'),
  ('interview',          'Interview',          'interviews',          'corporate',    'ClipboardList',  360, 'Spaces for interview drives and walk-ins.'),
  ('corporate-event',    'Corporate Event',    'corporate events',    'corporate',    'Briefcase',      370, 'Venues for company offsites, annual days and awards.'),
  ('networking-event',   'Networking Event',   'networking events',   'corporate',    'Network',        380, 'Open-format venues for networking and meetups.'),
  ('product-launch',     'Product Launch',     'product launches',    'corporate',    'Rocket',         390, 'Halls suited to launches and press events.'),

  -- ── Social & community ───────────────────────────────────────────────────
  ('cultural-event',     'Cultural Event',     'cultural events',     'community',    'Drama',          510, 'Auditoriums and halls for music, dance and drama.'),
  ('community-event',    'Community Event',    'community events',    'community',    'UsersRound',     520, 'Halls for association meetings and community gatherings.'),
  ('religious-function', 'Religious Function', 'religious functions', 'community',    'Landmark',       530, 'Venues for religious ceremonies and prayer gatherings.'),
  ('college-event',      'College Event',      'college events',      'community',    'GraduationCap',  540, 'Larger halls for college fests, symposia and farewells.'),
  ('school-event',       'School Event',       'school events',       'community',    'School',         550, 'Halls for school annual days and competitions.'),
  ('exhibition',         'Exhibition',         'exhibitions',         'community',    'Store',          560, 'Open floor venues for exhibitions and stalls.'),

  -- ── Other ────────────────────────────────────────────────────────────────
  ('photoshoot',         'Photoshoot',         'photoshoots',         'other',        'Camera',         710, 'Venues rented by the hour for photo and video shoots.'),
  ('other-event',        'Other Event',        'events',              'other',        'CalendarDays',   720, 'Anything not covered by the other categories.')
on conflict (slug) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. VALIDATION
-- ════════════════════════════════════════════════════════════════════════════

/**
 * Raises unless every slug in `proposed` exists in the catalogue and every slug
 * NOT already in `existing` is also active.
 *
 * `existing` is the array as it stood before this write ('{}' on INSERT), which
 * is what makes deactivation survivable — see DEACTIVATION IS NOT DELETION.
 *
 * The messages name the offending slug because they surface to an owner through
 * sanitizeError's allow-list only as a generic failure; the detail is for the
 * log, and for an admin reading it in the SQL editor.
 */
create or replace function public.assert_venue_categories(
  proposed text[],
  existing text[] default '{}'::text[]
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  unknown_slug  text;
  inactive_slug text;
begin
  if proposed is null or array_length(proposed, 1) is null then
    return;
  end if;

  -- Duplicates are a client bug, not a vocabulary problem, but a hall listing
  -- "wedding, wedding" renders twice and sorts oddly. Reject it here rather
  -- than silently de-duplicating, so the caller learns.
  if array_length(proposed, 1) <> (select count(distinct s) from unnest(proposed) s) then
    raise exception 'venue category listed more than once'
      using errcode = '23514';
  end if;

  select s into unknown_slug
  from unnest(proposed) s
  where not exists (select 1 from public.venue_categories c where c.slug = s)
  limit 1;

  if unknown_slug is not null then
    raise exception 'unknown venue category: %', unknown_slug
      using errcode = '23514';
  end if;

  select s into inactive_slug
  from unnest(proposed) s
  where not (s = any(coalesce(existing, '{}'::text[])))
    and exists (select 1 from public.venue_categories c where c.slug = s and not c.is_active)
  limit 1;

  if inactive_slug is not null then
    raise exception 'venue category is no longer offered: %', inactive_slug
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.assert_venue_categories(text[], text[]) from public, anon, authenticated;

comment on function public.assert_venue_categories(text[], text[]) is
  'Vocabulary guard shared by halls, admin_hall_drafts, leads and bookings. Every slug must exist; newly ADDED slugs must also be active. Not an API — EXECUTE is revoked and it is reached only from the SECURITY DEFINER triggers below.';

-- ── halls ────────────────────────────────────────────────────────────────────

create or replace function public.validate_hall_venue_types()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Nothing to check when the array did not move. This keeps the catalogue out
  -- of the hot path for the many UPDATEs that touch price, status or
  -- updated_at — including the ones triggers themselves perform.
  if tg_op = 'UPDATE' and new.venue_types is not distinct from old.venue_types then
    return new;
  end if;

  perform public.assert_venue_categories(
    new.venue_types,
    case when tg_op = 'UPDATE' then old.venue_types else '{}'::text[] end
  );
  return new;
end;
$$;

revoke all on function public.validate_hall_venue_types() from public, anon, authenticated;

alter table public.halls drop constraint if exists halls_venue_types_allowed;

drop trigger if exists trg_halls_venue_types on public.halls;
create trigger trg_halls_venue_types
  before insert or update of venue_types on public.halls
  for each row execute function public.validate_hall_venue_types();

comment on column public.halls.venue_types is
  'Occasions this venue hosts, as venue_categories.slug values. Empty = not specified by the owner; such halls do not appear in typed category views. Validated by trg_halls_venue_types (0102), which replaced the four-value CHECK from 0037.';

-- ── admin_hall_drafts ────────────────────────────────────────────────────────
-- The admin-onboarding pathway (0090) carries the same array and must accept
-- the same vocabulary, or an admin could record a venue the claim would then
-- reject.

create or replace function public.validate_hall_draft_venue_types()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.venue_types is not distinct from old.venue_types then
    return new;
  end if;

  perform public.assert_venue_categories(
    new.venue_types,
    case when tg_op = 'UPDATE' then old.venue_types else '{}'::text[] end
  );
  return new;
end;
$$;

revoke all on function public.validate_hall_draft_venue_types() from public, anon, authenticated;

alter table public.admin_hall_drafts
  drop constraint if exists admin_hall_drafts_venue_types_allowed;

drop trigger if exists trg_hall_drafts_venue_types on public.admin_hall_drafts;
create trigger trg_hall_drafts_venue_types
  before insert or update of venue_types on public.admin_hall_drafts
  for each row execute function public.validate_hall_draft_venue_types();

-- ── leads ────────────────────────────────────────────────────────────────────
-- One value, nullable. An enquiry that named no occasion stays null.

create or replace function public.validate_lead_event_type()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.event_type is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.event_type is not distinct from old.event_type then
    return new;
  end if;

  perform public.assert_venue_categories(
    array[new.event_type],
    case when tg_op = 'UPDATE' and old.event_type is not null
         then array[old.event_type] else '{}'::text[] end
  );
  return new;
end;
$$;

revoke all on function public.validate_lead_event_type() from public, anon, authenticated;

do $$
declare
  c text;
begin
  -- 0073 wrote this as an inline column check, so its generated name is not
  -- something to guess. Find it by the column it constrains and drop it.
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'leads'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%event_type%'
  loop
    execute format('alter table public.leads drop constraint %I', c);
  end loop;
end
$$;

drop trigger if exists trg_leads_event_type on public.leads;
create trigger trg_leads_event_type
  before insert or update of event_type on public.leads
  for each row execute function public.validate_lead_event_type();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. bookings.event_type — what the customer said the hall was FOR
-- ════════════════════════════════════════════════════════════════════════════
-- The booking form has always asked ("Wedding", "Reception", …) and always
-- thrown the answer away into a sentence at the front of customer_notes, where
-- nothing could count it. It now lands in a column the owner dashboard and the
-- admin analytics can group by.
--
-- NULLABLE, NO DEFAULT, NO BACKFILL. Historical bookings did not record this;
-- inventing 'wedding' for them would put made-up numbers into the analytics
-- this column exists to feed. Null means "not recorded", and every reader must
-- say so rather than bucket it.
--
-- NOT CLIENT-WRITABLE. 0046 revoked table-wide INSERT/UPDATE on bookings and
-- re-granted a named column list; event_type is deliberately absent from it, so
-- this is written by the service role on the trusted booking path only — the
-- same rule as every other descriptive field on a paid booking.

alter table public.bookings
  add column if not exists event_type text;

comment on column public.bookings.event_type is
  'The occasion the customer selected, as venue_categories.slug. NULL = not recorded (every booking before 0102, and any created without the field). Never backfilled — analytics must report it as unknown, not as a guess.';

create or replace function public.validate_booking_event_type()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.event_type is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.event_type is not distinct from old.event_type then
    return new;
  end if;

  perform public.assert_venue_categories(
    array[new.event_type],
    case when tg_op = 'UPDATE' and old.event_type is not null
         then array[old.event_type] else '{}'::text[] end
  );
  return new;
end;
$$;

revoke all on function public.validate_booking_event_type() from public, anon, authenticated;

drop trigger if exists trg_bookings_event_type on public.bookings;
create trigger trg_bookings_event_type
  before insert or update of event_type on public.bookings
  for each row execute function public.validate_booking_event_type();

-- Owner and admin analytics group by this within one hall / one date window.
create index if not exists idx_bookings_event_type
  on public.bookings (event_type)
  where event_type is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. ROW-LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════════════
-- Same shape as premium_plans (0013): the catalogue is public reference data,
-- and only an admin writes it.
--
-- READ IS GATED ON is_active FOR EVERYONE BUT AN ADMIN. Not because an inactive
-- category is a secret, but because every public surface filters to the active
-- ones anyway, and a policy that returns them would let one forgotten `.eq`
-- put a retired occasion back on the homepage.
--
-- NO DELETE GRANT AND NO DELETE POLICY. Deactivation is the removal mechanism;
-- deleting a row that halls still reference would leave slugs the trigger then
-- refuses, locking those owners out of their own form.

alter table public.venue_categories enable row level security;

drop policy if exists venue_categories_read on public.venue_categories;
create policy venue_categories_read on public.venue_categories
  for select using (is_active or public.is_admin());

drop policy if exists venue_categories_admin_insert on public.venue_categories;
create policy venue_categories_admin_insert on public.venue_categories
  for insert with check (public.is_admin());

drop policy if exists venue_categories_admin_update on public.venue_categories;
create policy venue_categories_admin_update on public.venue_categories
  for update using (public.is_admin()) with check (public.is_admin());

-- ── REVOKE FIRST. A NEW TABLE HERE IS NOT BORN EMPTY OF PRIVILEGES ──────────
--
-- Supabase ships default privileges on this schema (pg_default_acl, grantor
-- `postgres`, objtype `r`) that grant anon AND authenticated `arwdxtm` — insert,
-- select, update, delete, references, trigger, maintain — on EVERY table created
-- in public. So `create table` alone left anon with table-wide INSERT and UPDATE
-- on the catalogue, and no amount of careful granting afterwards takes that
-- away: a grant only ever adds.
--
-- RLS was still the real gate (both write policies require is_admin()), so
-- nothing was exploitable — but a table-level UPDATE is exactly what made the
-- column list below a no-op, because a table-level privilege covers every
-- column and a column-level one cannot carve a hole in it. The first apply of
-- this migration failed on precisely that, at its own self-check.
--
-- Hence: revoke everything, then grant exactly what each role needs. 0090 does
-- the same for anon on admin_hall_drafts.
revoke all on public.venue_categories from anon, authenticated;

grant select on public.venue_categories to anon, authenticated;
grant insert on public.venue_categories to authenticated;

-- ── THE SLUG IS NOT UPDATABLE, AND THIS IS A COLUMN LIST FOR A REASON ───────
--
-- The slug is what every hall, lead and booking stores, and what every indexed
-- /venues/<slug> URL contains. An admin fixing a typo in `name` must not be
-- able to move it out from under them through a direct PostgREST call.
--
-- The obvious spelling — `grant update` then `revoke update (slug)` — DOES
-- NOTHING. Postgres treats a table-level privilege as covering every column,
-- and revoking a column-level privilege does not carve a hole in it; the
-- revoke succeeds silently and slug stays writable. So UPDATE is granted as an
-- explicit column list and slug is simply absent from it, the same shape 0046
-- uses for halls and bookings.
--
-- The self-check at the end of this file asserts the outcome rather than the
-- statement, which is what caught the table-level version.
grant update (
  name, plural_noun, description, icon, category_group, is_active,
  display_order, updated_at
) on public.venue_categories to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. SELF-VERIFICATION
-- ════════════════════════════════════════════════════════════════════════════
-- Asserts the facts this migration exists to establish, so a partial apply
-- fails loudly here rather than quietly at 2am in the booking flow.

do $$
declare
  n int;
begin
  -- The 0037 vocabulary survived, active, so every existing hall validates.
  select count(*) into n
  from public.venue_categories
  where slug in ('wedding', 'reception', 'party', 'banquet') and is_active;
  if n <> 4 then
    raise exception '0102: the four original venue types are not all present and active (found %)', n;
  end if;

  select count(*) into n from public.venue_categories;
  if n < 28 then
    raise exception '0102: expected at least 28 seeded categories, found %', n;
  end if;

  -- The hard-coded CHECKs are gone on all three tables...
  if exists (
    select 1 from pg_constraint
    where conname in ('halls_venue_types_allowed', 'admin_hall_drafts_venue_types_allowed')
  ) then
    raise exception '0102: a four-value venue_types CHECK is still in place';
  end if;

  -- ...and a trigger took over on each of the four.
  for n in
    select 1 from (values
      ('trg_halls_venue_types',       'halls'),
      ('trg_hall_drafts_venue_types', 'admin_hall_drafts'),
      ('trg_leads_event_type',        'leads'),
      ('trg_bookings_event_type',     'bookings')
    ) t(trg, tbl)
    where not exists (
      select 1 from pg_trigger g
      join pg_class rel on rel.oid = g.tgrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      where ns.nspname = 'public' and rel.relname = t.tbl
        and g.tgname = t.trg and not g.tgisinternal
    )
  loop
    raise exception '0102: a venue-category validation trigger is missing';
  end loop;

  -- Every validator runs as its owner (the 0096/0099 lesson) and is off the
  -- API surface (0092).
  select count(*) into n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in (
      'assert_venue_categories', 'validate_hall_venue_types',
      'validate_hall_draft_venue_types', 'validate_lead_event_type',
      'validate_booking_event_type')
    and p.prosecdef
    and p.proconfig @> array['search_path=public, pg_temp'];
  if n <> 5 then
    raise exception '0102: expected 5 SECURITY DEFINER validators with a pinned search_path, found %', n;
  end if;

  if has_function_privilege('authenticated', 'public.assert_venue_categories(text[], text[])', 'execute') then
    raise exception '0102: assert_venue_categories is still callable by authenticated';
  end if;

  -- bookings.event_type exists and stayed out of the client write grant (0046).
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings' and column_name = 'event_type'
  ) then
    raise exception '0102: bookings.event_type was not added';
  end if;
  if has_column_privilege('authenticated', 'public.bookings', 'event_type', 'update') then
    raise exception '0102: bookings.event_type is client-writable — it must stay service-role only';
  end if;

  -- The catalogue cannot be emptied from a session client.
  if has_table_privilege('authenticated', 'public.venue_categories', 'delete') then
    raise exception '0102: venue_categories is deletable by authenticated — deactivate, do not delete';
  end if;
  if has_column_privilege('authenticated', 'public.venue_categories', 'slug', 'update') then
    raise exception '0102: venue_categories.slug is updatable by authenticated';
  end if;

  -- ANON GETS READ AND NOTHING ELSE. Asserted because the schema's default
  -- privileges hand every new table to anon with insert/update/delete included
  -- (see the revoke above), so this is the state a `create table` produces by
  -- itself — not a state anyone has to introduce.
  if has_table_privilege('anon', 'public.venue_categories', 'insert')
     or has_table_privilege('anon', 'public.venue_categories', 'update')
     or has_table_privilege('anon', 'public.venue_categories', 'delete') then
    raise exception '0102: anon can write to venue_categories';
  end if;
  if not has_table_privilege('anon', 'public.venue_categories', 'select') then
    raise exception '0102: anon cannot read venue_categories — the public pages need it';
  end if;
end
$$;
