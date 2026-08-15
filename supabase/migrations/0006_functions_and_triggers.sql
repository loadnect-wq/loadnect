-- ─────────────────────────────────────────────────────────────────────────────
-- 0006_functions_and_triggers.sql
-- Security helpers, updated_at automation, auto-profile creation,
-- privilege-escalation guards, rating recompute, double-booking guard.
-- ─────────────────────────────────────────────────────────────────────────────

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ AUTHORIZATION HELPERS                                                       ║
-- ║ All SECURITY DEFINER + STABLE so they bypass RLS when read inside policies  ║
-- ║ (prevents infinite RLS recursion on the profiles table).                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_owner_approved()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner_approved'
  );
$$;

-- True if the current user owns the hall_owners row identified by _owner_id.
create or replace function public.owns_owner_row(_owner_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.hall_owners
    where id = _owner_id and profile_id = auth.uid()
  );
$$;

-- True if the current user is the owner of the given hall.
create or replace function public.is_hall_owner(_hall_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.halls h
    join public.hall_owners ho on ho.id = h.owner_id
    where h.id = _hall_id and ho.profile_id = auth.uid()
  );
$$;

-- True when the current DB role is a trusted backend (service-role / superuser).
-- Used to let the server (admin client) perform privileged writes that the
-- escalation guards below would otherwise block for normal users.
create or replace function public.is_trusted_backend()
returns boolean
language sql stable
as $$
  select current_user in ('service_role', 'supabase_admin', 'postgres');
$$;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ updated_at AUTOMATION                                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','hall_owners','halls','bookings','payments','availability',
    'reviews','premium_listings','advertisements','commissions','support_tickets'
  ]
  loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I;', t);
    execute format(
      'create trigger trg_set_updated_at before update on public.%I
         for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ AUTO-CREATE PROFILE ON SIGNUP                                               ║
-- ║ Maps signup metadata to a SAFE role. A client can request 'owner' (which   ║
-- ║ becomes owner_pending, still requiring admin approval) — but can NEVER      ║
-- ║ self-assign 'admin' or 'owner_approved'.                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  requested text := lower(coalesce(new.raw_user_meta_data ->> 'role', 'customer'));
  safe_role user_role;
begin
  safe_role := case
    when requested = 'owner' then 'owner_pending'::user_role
    else 'customer'::user_role
  end;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'name',
    safe_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ PRIVILEGE-ESCALATION GUARD — profiles.role                                  ║
-- ║ Any role change requires an admin or the trusted backend. This is the       ║
-- ║ primary defense against "user makes themselves admin".                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- IMPORTANT: this is SECURITY INVOKER (the default). It must NOT be SECURITY
-- DEFINER, because is_trusted_backend() reads current_user — under a DEFINER
-- function current_user becomes the owner ('postgres'), which would make every
-- caller look "trusted" and silently disable this guard. is_admin() below is
-- itself SECURITY DEFINER and uses auth.uid(), so it still works correctly here.
create or replace function public.prevent_role_change()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if not (public.is_trusted_backend() or public.is_admin()) then
      raise exception 'Not allowed: only an administrator can change a user role';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_role_change on public.profiles;
create trigger trg_prevent_role_change
  before update on public.profiles
  for each row execute function public.prevent_role_change();

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ADMIN-ONLY GUARD — hall_owners verification fields                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- SECURITY INVOKER (see note on prevent_role_change for why).
create or replace function public.prevent_owner_self_verify()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if (new.is_verified is distinct from old.is_verified
      or new.verified_at is distinct from old.verified_at
      or new.verified_by is distinct from old.verified_by)
     and not (public.is_trusted_backend() or public.is_admin()) then
    raise exception 'Not allowed: only an administrator can verify a hall owner';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_owner_self_verify on public.hall_owners;
create trigger trg_prevent_owner_self_verify
  before update on public.hall_owners
  for each row execute function public.prevent_owner_self_verify();

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ADMIN-ONLY GUARD — hall approval transitions                                ║
-- ║ Owners may move draft <-> pending_approval, but only admins may set         ║
-- ║ approved / rejected / suspended.                                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- SECURITY INVOKER (see note on prevent_role_change for why).
create or replace function public.prevent_hall_self_approve()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('approved', 'rejected', 'suspended')
     and not (public.is_trusted_backend() or public.is_admin()) then
    raise exception 'Not allowed: only an administrator can approve, reject or suspend a hall';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_hall_self_approve on public.halls;
create trigger trg_prevent_hall_self_approve
  before update on public.halls
  for each row execute function public.prevent_hall_self_approve();

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ DOUBLE-BOOKING GUARD (incl. full-day vs half-day overlap)                   ║
-- ║ Complements the partial unique index in 0003.                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.prevent_overlapping_booking()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status in ('payment_success','booking_requested','owner_confirmed','completed') then
    if exists (
      select 1 from public.bookings b
      where b.hall_id    = new.hall_id
        and b.event_date = new.event_date
        and b.id        <> new.id
        and b.status in ('payment_success','booking_requested','owner_confirmed','completed')
        and (new.slot = 'full_day' or b.slot = 'full_day' or b.slot = new.slot)
    ) then
      raise exception 'This hall is already booked on % for the % slot', new.event_date, new.slot;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_overlapping_booking on public.bookings;
create trigger trg_prevent_overlapping_booking
  before insert or update on public.bookings
  for each row execute function public.prevent_overlapping_booking();

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ HALL RATING RECOMPUTE                                                       ║
-- ║ Keeps halls.rating_average / rating_count in sync with visible reviews.    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.recalc_hall_rating()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  target_hall uuid := coalesce(new.hall_id, old.hall_id);
begin
  update public.halls h
  set
    rating_count   = sub.cnt,
    rating_average = sub.avg_rating
  from (
    select
      count(*)::int                                  as cnt,
      coalesce(round(avg(rating)::numeric, 1), 0)    as avg_rating
    from public.reviews
    where hall_id = target_hall and is_visible
  ) sub
  where h.id = target_hall;

  return null;
end;
$$;

drop trigger if exists trg_recalc_hall_rating on public.reviews;
create trigger trg_recalc_hall_rating
  after insert or update or delete on public.reviews
  for each row execute function public.recalc_hall_rating();
