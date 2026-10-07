-- ─────────────────────────────────────────────────────────────────────────────
-- 0113  A family can review a hall it booked through a quote
--
-- WHY. A review had to name a COMPLETED ONLINE BOOKING (reviews_insert, 0069).
-- Since 0112 switched direct booking off, every venue works on quotes: the
-- family accepts a quote, the venue marks the enquiry booked ("confirmed"),
-- and no booking row ever exists. So no family could review any hall, and the
-- ratings that drive search ranking could never move again.
--
-- WHAT. A review now names exactly one of:
--   • booking_id — a completed online booking (unchanged), or
--   • lead_id    — an enquiry the venue marked booked, once the function date
--                  has passed (India time).
-- Either way it must be the reviewer's own and for that hall, and each one can
-- be reviewed once. The rules live in the INSERT policy, not only in the app.
--
-- ADDITIVE. One nullable column, one unique index, one check, one helper; the
-- booking path is the same predicate as 0069. No existing review changes.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. The enquiry a review is about.
alter table public.reviews
  add column if not exists lead_id uuid references public.leads (id) on delete set null;

-- 2. One review per booked enquiry (as uq_review_per_booking is per booking).
create unique index if not exists uq_review_per_lead
  on public.reviews (lead_id)
  where lead_id is not null;

-- 3. A review is about a booking OR an enquiry, never both.
alter table public.reviews drop constraint if exists reviews_one_source;
alter table public.reviews add constraint reviews_one_source
  check (booking_id is null or lead_id is null);

-- 4. Is this enquiry one the caller may review?
--
-- SECURITY DEFINER because the INSERT policy has to read the lead, and a
-- customer's direct reads of public.leads are column-granted (0112) — a
-- policy subquery runs with the caller's rights, so the check must not depend
-- on which columns they happen to be granted. It answers for auth.uid() only,
-- returns a boolean and nothing else, and is not callable by anon.
create or replace function public.lead_is_reviewable(p_lead uuid, p_hall uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.leads l
    where l.id          = p_lead
      and l.customer_id = auth.uid()
      and l.hall_id     = p_hall
      and l.status      = 'confirmed'
      and l.event_date <= (now() at time zone 'Asia/Kolkata')::date
  );
$$;

revoke all on function public.lead_is_reviewable(uuid, uuid) from public;
revoke all on function public.lead_is_reviewable(uuid, uuid) from anon;
grant execute on function public.lead_is_reviewable(uuid, uuid) to authenticated;

-- 5. The insert rule: the 0069 booking path, or the new enquiry path.
drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    customer_id = auth.uid()
    and (
      (
        booking_id is not null
        and lead_id is null
        and exists (
          select 1 from public.bookings b
          where b.id          = reviews.booking_id
            and b.customer_id = auth.uid()
            and b.hall_id     = reviews.hall_id
            and b.status      = 'completed'
        )
      )
      or (
        lead_id is not null
        and booking_id is null
        and public.lead_is_reviewable(reviews.lead_id, reviews.hall_id)
      )
    )
  );

-- 6. The column is insertable and readable like booking_id.
grant insert (lead_id), select (lead_id) on public.reviews to authenticated;

-- 7. Attribution stays admin-only on UPDATE, lead_id included.
create or replace function public.guard_review_privileged_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if public.is_trusted_backend() or public.is_admin() then return new; end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_visible, true) is distinct from true then
      raise exception 'reviews: visibility is set by Hallnect';
    end if;
    return new;
  end if;

  if new.is_visible  is distinct from old.is_visible
     or new.hall_id     is distinct from old.hall_id
     or new.customer_id is distinct from old.customer_id
     or new.booking_id  is distinct from old.booking_id
     or new.lead_id     is distinct from old.lead_id then
    raise exception 'reviews: moderation and attribution are admin-only';
  end if;
  return new;
end; $function$;

-- 8. Verify.
do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'uq_review_per_lead') then
    raise exception '0113: uq_review_per_lead missing';
  end if;
  if not exists (
    select 1 from pg_policies
    where tablename = 'reviews' and policyname = 'reviews_insert'
      and with_check like '%lead_is_reviewable%'
  ) then
    raise exception '0113: reviews_insert does not allow the enquiry path';
  end if;
  if has_function_privilege('anon', 'public.lead_is_reviewable(uuid, uuid)', 'execute') then
    raise exception '0113: anon can call lead_is_reviewable';
  end if;
end $$;
