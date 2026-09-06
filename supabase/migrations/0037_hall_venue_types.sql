-- RECOVERED 2026-09-06 from supabase_migrations.schema_migrations, version
-- 20260827104110 "hall_venue_types". Applied to production but never
-- committed, so supabase/migrations/ could not rebuild the schema. Exported
-- verbatim; not re-run.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 0037: venue types — the data behind the category tiles.
--
-- The homepage advertised "Wedding Halls", "Reception Halls", "Party Halls"
-- and "Banquet Halls", and /halls offered the same chips. None of them
-- filtered anything: halls had no type column, so every tile linked to
-- ?category=<x> and the query ignored it, returning the unfiltered list. Four
-- controls that looked like filters and were decoration.
--
-- A hall may serve several of these at once (most wedding halls also do
-- receptions), so this is an ARRAY rather than a single enum column. Empty
-- means the owner has not said yet — those halls are absent from typed views
-- rather than being assumed into all of them, because guessing a venue's type
-- on the owner's behalf is exactly the kind of invented data this codebase
-- keeps out of listings.
--
-- The CHECK pins the vocabulary so a typo cannot create a category nothing
-- links to; the GIN index keeps the overlap filter cheap as inventory grows.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.halls
  add column if not exists venue_types text[] not null default '{}';

alter table public.halls
  drop constraint if exists halls_venue_types_allowed;

alter table public.halls
  add constraint halls_venue_types_allowed
  check (
    venue_types <@ ARRAY['wedding','reception','party','banquet']::text[]
  );

create index if not exists idx_halls_venue_types
  on public.halls using gin (venue_types);

comment on column public.halls.venue_types is
  'Event types this venue serves: wedding | reception | party | banquet. Empty = not specified by the owner; such halls do not appear in typed category views.';
