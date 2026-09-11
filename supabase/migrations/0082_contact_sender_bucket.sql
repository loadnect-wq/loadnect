-- ─────────────────────────────────────────────────────────────────────────────
-- 0082_contact_sender_bucket.sql
--
-- TWENTY MESSAGES SILENCED THE CONTACT CHANNEL FOR EVERYONE. submitContactMessage
-- is anon-callable by design, and its only abuse control was a PLATFORM-WIDE
-- count of 20 rows per hour that fails closed. So a script sending twenty valid
-- submissions exhausted the cap, and every genuine visitor for the rest of the
-- hour was told "We are receiving a lot of messages right now". Repeated, that
-- is indefinite.
--
-- On a marketplace this young the contact form is how venue owners arrive. The
-- lost enquiries are the damage; there is no data exposure here at all.
--
-- IT ALSO SUPPRESSED THE ADMIN ALERT. The notification is bucketed one per UTC
-- hour, so filling the bucket first means a real message that hour raises no
-- SMS. An attacker could pick the quiet hour to go unnoticed in.
--
-- THE COMMENT IN THE CODE WAS WRONG, and that is why the cap was shaped this
-- way: it said "per-IP limiting is not available to a server action". A server
-- action can read headers() like any other server code, and behind Vercel
-- x-vercel-forwarded-for is set by the platform. So the per-sender dimension
-- that would have bounded this was available the whole time.
--
-- This migration adds somewhere to put it.
--
-- ── WHY A HASH, NEVER THE ADDRESS ───────────────────────────────────────────
-- An IP address is personal data, and this row is read by the admin support
-- screen. What abuse control actually needs is only "same sender or not", which
-- a keyed hash answers exactly as well. Truncated to 32 hex characters: still
-- far beyond collision range for this purpose, and short enough to index.
--
-- The salt lives in CONTACT_IP_SALT. Without it the hash of a v4 address would
-- be trivially reversible — there are only four billion, and a laptop walks the
-- whole space in seconds — so an unsalted hash would be storing the address
-- while looking like it was not. With no salt configured the application
-- degrades to the global cap alone and says so, rather than pretending.
--
-- NULLABLE on purpose. A submission with no usable client address still gets
-- stored — refusing the message would turn a proxy quirk into a lost customer,
-- which is the same failure this migration exists to stop.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.contact_messages
  add column if not exists sender_bucket text;

comment on column public.contact_messages.sender_bucket is
  'Keyed, truncated hash of the submitting client address (salt: CONTACT_IP_SALT). '
  'Rate limiting only — never the address itself, and never shown to an admin. '
  'Null when no client address was available or no salt is configured.';

-- The rate-limit read is (sender_bucket, created_at >= now() - 1 hour), and it
-- runs on every submission. Partial on non-null, since the null rows are
-- exactly the ones the per-sender cap cannot use.
create index if not exists idx_contact_messages_sender_bucket
  on public.contact_messages (sender_bucket, created_at desc)
  where sender_bucket is not null;

-- ── AND THE GRANT THAT MADE THE FIRST ATTEMPT AT THIS A NO-OP ──────────────
-- The first draft of this migration ended with
--     revoke update (sender_bucket) on public.contact_messages from ...
-- and its own verify block failed it. A COLUMN-LEVEL REVOKE CANNOT NARROW A
-- TABLE-LEVEL GRANT, and anon and authenticated both held table-level UPDATE
-- here, so has_column_privilege stayed true for every column including the new
-- one. Same confusion as the 42501s that hit admins in this project: a
-- column-granted schema and a table-granted one do not answer the same
-- questions.
--
-- RLS was never bypassed — contact_messages_update is is_admin() both ways, so
-- a non-admin's UPDATE matches zero rows. What the wide grant did allow is an
-- ADMIN rewriting name, email, subject or message: silently editing the record
-- of what a visitor actually sent, on the table that is the evidence of it. The
-- app only ever sets is_read (app/admin/actions.ts:1179), so the grant is
-- narrowed to exactly that.
--
-- anon loses both verbs outright. It can never satisfy is_admin() — that needs
-- an auth.uid() with an admin profile — so every grant it held here was
-- unreachable by construction.
revoke update on public.contact_messages from anon, authenticated;
revoke select on public.contact_messages from anon;
grant  update (is_read) on public.contact_messages to authenticated;

-- ── Verify ──────────────────────────────────────────────────────────────────
do $mig$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='contact_messages'
       and column_name='sender_bucket'
  ) then
    raise exception 'sender_bucket was not created';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname='public' and indexname='idx_contact_messages_sender_bucket'
  ) then
    raise exception 'the rate-limit index was not created';
  end if;

  -- Checked per-column, because that is the mistake this migration already
  -- made once: a table-level grant answers true for every column.
  if has_column_privilege('authenticated','public.contact_messages','sender_bucket','UPDATE')
     or has_column_privilege('authenticated','public.contact_messages','message','UPDATE')
     or has_column_privilege('authenticated','public.contact_messages','email','UPDATE')
     or has_column_privilege('anon','public.contact_messages','sender_bucket','UPDATE') then
    raise exception 'a client role can still rewrite a contact message';
  end if;

  -- ...but the one column the admin screen DOES write must survive, or marking
  -- a message read starts failing 42501.
  if not has_column_privilege('authenticated','public.contact_messages','is_read','UPDATE') then
    raise exception 'the revoke was too broad - an admin can no longer mark a message read';
  end if;

  -- And no client may insert a contact message at all, which is the property
  -- the whole design rests on: the cap is only meaningful if PostgREST cannot
  -- be written to directly.
  if has_table_privilege('anon','public.contact_messages','INSERT')
     or has_table_privilege('authenticated','public.contact_messages','INSERT') then
    raise exception 'contact_messages became client-insertable - the cap is now bypassable';
  end if;

  raise notice 'sender_bucket added, indexed and locked to the service role';
end
$mig$;
