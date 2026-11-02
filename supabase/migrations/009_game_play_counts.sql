-- Public popularity is an aggregate; browser deduplication records stay private.
create table public.game_play_counts (
  game_id uuid primary key,
  play_count bigint not null default 0 check (play_count >= 0)
);
create table public.game_play_visitors (
  game_id uuid not null,
  visitor_id uuid not null,
  counted_at timestamptz not null,
  primary key (game_id, visitor_id)
);
create index game_play_visitors_expiry on public.game_play_visitors(counted_at);
alter table public.game_play_counts enable row level security;
alter table public.game_play_visitors enable row level security;
revoke all on public.game_play_counts, public.game_play_visitors from public, anon, authenticated;

create function public.record_game_open(p_id uuid, p_visitor_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_counted boolean;
begin
  if p_id is null or p_visitor_id is null then raise exception 'PS_BAD_OPEN'; end if;
  if not exists(select 1 from public.library_catalog where id = p_id)
    and not exists(select 1 from public.projects p join public.revisions r
      on r.id = p.published_revision_id and r.project_id = p.id where p.id = p_id) then
    raise exception 'PS_NOT_FOUND';
  end if;
  delete from public.game_play_visitors where counted_at <= v_now - interval '30 minutes';
  insert into public.game_play_visitors(game_id, visitor_id, counted_at)
    values(p_id, p_visitor_id, v_now) on conflict (game_id, visitor_id) do nothing
    returning true into v_counted;
  if v_counted then
    insert into public.game_play_counts(game_id, play_count) values(p_id, 1)
      on conflict (game_id) do update set play_count = public.game_play_counts.play_count + 1;
  end if;
end $$;
revoke all on function public.record_game_open(uuid, uuid) from public;
grant execute on function public.record_game_open(uuid, uuid) to anon, authenticated;

create or replace function public.published_games(p_offset integer default 0, p_limit integer default 24) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit < 1 or p_limit > 60 then
    raise exception 'PS_BAD_PAGE';
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
      select g.id,g.updated_at,coalesce(c.play_count,0) as play_count,
        jsonb_build_object('id',g.id,'revisionId',g.revision_id,'title',g.title,
          'description',g.description,'theme',g.theme,'creatorName',g.creator_name,
          'updatedAt',g.updated_at,'playCount',coalesce(c.play_count,0)) as metadata
        from all_games g left join public.game_play_counts c on c.game_id = g.id
    ), candidates as (
      select * from listings order by updated_at desc,id offset p_offset limit p_limit + 1
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
