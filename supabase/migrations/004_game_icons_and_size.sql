-- Allow larger self-contained games and store an app icon with each version.
alter table public.revisions drop constraint revisions_html_check;
alter table public.revisions add constraint revisions_html_check check (octet_length(html) between 100 and 1000000);
alter table public.revisions add column icon_svg text check (icon_svg is null or octet_length(icon_svg) <= 30000);

-- The extra argument is optional so older deployments remain compatible.
drop function public.save_game(uuid,uuid,text,text,text,text,text);
create function public.save_game(
  p_project_id uuid, p_base_revision_id uuid, p_title text, p_description text,
  p_theme text, p_html text, p_prompt text, p_icon_svg text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_owner uuid := auth.uid(); v_current uuid; v_revision uuid; v_icon_svg text;
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
    select icon_svg into v_icon_svg from public.revisions where id = v_current and project_id = v_id;
  end if;
  insert into public.revisions(project_id,title,description,theme,html,prompt,icon_svg)
    values(v_id,p_title,p_description,p_theme,p_html,p_prompt,coalesce(v_icon_svg,p_icon_svg)) returning id into v_revision;
  update public.projects set current_revision_id = v_revision,title=p_title,
    description=p_description,theme=p_theme,updated_at=now() where id=v_id;
  return public.project_detail(v_id);
end $$;

create or replace function public.public_game(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id',p.id,'revisionId',r.id,'title',r.title,
    'description',r.description,'theme',r.theme,'html',r.html,'iconSvg',r.icon_svg)
  from public.projects p join public.revisions r on r.id=p.published_revision_id and r.project_id=p.id
  where p.id=p_id
$$;

revoke all on function public.save_game(uuid,uuid,text,text,text,text,text,text) from public;
grant execute on function public.save_game(uuid,uuid,text,text,text,text,text,text) to authenticated;
