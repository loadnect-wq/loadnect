-- ─────────────────────────────────────────────────────────────────────────────
-- 0007_rls_policies.sql  (authoritative — replaces any earlier version)
--
-- Row Level Security for every table.
--
-- Principles:
--   • RLS is enabled (default-deny) on EVERY table.
--   • The service-role key (used only by lib/supabase/admin.ts) BYPASSES RLS,
--     so payments / commissions / premium_listings / advertisements have
--     NO client write policy — the trusted backend writes them.
--   • Privilege escalation is blocked here AND by triggers in 0006
--     (defense in depth: a hole in one layer can't grant admin).
--   • profiles.role can NEVER be changed by a non-admin (the policy WITH CHECK
--     compares new.role to the current stored role; trigger 0006 also blocks it).
-- ─────────────────────────────────────────────────────────────────────────────

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Helper alias requested by the spec: owns_hall(hall_id)                      ║
-- ║ Functionally identical to is_hall_owner() from 0006.                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.owns_hall(_hall_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_hall_owner(_hall_id);
$$;

-- ── Enable RLS on every table ─────────────────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.hall_owners      enable row level security;
alter table public.halls            enable row level security;
alter table public.hall_images      enable row level security;
alter table public.amenities        enable row level security;
alter table public.hall_amenities   enable row level security;
alter table public.availability     enable row level security;
alter table public.bookings         enable row level security;
alter table public.payments         enable row level security;
alter table public.reviews          enable row level security;
alter table public.saved_halls      enable row level security;
alter table public.premium_listings enable row level security;
alter table public.advertisements   enable row level security;
alter table public.commissions      enable row level security;
alter table public.support_tickets  enable row level security;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ profiles                                                                    ║
-- ║   • User reads own profile                                                  ║
-- ║   • User updates own profile EXCEPT role                                    ║
-- ║   • Role escalation blocked at the policy level AND by trigger 0006         ║
-- ║   • Admin reads / updates all profiles                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check (
    auth.uid() = id
    -- A self-insert may not pick a privileged role.
    and (role in ('customer', 'owner_pending') or public.is_admin())
  );

-- WITH CHECK compares the proposed new row's role against the user's
-- CURRENT stored role. A non-admin may only keep its existing role.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  using (auth.uid() = id or public.is_admin())
  with check (
    public.is_admin()
    or (
      auth.uid() = id
      and role = (select p.role from public.profiles p where p.id = auth.uid())
    )
  );

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete using (public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ hall_owners                                                                 ║
-- ║   • Owner reads/updates only their own owner row                            ║
-- ║   • Admin reads/updates all                                                 ║
-- ║   • Only admin can flip is_verified (also enforced by trigger 0006)         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists hall_owners_select on public.hall_owners;
create policy hall_owners_select on public.hall_owners
  for select using (profile_id = auth.uid() or public.is_admin());

drop policy if exists hall_owners_insert on public.hall_owners;
create policy hall_owners_insert on public.hall_owners
  for insert with check (
    profile_id = auth.uid()
    -- Self-insert may not pre-mark itself verified.
    and is_verified = false
    and verified_at is null
    and verified_by is null
  );

drop policy if exists hall_owners_update on public.hall_owners;
create policy hall_owners_update on public.hall_owners
  for update using (profile_id = auth.uid() or public.is_admin())
             with check (profile_id = auth.uid() or public.is_admin());

drop policy if exists hall_owners_delete on public.hall_owners;
create policy hall_owners_delete on public.hall_owners
  for delete using (public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ halls                                                                       ║
-- ║   • Public reads APPROVED halls only                                        ║
-- ║   • Approved owner inserts only with status='pending_approval'              ║
-- ║   • Owner updates own halls but cannot approve them (trigger 0006 enforces) ║
-- ║   • Admin moves status to approved/rejected/suspended                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists halls_select on public.halls;
create policy halls_select on public.halls
  for select using (
    status = 'approved'
    or public.owns_hall(id)
    or public.is_admin()
  );

drop policy if exists halls_insert on public.halls;
create policy halls_insert on public.halls
  for insert with check (
    public.is_owner_approved()
    and public.owns_owner_row(owner_id)
    -- Owner-created halls must start in pending_approval. Admin may set any.
    and (status = 'pending_approval' or public.is_admin())
  );

drop policy if exists halls_update on public.halls;
create policy halls_update on public.halls
  for update using (public.owns_hall(id) or public.is_admin())
             with check (public.owns_hall(id) or public.is_admin());

drop policy if exists halls_delete on public.halls;
create policy halls_delete on public.halls
  for delete using (public.owns_hall(id) or public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ hall_images — public reads images for approved halls only                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists hall_images_select on public.hall_images;
create policy hall_images_select on public.hall_images
  for select using (
    exists (
      select 1 from public.halls h
      where h.id = hall_images.hall_id
        and (h.status = 'approved' or public.owns_hall(h.id) or public.is_admin())
    )
  );

drop policy if exists hall_images_write on public.hall_images;
create policy hall_images_write on public.hall_images
  for all using (public.owns_hall(hall_id) or public.is_admin())
          with check (public.owns_hall(hall_id) or public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ amenities — public read, admin write                                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists amenities_select on public.amenities;
create policy amenities_select on public.amenities for select using (true);

drop policy if exists amenities_write on public.amenities;
create policy amenities_write on public.amenities
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists hall_amenities_select on public.hall_amenities;
create policy hall_amenities_select on public.hall_amenities for select using (true);

drop policy if exists hall_amenities_write on public.hall_amenities;
create policy hall_amenities_write on public.hall_amenities
  for all using (public.owns_hall(hall_id) or public.is_admin())
          with check (public.owns_hall(hall_id) or public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ availability — public read for APPROVED halls only                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists availability_select on public.availability;
create policy availability_select on public.availability
  for select using (
    exists (
      select 1 from public.halls h
      where h.id = availability.hall_id
        and (h.status = 'approved' or public.owns_hall(h.id) or public.is_admin())
    )
  );

drop policy if exists availability_write on public.availability;
create policy availability_write on public.availability
  for all using (public.owns_hall(hall_id) or public.is_admin())
          with check (public.owns_hall(hall_id) or public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ bookings                                                                    ║
-- ║   • Customer creates own booking (must be on an approved hall, must start   ║
-- ║     in 'pending_payment')                                                   ║
-- ║   • Customer reads own; owner reads bookings for own halls; admin all       ║
-- ║   • UPDATE allowed by customer/owner/admin; the LEGAL STATE TRANSITIONS     ║
-- ║     are enforced by validate_booking_transition() in migration 0009         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select using (
    customer_id = auth.uid()
    or public.owns_hall(hall_id)
    or public.is_admin()
  );

drop policy if exists bookings_insert on public.bookings;
create policy bookings_insert on public.bookings
  for insert with check (
    customer_id = auth.uid()
    and status = 'pending_payment'
    and exists (
      select 1 from public.halls h
      where h.id = bookings.hall_id and h.status = 'approved'
    )
  );

drop policy if exists bookings_update on public.bookings;
create policy bookings_update on public.bookings
  for update using (
    customer_id = auth.uid() or public.owns_hall(hall_id) or public.is_admin()
  ) with check (
    customer_id = auth.uid() or public.owns_hall(hall_id) or public.is_admin()
  );

drop policy if exists bookings_delete on public.bookings;
create policy bookings_delete on public.bookings
  for delete using (public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ payments                                                                    ║
-- ║   • Customer reads own                                                      ║
-- ║   • Owner reads payments for bookings on their own halls                    ║
-- ║   • Writes: NONE (service-role only — bypasses RLS)                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select using (
    customer_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id and public.owns_hall(b.hall_id)
    )
  );
-- No insert/update/delete policy → all client writes denied.

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ reviews                                                                     ║
-- ║   • Public reads VISIBLE reviews                                            ║
-- ║   • Customer reviews are allowed only for a hall they have a 'completed'    ║
-- ║     booking on                                                              ║
-- ║   • Admin moderates (toggle is_visible, delete)                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews
  for select using (is_visible or customer_id = auth.uid() or public.is_admin());

drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert with check (
    customer_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      where b.hall_id = reviews.hall_id   -- qualify, avoid shadowing
        and b.customer_id = auth.uid()
        and b.status = 'completed'
    )
  );

drop policy if exists reviews_update on public.reviews;
create policy reviews_update on public.reviews
  for update using (customer_id = auth.uid() or public.is_admin())
             with check (customer_id = auth.uid() or public.is_admin());

drop policy if exists reviews_delete on public.reviews;
create policy reviews_delete on public.reviews
  for delete using (customer_id = auth.uid() or public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ saved_halls — fully private to the customer                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists saved_halls_select on public.saved_halls;
create policy saved_halls_select on public.saved_halls
  for select using (customer_id = auth.uid());

drop policy if exists saved_halls_insert on public.saved_halls;
create policy saved_halls_insert on public.saved_halls
  for insert with check (customer_id = auth.uid());

drop policy if exists saved_halls_delete on public.saved_halls;
create policy saved_halls_delete on public.saved_halls
  for delete using (customer_id = auth.uid());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ premium_listings — owner reads own, admin manages                           ║
-- ║ Writes are server-only (paid via Cashfree, recorded by trusted backend).    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists premium_select on public.premium_listings;
create policy premium_select on public.premium_listings
  for select using (public.owns_hall(hall_id) or public.is_admin());
-- No client write policies.

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ advertisements — public reads active ads, ADMIN manages                     ║
-- ║ Per spec, owners DO NOT self-create ads. The trusted backend may insert     ║
-- ║ on behalf of an owner after payment (bypasses RLS).                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists ads_select on public.advertisements;
create policy ads_select on public.advertisements
  for select using (
    (status = 'active' and start_date <= current_date and (end_date is null or end_date >= current_date))
    or public.is_admin()
    or (owner_id is not null and public.owns_owner_row(owner_id))
  );

drop policy if exists ads_write on public.advertisements;
create policy ads_write on public.advertisements
  for all using (public.is_admin()) with check (public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ commissions — owner reads commissions for own halls, admin manages          ║
-- ║ Writes are server-only (computed at payment-success time).                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists commissions_select on public.commissions;
create policy commissions_select on public.commissions
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = commissions.booking_id and public.owns_hall(b.hall_id)
    )
  );

drop policy if exists commissions_admin_write on public.commissions;
create policy commissions_admin_write on public.commissions
  for all using (public.is_admin()) with check (public.is_admin());

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ support_tickets                                                             ║
-- ║   • User creates / reads own tickets                                        ║
-- ║   • Admin reads / updates / deletes all                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists tickets_select on public.support_tickets;
create policy tickets_select on public.support_tickets
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists tickets_insert on public.support_tickets;
create policy tickets_insert on public.support_tickets
  for insert with check (user_id = auth.uid());

drop policy if exists tickets_update on public.support_tickets;
create policy tickets_update on public.support_tickets
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists tickets_delete on public.support_tickets;
create policy tickets_delete on public.support_tickets
  for delete using (public.is_admin());
