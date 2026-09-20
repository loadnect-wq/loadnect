-- ─────────────────────────────────────────────────────────────────────────────
-- 0103_curate_ten_occasions.sql — the catalogue is cut to the ten occasions
-- Hallnect actually wants to sell, in a chosen order.
--
-- 0102 seeded twenty-eight to establish the vocabulary. Twenty-eight tiles is a
-- directory, not a choice: the grid became something to read rather than
-- something to pick from, and several of the rows ("Interview", "Training
-- Programme", "Networking Event") describe bookings this marketplace is not
-- trying to win. Ten is the product decision.
--
-- ════════════════════════════════════════════════════════════════════════════
-- DEACTIVATED, NOT DELETED — AND NOTHING IS LOST
-- ════════════════════════════════════════════════════════════════════════════
-- The eighteen that go are set is_active = false. That is the whole mechanism
-- 0102 built for this, and it means:
--
--   * any hall that already declared one KEEPS it, and its owner can still
--     save their form (assert_venue_categories only requires newly ADDED slugs
--     to be active — see 0102's asymmetric rule);
--   * no row is deleted, so nothing that references a slug is orphaned;
--   * bringing one back is one click in /admin/venue-categories, with its
--     wording, icon and ordering intact. This is reversible by design.
--
-- CHECKED BEFORE WRITING THIS: no production hall declares any of the
-- eighteen. The only listing holds {wedding, reception}, both of which stay.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT `banquet` LOSING ITS PLACE MEANS
-- ════════════════════════════════════════════════════════════════════════════
-- banquet is one of the four slugs the platform launched with (0037), so it is
-- worth being explicit: it is being RETIRED FROM THE PICKER, not removed. No
-- hall declares it, /venues/banquet was never indexable (it had no inventory),
-- and the slug survives in the catalogue. 0102's verify block asserted the
-- original four were present and active AT APPLY TIME, which they were; that
-- migration does not re-run, and nothing at runtime requires them to stay
-- offered.
--
-- ════════════════════════════════════════════════════════════════════════════
-- TWO RENAMES, NO SLUG CHANGES
-- ════════════════════════════════════════════════════════════════════════════
-- "Birthday Party" becomes "Birthday" and "Other Event" becomes "Event". Only
-- the display name moves. The slugs stay `birthday-party` and `other-event`,
-- because a slug is what every hall, lead and booking stores and what sits in
-- /venues/<slug>; renaming one orphans halls and 404s a URL. 0102 revokes the
-- column grant for exactly this reason, so this migration could not change them
-- from the API even if it wanted to.
--
-- The visible consequence is that /venues/birthday-party is titled "Birthday
-- Halls". That is the correct trade: a tidy URL is worth less than a stable one.
--
-- ROLLBACK (restores the full 0102 catalogue, names and all):
--   update public.venue_categories set is_active = true;
--   update public.venue_categories set name = 'Birthday Party',
--     plural_noun = 'birthday parties' where slug = 'birthday-party';
--   update public.venue_categories set name = 'Other Event',
--     plural_noun = 'events' where slug = 'other-event';
--   -- display_order and icon are cosmetic; re-run 0102's seed values if wanted.
-- ─────────────────────────────────────────────────────────────────────────────

-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE TEN, IN ORDER
-- ════════════════════════════════════════════════════════════════════════════
-- display_order in tens so a later hand-edit has somewhere to land without
-- renumbering its neighbours — the same convention reorderVenueCategories uses.
--
-- The icons are lucide export names resolved through a fixed map in
-- components/venues/CategoryIcon.tsx. Any name not in that map renders the
-- fallback, so Martini, Flower2 and Tent are added there in the same change.

update public.venue_categories as c set
  name          = v.name,
  plural_noun   = v.plural_noun,
  icon          = v.icon,
  display_order = v.display_order,
  is_active     = true
from (values
  ('wedding',        'Wedding',     'weddings',        'Heart',       10),
  ('birthday-party', 'Birthday',    'birthdays',       'Cake',        20),
  ('party',          'Party',       'parties',         'PartyPopper', 30),
  ('reception',      'Reception',   'receptions',      'Martini',     40),
  ('meeting',        'Meeting',     'meetings',        'Briefcase',   50),
  ('conference',     'Conference',  'conferences',     'Building2',   60),
  ('engagement',     'Engagement',  'engagements',     'Flower2',     70),
  ('baby-shower',    'Baby Shower', 'baby showers',    'Baby',        80),
  ('other-event',    'Event',       'events',          'Tent',        90),
  ('photoshoot',     'Photoshoot',  'photoshoots',     'Camera',     100)
) as v(slug, name, plural_noun, icon, display_order)
where c.slug = v.slug;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. EVERYTHING ELSE STOPS BEING OFFERED
-- ════════════════════════════════════════════════════════════════════════════
-- Named by exclusion rather than by listing the eighteen, so that a category an
-- admin added between 0102 and this migration is also retired rather than
-- surviving as a nineteenth nobody chose.

update public.venue_categories set is_active = false
where slug not in (
  'wedding', 'birthday-party', 'party', 'reception', 'meeting',
  'conference', 'engagement', 'baby-shower', 'other-event', 'photoshoot'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. SELF-VERIFICATION
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  n          int;
  offered    text[];
  expected   text[] := array[
    'wedding', 'birthday-party', 'party', 'reception', 'meeting',
    'conference', 'engagement', 'baby-shower', 'other-event', 'photoshoot'
  ];
begin
  select array_agg(slug order by display_order) into offered
  from public.venue_categories where is_active;

  if offered is distinct from expected then
    raise exception '0103: the offered list is %, expected %', offered, expected;
  end if;

  select count(*) into n from public.venue_categories where not is_active;
  if n <> 18 then
    raise exception '0103: expected 18 retired categories, found %', n;
  end if;

  -- NOTHING WAS DELETED. The whole catalogue is still there; eighteen of it is
  -- simply no longer on offer.
  select count(*) into n from public.venue_categories;
  if n <> 28 then
    raise exception '0103: the catalogue should still hold all 28 rows, found %', n;
  end if;

  -- NO HALL WAS ORPHANED. A listing may legitimately keep a retired category,
  -- but a hall whose EVERY category was retired would have silently vanished
  -- from every typed view — worth knowing about rather than discovering later.
  select count(*) into n
  from public.halls h
  where h.status = 'approved'
    and array_length(h.venue_types, 1) is not null
    and not exists (
      select 1 from unnest(h.venue_types) s
      join public.venue_categories c on c.slug = s
      where c.is_active
    );
  if n > 0 then
    raise exception '0103: % approved hall(s) now declare only retired categories', n;
  end if;

  -- The slugs are untouched, which is what keeps existing halls and URLs valid.
  if not exists (select 1 from public.venue_categories where slug = 'birthday-party' and name = 'Birthday') then
    raise exception '0103: birthday-party was not renamed (or its slug moved)';
  end if;
  if not exists (select 1 from public.venue_categories where slug = 'other-event' and name = 'Event') then
    raise exception '0103: other-event was not renamed (or its slug moved)';
  end if;
end
$$;
