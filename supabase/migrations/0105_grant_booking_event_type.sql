-- ─────────────────────────────────────────────────────────────────────────────
-- 0105_grant_booking_event_type.sql
--
-- ONE COLUMN, AND IT IS 0102'S MISTAKE. 0102 added bookings.event_type and
-- never granted SELECT on it, so the column is invisible to every client that
-- is not service_role.
--
-- 0032's header states the rule this broke, in as many words: it dropped the
-- table-wide SELECT on bookings and re-granted an enumerated column list, "so a
-- column added later is NOT readable by clients until granted here". 0102 added
-- a column later and did not come back here.
--
-- ═══ WHAT IT BREAKS ═════════════════════════════════════════════════════════
--
-- fetchAdminEventTypeDemand (lib/admin.ts) runs
--
--   db.from("bookings").select("event_type")
--
-- on the SESSION client, so it executes as `authenticated` and raises 42501
-- rather than returning rows. That function fails soft by design — its docblock
-- says "an unreadable query returns [], the panel disappears" — so the admin
-- occasions panel counts enquiries correctly and reports ZERO BOOKINGS FOREVER,
-- with no error anywhere. It is the exact shape of failure the repo already
-- has a name for.
--
-- Not visible yet only because production holds no bookings. It would have
-- started lying on the first one.
--
-- ═══ WHAT IT DOES NOT BREAK ═════════════════════════════════════════════════
--
-- The WRITE is fine and was never at risk. createBookingRequest stamps
-- event_type through `insertDb`, which is the service-role client, precisely
-- because that write is a post-insert fixup that must not fail the booking.
-- service_role holds SELECT and UPDATE on this column already.
--
-- ═══ BOTH ROLES, LIKE EVERY OTHER BOOKING COLUMN ════════════════════════════
--
-- 0104 removed grants nothing uses, and on that principle `anon` could be left
-- out here: RLS returns an anonymous caller no booking rows at all, so the
-- grant buys it nothing.
--
-- It is granted to both anyway, for a specific reason. A MISSING COLUMN GRANT
-- IS AN ERROR, NOT AN EMPTY RESULT. An admin page whose queries run before the
-- layout's requireRole finishes — a documented shape in this codebase — would
-- execute this select as `anon`, and the difference between "no rows" and
-- "42501" is the difference between a blank panel and a thrown request. Every
-- other SELECT grant on this table (0032, 0045, 0049, 0052) names both roles;
-- one column with a narrower list than its neighbours is a trap for whoever
-- reads this next.
--
-- No schema change. One GRANT.
-- ─────────────────────────────────────────────────────────────────────────────

grant select (event_type) on public.bookings to anon, authenticated;

do $$
begin
  if not has_column_privilege('authenticated', 'public.bookings', 'event_type', 'SELECT') then
    raise exception '0105: authenticated still cannot read bookings.event_type';
  end if;
  if not has_column_privilege('anon', 'public.bookings', 'event_type', 'SELECT') then
    raise exception '0105: anon still cannot read bookings.event_type';
  end if;

  -- The columns 0032 and 0072 deliberately withhold must stay withheld. This
  -- migration adds one product field; it is not an opening.
  if has_column_privilege('authenticated', 'public.bookings', 'commission_amount', 'SELECT') then
    raise exception '0105: bookings.commission_amount became readable';
  end if;
  if has_column_privilege('authenticated', 'public.bookings', 'owner_net_advance', 'SELECT') then
    raise exception '0105: bookings.owner_net_advance became readable';
  end if;
  if has_column_privilege('authenticated', 'public.halls', 'commission_rate', 'SELECT') then
    raise exception '0105: halls.commission_rate became readable';
  end if;

  -- event_type is readable, not writable, from a session client. The write is
  -- service-role and must stay that way.
  if has_column_privilege('authenticated', 'public.bookings', 'event_type', 'UPDATE') then
    raise exception '0105: bookings.event_type became writable by authenticated';
  end if;

  raise notice '0105: bookings.event_type is readable, nothing else moved';
end $$;
