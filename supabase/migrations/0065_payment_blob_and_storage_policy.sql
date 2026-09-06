-- 0065 — the venue owner stops receiving the raw gateway blob, and the storage
--        read policy starts reading the object path it always claimed to.

-- ── 1. THE VENUE OWNER DOES NOT NEED THE RAW GATEWAY BLOB ────────────────────
--
-- payments_select admits the venue owner for every payment on their hall:
--   (customer_id = auth.uid()) OR is_admin()
--   OR EXISTS (select 1 from bookings b
--               where b.id = payments.booking_id and owns_hall(b.hall_id))
--
-- and `authenticated` held TABLE-level SELECT, so an owner could read
-- raw_response — the whole Cashfree order object, which carries the CUSTOMER'S
-- EMAIL — and payment_session_id, a live checkout token.
--
-- Nothing in the application reads either column through a user session:
-- raw_response is only ever WRITTEN, and the two payment_session_id reads
-- (lib/payments.ts, lib/plan-payments.ts) both use getSupabaseAdminClient(),
-- i.e. the service role, which bypasses grants entirely. Checked by grep before
-- revoking, not assumed.
--
-- Postgres will not let a column-level revoke override a table-level grant, so
-- the table grant is dropped and the columns a customer and an owner
-- legitimately need are granted back by name. A column added to this table in
-- future is therefore unreadable by clients until someone lists it here — which
-- is the right default for a payments table.
revoke select on public.payments from anon, authenticated;

grant select (
  id, booking_id, customer_id, amount, currency, status,
  payment_method, payment_message, created_at, updated_at,
  advance_amount, platform_fee_amount, platform_fee_gst,
  refund_amount, refund_state, refund_initiated_at, refund_completed_at,
  refund_owed_at, refund_error,
  split_status, split_owner_amount, split_at
) on public.payments to authenticated;

-- Deliberately NOT granted: raw_response (customer email + full gateway
-- payload), payment_session_id, cashfree_payment_id / cashfree_order_id /
-- cashfree_refund_id (handles identifying a live checkout), split_vendor_id,
-- split_error, refund_initiated_by (names an internal actor).
--
-- anon gets nothing: payments_select already refuses it, and a grant it can
-- never exercise is only a thing to misread later.

-- ── 2. THE STORAGE READ POLICY READ THE WRONG `name` ──────────────────────────
--
-- hall_images_storage_select's public branch was
--
--   exists (select 1 from halls h
--            where h.id = ((storage.foldername(h.name))[1])::uuid
--              and h.status = 'approved')
--
-- `h.name` is the HALL'S DISPLAY NAME, not the storage object's path. Two
-- effects: the branch could never be true ("Hallnect mahal" has no "/", so
-- foldername() returns an empty array and [1] is NULL), and it was a latent
-- ERROR — a hall named with a "/" makes the uuid cast raise
-- invalid_text_representation and fails the whole storage query.
--
-- THE SHADOWING IS THE WHOLE BUG. Inside `select 1 from halls h`, an
-- unqualified `name` binds to halls.name, because the subquery's own FROM
-- shadows the outer storage.objects row. Writing the fix the obvious way
-- reproduces the defect exactly — it did here, on the first attempt, and was
-- caught only by reading the applied policy back rather than trusting it. The
-- outer row is therefore named explicitly as `objects`.
--
-- HONEST NOTE ON SCOPE. The `hall-images` bucket is public
-- (storage.buckets.public = true), and that flag — not this policy — governs
-- anonymous reads through the CDN URL. This makes the policy mean what it says;
-- it does NOT stop an unapproved hall's photos being fetchable by anyone
-- holding the object URL. Closing that means a private bucket and signed URLs
-- everywhere, which is a product decision and a far larger change, so it is
-- left open and recorded rather than half-done here.
--
-- VERIFIED after applying, in one rolled-back transaction, as the anon role:
--   hall approved          -> 2 objects visible   (the venue page works)
--   hall pending_approval  -> 0 objects visible   (the RLS path refuses)
drop policy if exists hall_images_storage_select on storage.objects;

create policy hall_images_storage_select on storage.objects
  for select
  using (
    bucket_id = 'hall-images'
    and (
      exists (
        select 1 from public.halls h
         where h.id = ((storage.foldername(objects.name))[1])::uuid
           and h.status = 'approved'
      )
      or public.owns_hall(((storage.foldername(objects.name))[1])::uuid)
      or public.is_admin()
    )
  );
