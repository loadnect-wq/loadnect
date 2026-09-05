-- ─────────────────────────────────────────────────────────────────────────────
-- 0054_hall_seller_public.sql — publish the seller's identity, and only that.
--
-- Rule 5(3)(a) of the Consumer Protection (E-Commerce) Rules 2020 requires a
-- marketplace to display the seller's business name and geographic address. The
-- venue page showed the hall's street address and nothing about the party the
-- customer is actually contracting with.
--
-- WHY A FUNCTION RATHER THAN A POLICY.
--
-- hall_owners_select (0007) is `profile_id = auth.uid() or is_admin()`, so an
-- anonymous visitor reads no rows and a PostgREST embed returns null WITHOUT
-- erroring — the block would render for admins in testing and for nobody in
-- production.
--
-- And widening that policy would be a leak, not a fix. RLS is row-level, and
-- hall_owners has no column-level SELECT grants, so a public select policy
-- hands every visitor gst_number, pan_number, payout_upi, payout_account_number
-- and payout_ifsc off the same row.
--
-- A SECURITY DEFINER function makes the PROJECTION the allow-list. There is no
-- column list on the application side that a later edit could widen by
-- accident, and no policy that a later migration could loosen.
--
-- THE status GATE IS LOAD-BEARING. Seller identity is published only for a
-- listing that is itself public. Without it this is an enumeration endpoint for
-- owner names and addresses via draft, rejected or suspended halls.
--
-- This replaced a service-role read in lib/halls.ts. That worked, but it made a
-- statutory disclosure depend on SUPABASE_SERVICE_ROLE_KEY being present, and
-- its absence degraded silently to "no seller block" — the obligation unmet on
-- every venue page with only an info-level log to say so.

create or replace function public.hall_seller_public(_hall_id uuid)
returns table (business_name text, address text, city text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select ho.business_name, ho.address, ho.city
  from public.halls h
  join public.hall_owners ho on ho.id = h.owner_id
  where h.id = _hall_id
    and h.status = 'approved';
$function$;

comment on function public.hall_seller_public(uuid) is
  'Published seller identity for an APPROVED hall — business name, address, city. Rule 5(3)(a). Never widen this projection: the rest of hall_owners is onboarding data (PAN, GSTIN, payout bank details).';

revoke all on function public.hall_seller_public(uuid) from public;
grant execute on function public.hall_seller_public(uuid) to anon, authenticated;
