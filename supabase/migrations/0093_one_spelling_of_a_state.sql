-- ─────────────────────────────────────────────────────────────────────────────
-- 0093_one_spelling_of_a_state.sql — the catalogue says "Tamilnadu" while every
-- page says "Tamil Nadu".
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT WAS WRONG
-- ════════════════════════════════════════════════════════════════════════════
-- canonicalState() normalised the spelling on the way OUT — into the address
-- line, into the EventVenue JSON-LD, into the breadcrumb — while the column
-- kept whatever the owner typed. So the rendered page, the structured data and
-- the database disagreed about the same fact, and any query that grouped or
-- filtered on halls.state saw a value no page had ever shown a human.
--
-- halls.city has the same shape of problem and is NOT addressed here: city is a
-- free-text column with no CHECK and no foreign key, and cityFromSlug resolves
-- only against the eighteen names in lib/seo/service-areas.ts, so a case
-- variant there produces an indexable city page with no venues on it. That is
-- recorded in docs/update-plan.md §4.4 and needs a decision about the
-- vocabulary, not a one-line UPDATE.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHY THERE IS NO TRIGGER
-- ════════════════════════════════════════════════════════════════════════════
-- The obvious companion to this is a BEFORE INSERT OR UPDATE trigger that
-- normalises the column at the database. It is deliberately not here.
--
-- The spelling map is a VOCABULARY — eight entries today, and it will grow the
-- first time a venue lists outside Tamil Nadu. Putting a copy of it in plpgsql
-- creates a second source of truth that drifts from lib/seo/state.ts silently,
-- and this repository has already paid for that lesson three times (the amenity
-- list exists in three places, the city list existed in three). Every write path
-- into these columns now calls canonicalStateForStorage() — updateHall,
-- createHall, upsertOwnerRow and createAdminHallDraft, which is the complete
-- set — so the application is the single place the rule lives.
--
-- This migration therefore does exactly one thing: it fixes the rows that were
-- written before that was true.
--
-- NOTHING IS INVENTED. Only spellings already in the map are rewritten, and a
-- NULL state stays NULL — hall_owners has one such row, and writing
-- "Tamil Nadu" into it would be recording a fact nobody supplied.
--
-- ROLLBACK (restores the exact prior value of the one affected row):
--   update public.halls set state = 'Tamilnadu' where state = 'Tamil Nadu';
-- ─────────────────────────────────────────────────────────────────────────────

-- The same eight spellings as lib/seo/state.ts, matched the same way: letters
-- only, lowercased. Written inline rather than as a stored function precisely so
-- it cannot be mistaken for a permanent second home for the vocabulary.
update public.halls
   set state = case lower(regexp_replace(state, '[^a-zA-Z]', '', 'g'))
                 when 'tamilnadu'     then 'Tamil Nadu'
                 when 'tn'            then 'Tamil Nadu'
                 when 'tamilnad'      then 'Tamil Nadu'
                 when 'puducherry'    then 'Puducherry'
                 when 'pondicherry'   then 'Puducherry'
                 when 'kerala'        then 'Kerala'
                 when 'karnataka'     then 'Karnataka'
                 when 'andhrapradesh' then 'Andhra Pradesh'
                 else state
               end
 where state is not null
   and lower(regexp_replace(state, '[^a-zA-Z]', '', 'g')) in
       ('tamilnadu','tn','tamilnad','puducherry','pondicherry','kerala','karnataka','andhrapradesh')
   and state <> case lower(regexp_replace(state, '[^a-zA-Z]', '', 'g'))
                  when 'tamilnadu'     then 'Tamil Nadu'
                  when 'tn'            then 'Tamil Nadu'
                  when 'tamilnad'      then 'Tamil Nadu'
                  when 'puducherry'    then 'Puducherry'
                  when 'pondicherry'   then 'Puducherry'
                  when 'kerala'        then 'Kerala'
                  when 'karnataka'     then 'Karnataka'
                  when 'andhrapradesh' then 'Andhra Pradesh'
                  else state
                end;

update public.hall_owners
   set state = 'Tamil Nadu'
 where state is not null
   and lower(regexp_replace(state, '[^a-zA-Z]', '', 'g')) in ('tamilnadu','tn','tamilnad')
   and state <> 'Tamil Nadu';

update public.admin_hall_drafts
   set state = 'Tamil Nadu'
 where state is not null
   and lower(regexp_replace(state, '[^a-zA-Z]', '', 'g')) in ('tamilnadu','tn','tamilnad')
   and state <> 'Tamil Nadu';

-- ── Self-verification ───────────────────────────────────────────────────────
do $verify$
declare v_bad int;
begin
  -- No row may still carry a spelling the map would have rewritten.
  select count(*) into v_bad
    from public.halls
   where state is not null
     and lower(regexp_replace(state, '[^a-zA-Z]', '', 'g')) in
         ('tamilnadu','tn','tamilnad')
     and state <> 'Tamil Nadu';
  if v_bad > 0 then
    raise exception '0093: % halls row(s) still hold a Tamil Nadu variant', v_bad;
  end if;

  -- A NULL state must have been left alone. hall_owners has one, and inventing
  -- a value for it is the failure this asserts against.
  if (select count(*) from public.hall_owners where state is null) < 1 then
    raise exception '0093: a null state was filled in; nothing here may invent one';
  end if;

  -- And nothing outside the vocabulary may have been touched: every non-null
  -- state left standing must now be one of the canonical forms or a spelling
  -- the map does not know.
  if exists (
    select 1 from public.halls
     where state is not null
       and state <> trim(regexp_replace(state, '\s+', ' ', 'g'))
  ) then
    raise exception '0093: a state value has stray whitespace';
  end if;
end
$verify$;
