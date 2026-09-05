-- ─────────────────────────────────────────────────────────────────────────────
-- 0050_tax_invoices.sql — the document that has to exist now that tax is charged.
--
-- HALLNECT LLP is GST-registered and, since 0049, collects tax on its platform
-- fee. CGST s.31 read with Rule 46 requires a TAX INVOICE for a taxable supply,
-- carrying the supplier's GSTIN, a consecutive serial number unique to the
-- financial year, the date, the recipient's particulars, the SAC, the taxable
-- value, and the rate and amount of tax. Charging the tax without issuing the
-- document is a worse position than not charging it: the liability is certain
-- and the paperwork proving it is absent.
--
-- ── WHY A COUNTER TABLE AND NOT A SEQUENCE ───────────────────────────────────
--
-- Rule 46(b) wants the series CONSECUTIVE. A Postgres sequence is explicitly not
-- consecutive: nextval() is non-transactional, so every rolled-back transaction
-- burns a number and leaves a hole an officer can ask about. A counter row
-- updated inside the same transaction as the insert keeps the series gap-free,
-- because a rollback takes the increment with it.
--
-- The cost is that concurrent issuance serialises on one row per financial year.
-- That is the correct trade here — invoices are issued at payment-success rate,
-- not at page-view rate, and a contended row lock is cheaper than explaining a
-- missing invoice number.
--
-- ── WHY EVERY PARTY FIELD IS SNAPSHOTTED ─────────────────────────────────────
--
-- supplier_name / supplier_gstin / supplier_address are copied ONTO the invoice
-- rather than read from lib/constants at render time. An invoice is a statutory
-- record of a moment: if the LLP later moves its registered office, every
-- historic invoice must still show the address it was issued from. Reading live
-- constants would silently rewrite documents that have already been filed.
-- Same reasoning as bookings.gst_rate in 0049.

create table if not exists public.invoice_counters (
  fiscal_year text primary key,
  last_serial integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.invoice_counters is
  'One row per Indian financial year (April-March). Incremented in the same transaction as the invoice insert, so the series stays gap-free under rollback.';

create table if not exists public.tax_invoices (
  id                uuid primary key default gen_random_uuid(),

  -- Rule 46(b): consecutive, unique for the financial year, <= 16 characters.
  -- Format HN/2026-27/00001 is exactly 16 and allows 99,999 invoices a year.
  invoice_number    text not null unique,
  fiscal_year       text not null,
  serial            integer not null,
  issued_at         timestamptz not null default now(),

  -- What was supplied. A platform-fee invoice points at a booking; a
  -- subscription invoice points at a plan purchase. Exactly one is set.
  booking_id        uuid references public.bookings(id) on delete set null,
  plan_purchase_id  uuid,
  payment_id        uuid references public.payments(id) on delete set null,
  kind              text not null check (kind in ('platform_fee', 'subscription')),

  -- Supplier, snapshotted (see header).
  supplier_name     text not null,
  supplier_gstin    text not null,
  supplier_address  text not null,

  -- Recipient. GSTIN is nullable because a consumer booking a wedding hall is
  -- almost never registered; when they are, they need it on the document to
  -- claim input credit.
  recipient_name    text not null,
  recipient_email   text,
  recipient_phone   text,
  recipient_gstin   text,

  -- Rule 46(g)-(l).
  sac_code          text not null,
  description       text not null,
  place_of_supply   text not null,
  taxable_value     numeric(12,2) not null check (taxable_value >= 0),
  cgst_rate         numeric(5,2)  not null default 0,
  cgst_amount       numeric(12,2) not null default 0,
  sgst_rate         numeric(5,2)  not null default 0,
  sgst_amount       numeric(12,2) not null default 0,
  igst_rate         numeric(5,2)  not null default 0,
  igst_amount       numeric(12,2) not null default 0,
  total_amount      numeric(12,2) not null check (total_amount >= 0),

  created_at        timestamptz not null default now(),

  -- An invoice is either intra-state (CGST+SGST) or inter-state (IGST). Never
  -- both, never neither-when-tax-is-due. This is the single most common way a
  -- hand-rolled GST implementation goes wrong.
  constraint tax_invoices_one_tax_regime check (
    (igst_amount = 0 and igst_rate = 0)
    or (cgst_amount = 0 and cgst_rate = 0 and sgst_amount = 0 and sgst_rate = 0)
  ),
  -- The arithmetic has to close. A document that does not add up is worse than
  -- no document.
  constraint tax_invoices_totals_reconcile check (
    total_amount = taxable_value + cgst_amount + sgst_amount + igst_amount
  ),
  constraint tax_invoices_one_subject check (
    (booking_id is not null and plan_purchase_id is null)
    or (booking_id is null and plan_purchase_id is not null)
  )
);

create unique index if not exists uq_tax_invoices_fy_serial
  on public.tax_invoices (fiscal_year, serial);

-- One invoice per payment. A repeated webhook must not mint a second document
-- for the same supply — the partial index allows many NULLs (subscription rows)
-- while pinning uniqueness where a payment is named.
create unique index if not exists uq_tax_invoices_payment
  on public.tax_invoices (payment_id) where payment_id is not null;

create index if not exists idx_tax_invoices_booking on public.tax_invoices (booking_id);

-- ── Number allocation ────────────────────────────────────────────────────────
--
-- SECURITY DEFINER so it can write invoice_counters, which no client role may
-- touch. Returns the next serial for the financial year, creating the year's
-- row on first use. Runs inside the caller's transaction, so a rollback undoes
-- the increment and the series stays consecutive.

create or replace function public.next_invoice_serial(_fiscal_year text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_serial integer;
begin
  if not public.is_trusted_backend() then
    raise exception 'next_invoice_serial: invoice numbers are allocated by the backend only';
  end if;

  insert into public.invoice_counters (fiscal_year, last_serial, updated_at)
  values (_fiscal_year, 1, now())
  on conflict (fiscal_year) do update
    set last_serial = public.invoice_counters.last_serial + 1,
        updated_at  = now()
  returning last_serial into v_serial;

  return v_serial;
end;
$function$;

revoke all on function public.next_invoice_serial(text) from public, anon, authenticated;

-- ── Access ───────────────────────────────────────────────────────────────────
--
-- Invoices are written by the service role only. A customer may READ their own;
-- an admin may read all. Nobody may write, edit or delete one from a client:
-- an invoice is a statutory record and an editable one is worthless as evidence.

alter table public.tax_invoices    enable row level security;
alter table public.invoice_counters enable row level security;

drop policy if exists tax_invoices_select on public.tax_invoices;
create policy tax_invoices_select on public.tax_invoices
  for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = tax_invoices.booking_id and b.customer_id = auth.uid()
    )
  );

-- invoice_counters carries no policy at all, so RLS denies every client role by
-- default. Only the service role, which bypasses RLS, can see or move it.

revoke all on public.invoice_counters from anon, authenticated;
revoke insert, update, delete, truncate on public.tax_invoices from anon, authenticated;
grant select on public.tax_invoices to authenticated;
