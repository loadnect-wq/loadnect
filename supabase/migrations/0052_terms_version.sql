-- ─────────────────────────────────────────────────────────────────────────────
-- 0052_terms_version.sql — record WHICH policy the customer accepted, not just
-- that they accepted one.
--
-- bookings has carried `terms_accepted` and `terms_accepted_at` since 0017, and
-- together they answer only half the question. /refund-policy and
-- /cancellation-policy both promise, in writing, that "the version applicable to
-- your booking is the one in force at the time the booking was confirmed" — so
-- the version is a term of the contract, and the platform was not keeping it.
--
-- The failure mode is quiet and only shows up when it matters. Edit the refund
-- schedule tomorrow and every booking taken today silently starts pointing at a
-- document the customer never saw. In a chargeback or a consumer-forum
-- complaint, `terms_accepted = true` against an undated policy is not evidence
-- of anything: we cannot produce what they agreed to, and the timestamp only
-- narrows it if someone also kept a dated copy of the page, which nobody did.
--
-- Same reasoning as bookings.gst_rate in 0049 and the snapshotted supplier
-- fields in 0050: a record of a moment must not be re-derivable from today's
-- configuration, or it rewrites itself every time the configuration changes.
--
-- ── WHY NULLABLE, AND WHY NULL IS NOT BACK-FILLED ────────────────────────────
--
-- Every booking taken before this column existed genuinely has no recorded
-- version, and NULL is the honest way to say so. Back-filling them with today's
-- constant would MANUFACTURE evidence — it would assert that a customer in
-- August accepted a document that may since have been edited. A gap that is
-- visibly a gap is worth more than a field that looks complete and is wrong.
--
-- The same NULL is also what a booking gets when this migration has not been
-- applied yet: app/book/[slug]/actions.ts drops the field and inserts without it
-- rather than failing the booking (its fallback ladder logs a line naming this
-- migration). So NULL means "not recorded", from either cause, and nothing
-- downstream may read it as "the current version".

alter table public.bookings
  add column if not exists terms_version text;

comment on column public.bookings.terms_version is
  'The published policy version the customer accepted, from POLICY_VERSION in app/book/[slug]/actions.ts (e.g. "2026-08", tracking the "Last updated" stamp on /terms, /cancellation-policy and /refund-policy). NULL = not recorded; never back-fill it with the current constant.';

-- A version identifier, not free text. Cheap guard against something one day
-- writing a whole policy document, a URL, or an empty string into the column
-- that a dispute will be argued from.
alter table public.bookings
  drop constraint if exists bookings_terms_version_sane;
alter table public.bookings
  add constraint bookings_terms_version_sane check (
    terms_version is null
    or char_length(terms_version) between 1 and 32
  );

-- ── GRANTS ───────────────────────────────────────────────────────────────────
--
-- READABLE by clients. 0032 replaced the table-wide SELECT grant on bookings
-- with a column-scoped one, so a new column is invisible to `anon` and
-- `authenticated` until it is named — and the one person with the strongest
-- claim to know which policy binds their booking is the customer who accepted
-- it. Without this grant the booking detail page could never show it.
--
-- NOT WRITABLE by clients. 0046 re-granted UPDATE on bookings for a named list
-- of columns only, and this is not on it; a new column inherits no grant, so
-- there is nothing to revoke. That is deliberate rather than incidental: a
-- consent record the consenting party can edit after the fact proves nothing.
grant select (terms_version) on public.bookings to anon, authenticated;
