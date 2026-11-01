-- Apply once in the Supabase SQL editor. No service-role key is needed by the app.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 70),
  description text not null default '' check (length(description) <= 200),
  theme text not null check (theme in ('cosmic','mint','peach','lemon','lilac')),
  current_revision_id uuid,
  published_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (length(title) between 1 and 70),
  description text not null check (length(description) <= 200),
  theme text not null check (theme in ('cosmic','mint','peach','lemon','lilac')),
  html text not null check (octet_length(html) between 100 and 200000),
  prompt text not null check (length(prompt) <= 2000),
  created_at timestamptz not null default now(),
  unique (id, project_id)
);
alter table public.projects add constraint current_revision_belongs_to_game
  foreign key (current_revision_id, id) references public.revisions(id, project_id);
alter table public.projects add constraint published_revision_belongs_to_game
  foreign key (published_revision_id, id) references public.revisions(id, project_id);
create index projects_owner on public.projects(owner_id, updated_at desc);
create index revisions_project on public.revisions(project_id, created_at desc);
create table public.generation_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index attempts_created on public.generation_attempts(created_at);
alter table public.projects enable row level security;
alter table public.revisions enable row level security;
alter table public.generation_attempts enable row level security;
create policy own_projects on public.projects for select to authenticated using (owner_id = (select auth.uid()));
create policy own_revisions on public.revisions for select to authenticated using (
  exists(select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
);
grant select on public.projects, public.revisions to authenticated;
revoke all on public.projects, public.revisions, public.generation_attempts from anon;
revoke insert, update, delete on public.projects, public.revisions, public.generation_attempts from authenticated;

create function public.project_detail(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(p) || jsonb_build_object('revisions',
    coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id)
      from public.revisions r where r.project_id = p.id), '[]'::jsonb))
  from public.projects p where p.id = p_id and p.owner_id = auth.uid()
$$;

create function public.save_game(
  p_project_id uuid, p_base_revision_id uuid, p_title text, p_description text,
  p_theme text, p_html text, p_prompt text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_owner uuid := auth.uid(); v_current uuid; v_revision uuid;
begin
  if v_owner is null then raise exception 'PS_UNAUTHORIZED'; end if;
  if p_project_id is null then
    insert into public.projects(owner_id,title,description,theme)
      values(v_owner,p_title,p_description,p_theme) returning id into v_id;
  else
    select id,current_revision_id into v_id,v_current from public.projects
      where id = p_project_id and owner_id = v_owner for update;
    if not found then raise exception 'PS_NOT_FOUND'; end if;
    if v_current is distinct from p_base_revision_id then raise exception 'PS_CONFLICT'; end if;
  end if;
  insert into public.revisions(project_id,title,description,theme,html,prompt)
    values(v_id,p_title,p_description,p_theme,p_html,p_prompt) returning id into v_revision;
  update public.projects set current_revision_id = v_revision,title=p_title,
    description=p_description,theme=p_theme,updated_at=now() where id=v_id;
  return public.project_detail(v_id);
end $$;

create function public.select_revision(p_id uuid,p_revision_id uuid,p_action text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_revision public.revisions; v_id uuid;
begin
  select id into v_id from public.projects where id=p_id and owner_id=auth.uid() for update;
  if not found then raise exception 'PS_NOT_FOUND'; end if;
  select * into v_revision from public.revisions where id=p_revision_id and project_id=p_id;
  if not found then raise exception 'PS_NOT_FOUND'; end if;
  if p_action = 'publish' then
    update public.projects set published_revision_id=p_revision_id,updated_at=now() where id=p_id;
  elsif p_action = 'restore' then
    update public.projects set current_revision_id=p_revision_id,title=v_revision.title,
      description=v_revision.description,theme=v_revision.theme,updated_at=now() where id=p_id;
  else raise exception 'PS_BAD_ACTION';
  end if;
  return public.project_detail(p_id);
end $$;

create function public.unpublish_game(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.projects set published_revision_id=null,updated_at=now() where id=p_id and owner_id=auth.uid();
  if not found then raise exception 'PS_NOT_FOUND'; end if;
end $$;

-- This function returns only the selected public version. Drafts and prompts never leave it.
create function public.public_game(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id',p.id,'revisionId',r.id,'title',r.title,
    'description',r.description,'theme',r.theme,'html',r.html)
  from public.projects p join public.revisions r on r.id=p.published_revision_id and r.project_id=p.id
  where p.id=p_id
$$;

create function public.reserve_generation() returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid:=auth.uid(); v_count bigint; v_personal bigint; v_busy boolean; v_id uuid;
begin
  if v_owner is null then raise exception 'PS_UNAUTHORIZED'; end if;
  -- Serialize reservations across serverless instances. All attempted calls count, including failures.
  perform pg_advisory_xact_lock(7300101);
  select count(*),count(*) filter(where owner_id=v_owner),
    coalesce(bool_or(owner_id=v_owner and finished_at is null and created_at>now()-interval '5 minutes'),false)
    into v_count,v_personal,v_busy from public.generation_attempts
    where created_at>=date_trunc('day',now(),'UTC');
  if v_count>=40 or v_personal>=20 then raise exception 'PS_QUOTA'; end if;
  if v_busy then raise exception 'PS_BUSY'; end if;
  insert into public.generation_attempts(owner_id) values(v_owner) returning id into v_id;
  return v_id;
end $$;

create function public.finish_generation(p_id uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.generation_attempts set finished_at=now() where id=p_id and owner_id=auth.uid()
$$;

revoke all on function public.project_detail(uuid),public.save_game(uuid,uuid,text,text,text,text,text),
  public.select_revision(uuid,uuid,text),public.unpublish_game(uuid),public.public_game(uuid),
  public.reserve_generation(),public.finish_generation(uuid) from public;
grant execute on function public.project_detail(uuid),public.save_game(uuid,uuid,text,text,text,text,text),
  public.select_revision(uuid,uuid,text),public.unpublish_game(uuid),public.reserve_generation(),
  public.finish_generation(uuid) to authenticated;
grant execute on function public.public_game(uuid) to anon,authenticated;
