-- Search only public listing metadata, before pagination. Keep two-argument callers working.
drop function public.published_games(integer, integer);
create function public.published_games(p_offset integer default 0, p_limit integer default 24, p_query text default '') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_query text := lower(btrim(coalesce(p_query, '')));
begin
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit < 1 or p_limit > 60 then
    raise exception 'PS_BAD_PAGE';
  end if;
  if char_length(v_query) > 200 or v_query ~ '[[:cntrl:]]' then
    raise exception 'PS_BAD_SEARCH';
  end if;
  return (
    with all_games as (
      select c.id,c.revision_id,c.title,c.description,c.theme,c.creator_name,c.updated_at from public.library_catalog c
      union all
      select p.id,r.id,r.title,r.description,r.theme,c.display_name,p.published_at
        from public.projects p
        join public.revisions r on r.id = p.published_revision_id and r.project_id = p.id
        join public.creator_profiles c on c.user_id = p.owner_id
        where not exists(select 1 from public.library_catalog catalog where catalog.id = p.id)
    ), listings as (
      select g.id,g.updated_at,g.title,g.description,g.creator_name,coalesce(c.play_count,0) as play_count,
        jsonb_build_object('id',g.id,'revisionId',g.revision_id,'title',g.title,
          'description',g.description,'theme',g.theme,'creatorName',g.creator_name,
          'updatedAt',g.updated_at,'playCount',coalesce(c.play_count,0)) as metadata
        from all_games g left join public.game_play_counts c on c.game_id = g.id
    ), candidates as (
      select * from listings where v_query = '' or strpos(lower(title),v_query) > 0
        or strpos(lower(description),v_query) > 0 or strpos(lower(creator_name),v_query) > 0
        order by updated_at desc,id offset p_offset limit p_limit + 1
    ), page as (
      select * from candidates order by updated_at desc,id limit p_limit
    ), leaders as (
      select * from listings where play_count > 0 order by play_count desc,updated_at desc,id limit 10
    )
    select jsonb_build_object(
      'games',coalesce((select jsonb_agg(metadata order by updated_at desc,id) from page),'[]'::jsonb),
      'hasMore',(select count(*) > p_limit from candidates),
      'leaderboard',coalesce((select jsonb_agg(metadata order by play_count desc,updated_at desc,id) from leaders),'[]'::jsonb)
    )
  );
end $$;
revoke all on function public.published_games(integer, integer, text) from public;
grant execute on function public.published_games(integer, integer, text) to anon, authenticated;
