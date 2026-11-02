-- Public discovery reads only the selected published version, across all owners.
-- Keep direct table access, private project metadata, and draft source protected.
create function public.published_games(p_offset integer default 0, p_limit integer default 24) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit < 1 or p_limit > 60 then
    raise exception 'PS_BAD_PAGE';
  end if;
  return (
    with candidates as (
      select p.id, r.id as revision_id, r.title, r.description, r.theme, r.created_at
      from public.projects p
      join public.revisions r on r.id = p.published_revision_id and r.project_id = p.id
      order by r.created_at desc, p.id
      offset p_offset limit p_limit + 1
    ), page as (
      select * from candidates order by created_at desc, id limit p_limit
    )
    select jsonb_build_object(
      'games', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'revisionId', revision_id, 'title', title,
        'description', description, 'theme', theme
      ) order by created_at desc, id) from page), '[]'::jsonb),
      'hasMore', (select count(*) > p_limit from candidates)
    )
  );
end $$;
revoke all on function public.published_games(integer, integer) from public;
grant execute on function public.published_games(integer, integer) to anon, authenticated;
