-- ─────────────────────────────────────────────────────────────────────────────
-- 0101_chat_assistant_quota.sql — usage metering for the HallNect Assistant.
--
-- WHAT IT STORES. One row per chat request: when, a pseudonymous caller key
-- (HMAC of the client address, lib/ai/chat-actor.ts — never the address) and
-- the user id when signed in. NO message text, no prompt, no reply, no IP.
-- It exists only so /api/chat can refuse a caller who would run up AI costs.
--
-- WHO CAN TOUCH IT. Nobody through the API: RLS on, no policies, table and
-- function privileges revoked from anon and authenticated. /api/chat calls
-- consume_chat_quota() with the service role.
--
-- ATOMIC. The count and the insert happen in one function under a per-caller
-- advisory lock, so parallel requests from one caller cannot all pass a check
-- that each of them saw as "one under the limit".
--
-- RETENTION. Rows older than 2 days are pruned opportunistically by the same
-- function (nothing needs more than 24 hours of history).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.chat_usage_events (
  id         bigint generated always as identity primary key,
  actor_key  text        not null check (length(actor_key) between 1 and 64),
  user_id    uuid        references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.chat_usage_events is
  'HallNect Assistant request log for rate limiting only: pseudonymous actor key, '
  'optional user id, timestamp. No message content. Service role only (0101).';

create index if not exists idx_chat_usage_actor_time on public.chat_usage_events (actor_key, created_at desc);
create index if not exists idx_chat_usage_user_time  on public.chat_usage_events (user_id, created_at desc) where user_id is not null;
create index if not exists idx_chat_usage_time       on public.chat_usage_events (created_at);

alter table public.chat_usage_events enable row level security;
revoke all on table public.chat_usage_events from public, anon, authenticated;

-- Returns 'ok' (and records the request) or the name of the limit that refused it:
-- 'actor_minute' | 'actor_hour' | 'actor_day' | 'global_day'.
-- A signed-in caller is metered by user id (so switching networks does not
-- reset it); a guest by actor key.
create or replace function public.consume_chat_quota(
  _actor_key    text,
  _user_id      uuid,
  _per_minute   integer,
  _per_hour     integer,
  _per_day      integer,
  _global_day   integer
) returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n_min  integer;
  n_hour integer;
  n_day  integer;
  n_all  integer;
begin
  if _actor_key is null or length(_actor_key) = 0 or length(_actor_key) > 64 then
    raise exception 'consume_chat_quota: invalid actor key';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('chat:' || coalesce(_user_id::text, _actor_key), 0));

  if _user_id is not null then
    select count(*) filter (where created_at > now() - interval '1 minute'),
           count(*) filter (where created_at > now() - interval '1 hour'),
           count(*)
      into n_min, n_hour, n_day
      from public.chat_usage_events
     where user_id = _user_id
       and created_at > now() - interval '1 day';
  else
    select count(*) filter (where created_at > now() - interval '1 minute'),
           count(*) filter (where created_at > now() - interval '1 hour'),
           count(*)
      into n_min, n_hour, n_day
      from public.chat_usage_events
     where actor_key = _actor_key
       and user_id is null
       and created_at > now() - interval '1 day';
  end if;

  if n_min  >= _per_minute then return 'actor_minute'; end if;
  if n_hour >= _per_hour   then return 'actor_hour';   end if;
  if n_day  >= _per_day    then return 'actor_day';    end if;

  select count(*) into n_all
    from public.chat_usage_events
   where created_at > now() - interval '1 day';
  if n_all >= _global_day then return 'global_day'; end if;

  insert into public.chat_usage_events (actor_key, user_id) values (_actor_key, _user_id);

  -- Opportunistic pruning, roughly once per 200 requests.
  if random() < 0.005 then
    delete from public.chat_usage_events where created_at < now() - interval '2 days';
  end if;

  return 'ok';
end;
$$;

revoke all on function public.consume_chat_quota(text, uuid, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_chat_quota(text, uuid, integer, integer, integer, integer) to service_role;

notify pgrst, 'reload schema';

do $verify$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.chat_usage_events'::regclass) then
    raise exception '0101: RLS is not enabled on chat_usage_events';
  end if;
  if has_table_privilege('anon', 'public.chat_usage_events', 'select')
     or has_table_privilege('authenticated', 'public.chat_usage_events', 'select')
     or has_table_privilege('authenticated', 'public.chat_usage_events', 'insert') then
    raise exception '0101: chat_usage_events is reachable by an API role';
  end if;
  if has_function_privilege('anon', 'public.consume_chat_quota(text,uuid,integer,integer,integer,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.consume_chat_quota(text,uuid,integer,integer,integer,integer)', 'execute') then
    raise exception '0101: consume_chat_quota is callable by an API role';
  end if;
  if not has_function_privilege('service_role', 'public.consume_chat_quota(text,uuid,integer,integer,integer,integer)', 'execute') then
    raise exception '0101: service_role cannot call consume_chat_quota';
  end if;
end
$verify$;
