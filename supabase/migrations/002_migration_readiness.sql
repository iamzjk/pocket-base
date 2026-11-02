-- Expose only migration version identifiers so deployment builds can check readiness
-- without database administration credentials. No application records are returned.
create function public.studio_migration_versions() returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    return array[]::text[];
  end if;
  return (
    select coalesce(array_agg(version::text order by version), array[]::text[])
    from supabase_migrations.schema_migrations
  );
end $$;
revoke all on function public.studio_migration_versions() from public;
grant execute on function public.studio_migration_versions() to anon, authenticated;
