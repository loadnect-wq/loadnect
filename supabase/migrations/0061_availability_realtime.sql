-- 0061 — realtime carries the PUBLIC inventory projection and nothing else.
--
-- `availability` is (hall_id, date, slot, status) plus two opaque uuids. No
-- customer name, no phone, no amount, no identifying note — the private half of
-- an offline booking lives in offline_bookings, which is NOT published and is
-- readable only by the venue and an admin.
--
-- Publishing `bookings` would have been the obvious shortcut and a data leak:
-- every subscriber would receive customer_id, contact_phone, the amounts and the
-- notes on every change.
alter publication supabase_realtime add table public.availability;

-- REPLICA IDENTITY FULL so a DELETE carries hall_id in the payload. Without it a
-- delete arrives with only the primary key — and releasing a date is exactly the
-- event a watching customer must not miss, with no way to tell whether the
-- deleted row belonged to the hall on screen.
alter table public.availability replica identity full;
