-- Explicit public names, publication dates, and a read-only Pocket Base catalog.
create table public.creator_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (
    length(display_name) between 1 and 80 and display_name = btrim(display_name)
    and display_name !~ '[[:cntrl:]<>]'
  )
);
alter table public.creator_profiles enable row level security;
revoke all on public.creator_profiles from anon, authenticated;
insert into public.creator_profiles(user_id, display_name)
  select id, split_part(email, '@', 1) from auth.users;

create function public.create_creator_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.creator_profiles(user_id, display_name)
    values(new.id, btrim(new.raw_user_meta_data ->> 'display_name'));
  return new;
end $$;
revoke all on function public.create_creator_profile() from public, anon, authenticated;
create trigger pocket_base_creator_profile after insert on auth.users
  for each row execute function public.create_creator_profile();

create function public.creator_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('displayName', display_name)
  from public.creator_profiles where user_id = auth.uid()
$$;
create function public.save_creator_profile(p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'PS_UNAUTHORIZED'; end if;
  update public.creator_profiles set display_name = btrim(p_display_name) where user_id = auth.uid();
  if not found then raise exception 'PS_NOT_FOUND'; end if;
  return public.creator_profile();
end $$;
revoke all on function public.creator_profile(),public.save_creator_profile(text) from public;
grant execute on function public.creator_profile(),public.save_creator_profile(text) to authenticated;

alter table public.projects add column published_at timestamptz;
update public.projects p set published_at = r.created_at
  from public.revisions r where r.id = p.published_revision_id and r.project_id = p.id;

create or replace function public.select_revision(p_id uuid,p_revision_id uuid,p_action text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_revision public.revisions; v_id uuid;
begin
  select id into v_id from public.projects where id=p_id and owner_id=auth.uid() for update;
  if not found then raise exception 'PS_NOT_FOUND'; end if;
  select * into v_revision from public.revisions where id=p_revision_id and project_id=p_id;
  if not found then raise exception 'PS_NOT_FOUND'; end if;
  if p_action = 'publish' then
    update public.projects set published_at = case when published_revision_id is distinct from p_revision_id
      then clock_timestamp() else published_at end, published_revision_id=p_revision_id,updated_at=now() where id=p_id;
  elsif p_action = 'restore' then
    update public.projects set current_revision_id=p_revision_id,title=v_revision.title,
      description=v_revision.description,theme=v_revision.theme,updated_at=now() where id=p_id;
  else raise exception 'PS_BAD_ACTION'; end if;
  return public.project_detail(p_id);
end $$;
create or replace function public.unpublish_game(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.projects set published_revision_id=null,published_at=null,updated_at=now()
    where id=p_id and owner_id=auth.uid();
  if not found then raise exception 'PS_NOT_FOUND'; end if;
end $$;

create table public.library_catalog (
  id uuid primary key,
  revision_id uuid not null,
  title text not null check (length(title) between 1 and 70),
  description text not null check (length(description) <= 200),
  theme text not null check (theme in ('cosmic','mint','peach','lemon','lilac')),
  html text not null check (octet_length(html) between 100 and 1000000),
  icon_svg text check (icon_svg is null or octet_length(icon_svg) <= 30000),
  creator_name text not null,
  updated_at timestamptz not null
);
alter table public.library_catalog enable row level security;
revoke all on public.library_catalog from anon, authenticated;

create or replace function public.public_game(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id',id,'revisionId',revision_id,'title',title,
    'description',description,'theme',theme,'html',html,'iconSvg',icon_svg)
  from (
    select c.id,c.revision_id,c.title,c.description,c.theme,c.html,c.icon_svg from public.library_catalog c where c.id=p_id
    union all
    select p.id,r.id,r.title,r.description,r.theme,r.html,r.icon_svg
      from public.projects p join public.revisions r on r.id=p.published_revision_id and r.project_id=p.id
      where p.id=p_id and not exists(select 1 from public.library_catalog c where c.id=p.id)
  ) games
$$;

create or replace function public.published_games(p_offset integer default 0, p_limit integer default 24) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
        join public.revisions r on r.id=p.published_revision_id and r.project_id=p.id
        join public.creator_profiles c on c.user_id=p.owner_id
        where not exists(select 1 from public.library_catalog catalog where catalog.id=p.id)
    ), candidates as (
      select * from all_games order by updated_at desc,id offset p_offset limit p_limit+1
    ), page as (
      select * from candidates order by updated_at desc,id limit p_limit
    )
    select jsonb_build_object(
      'games', coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'revisionId',revision_id,'title',title,'description',description,'theme',theme,
        'creatorName',creator_name,'updatedAt',updated_at
      ) order by updated_at desc,id) from page),'[]'::jsonb),
      'hasMore',(select count(*) > p_limit from candidates)
    )
  );
end $$;
