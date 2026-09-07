-- 0067 — let /admin/settings read the APPLIED schema version instead of asserting it.
--
-- The panel printed a hardcoded "0011 (booking cleanup)" directly above a
-- sentence promising "the dashboard reflects the live database state". It had
-- been wrong for fifty-six migrations. That matters more than it looks: this
-- panel exists precisely because Vercel marks the credentials write-only, so it
-- is the only readout an operator has for things they cannot check anywhere
-- else. One row that is confidently false teaches them to distrust the rest,
-- including the Cashfree mode — the one answer that must never be doubted.
--
-- supabase_migrations is not in PostgREST's exposed schemas and must not be:
-- the table names every structural change ever applied. SECURITY DEFINER with
-- the authorisation performed explicitly, first, is the same shape 0060 uses.
create or replace function public.schema_migration_state()
returns table (latest_version text, latest_name text, applied_count integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Admins only. Not a secret exactly, but a precise inventory of the schema's
  -- history is reconnaissance, and nothing else needs it.
  if not public.is_admin() then
    raise exception 'Not allowed'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select m.version,
           m.name,
           (select count(*)::int from supabase_migrations.schema_migrations)
      from supabase_migrations.schema_migrations m
     order by m.version desc
     limit 1;
end;
$function$;

revoke all on function public.schema_migration_state() from public, anon;
grant execute on function public.schema_migration_state() to authenticated;
