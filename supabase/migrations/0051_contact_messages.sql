-- ─────────────────────────────────────────────────────────────────────────────
-- 0051_contact_messages.sql — the table behind /contact, which has existed in
-- production since before it had a migration.
--
-- WHY THIS FILE EXISTS AT ALL. `contact_messages` was created by hand against
-- the live database and never written down. Production is correct; the REPO is
-- not, and the repo is what a rebuilt environment is made from. On any database
-- built from these migrations — a staging project, a Supabase branch, a restore
-- into a fresh project, a local `supabase db reset` — the table is simply
-- absent, so app/contact/actions.ts fails its rate-limit count, returns "We are
-- receiving a lot of messages right now", and DROPS the enquiry. Silently, and
-- the same way every time. That is the whole bug: not a security hole, a
-- reproducibility hole that eats customer messages.
--
-- Written to be a NO-OP against production, which already has all of this:
-- `create table if not exists` plus `drop policy if exists` / `create policy`,
-- so applying it changes nothing where the objects exist and creates exactly
-- the live shape where they do not. Shape and policies below were read back off
-- the production database, not reconstructed from the application code.
--
-- ── THE ACCESS MODEL, AND WHY THE MISSING POLICY IS THE POINT ────────────────
--
-- RLS is on with exactly TWO policies, both `is_admin()`: SELECT so the admin
-- inbox at /admin/support-tickets can read, UPDATE so it can mark a message
-- read. There is deliberately NO INSERT policy and NO DELETE policy.
--
-- No INSERT policy is not an oversight — it is the control. The contact form is
-- open to anonymous visitors, so a permissive INSERT policy would be an
-- unauthenticated write endpoint into a table an admin reads every day. Instead
-- app/contact/actions.ts writes with the SERVICE ROLE, which bypasses RLS, and
-- does the gatekeeping in code that a policy cannot express: a honeypot field, a
-- Zod-validated body, and a global fail-closed cap of N messages per hour.
-- Adding an INSERT policy here would quietly delete all three of those.
--
-- No DELETE policy means nobody, admin included, can destroy an enquiry through
-- a client. Complaints and grievances arrive through this form (see
-- /grievance-redressal), so the record needs to outlive whoever it embarrasses.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.contact_messages (
  id         uuid primary key default gen_random_uuid(),

  -- Length bounds live here as well as in the Zod schema. The Zod schema
  -- protects the request; these protect the TABLE, which is also reachable by
  -- the service role from anywhere in the codebase. A 2 MB "message" is a
  -- denial-of-service against the admin inbox, not a long enquiry.
  name       text not null check (char_length(name)    between 1 and 120),
  email      text not null check (char_length(email)   between 3 and 320),
  subject    text not null check (char_length(subject) between 1 and 160),
  message    text not null check (char_length(message) between 1 and 2000),

  -- Set when the sender happened to be signed in. INFORMATIONAL ONLY — the form
  -- works anonymously and most enquiries carry NULL here, so nothing may treat
  -- this as an identity check. ON DELETE SET NULL: a profile going away must not
  -- take the enquiry with it, or deleting an account would erase the complaint
  -- that account filed.
  user_id    uuid references public.profiles(id) on delete set null,

  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.contact_messages is
  'Enquiries from the public /contact form. Written ONLY by the service role (app/contact/actions.ts) — there is no INSERT policy on purpose. Read and marked-read by admins.';
comment on column public.contact_messages.user_id is
  'The signed-in sender, when there was one. Informational; the form is open to anonymous visitors and this is usually NULL.';

-- The rate limit in app/contact/actions.ts counts rows in the last hour before
-- accepting a new one, and the admin inbox lists newest-first. Both are a
-- created_at scan; on a table anyone on the internet can grow, that wants an
-- index from the start rather than after the first flood.
create index if not exists idx_contact_messages_created
  on public.contact_messages (created_at desc);

-- The inbox badge counts unread messages. Partial, because the interesting set
-- is the small one and it shrinks as the admin works through it.
create index if not exists idx_contact_messages_unread
  on public.contact_messages (is_read) where not is_read;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Enabling RLS with no matching policy DENIES the operation for every client
-- role, which is what makes "no INSERT policy" a real control rather than a
-- gap. The service role bypasses RLS entirely and is unaffected.

alter table public.contact_messages enable row level security;

drop policy if exists contact_messages_select on public.contact_messages;
create policy contact_messages_select on public.contact_messages
  for select
  using (public.is_admin());

drop policy if exists contact_messages_update on public.contact_messages;
create policy contact_messages_update on public.contact_messages
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- ── GRANTS ───────────────────────────────────────────────────────────────────
--
-- SELECT and UPDATE must stay granted to `authenticated`. Both admin paths —
-- fetchContactMessages() in lib/admin.ts and markContactMessageRead() in
-- app/admin/actions.ts — run through the SESSION client, so they act as the
-- `authenticated` role. Column and table GRANTs are checked BEFORE RLS and know
-- nothing about is_admin(), so revoking either would fail the admin's own reads
-- and writes with 42501 while the policies above still say yes.
--
-- INSERT and DELETE are revoked. RLS already denies both (no policy), so this
-- changes no behaviour today; it is here so that the denial does not depend on a
-- future policy staying absent. The writer is the service role, which bypasses
-- both layers.
revoke insert, delete, truncate on public.contact_messages from anon, authenticated;
