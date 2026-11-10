-- Private conversations and revision-scoped memory. No public RPC is expanded.
alter table public.revisions add column notes text check (notes is null or length(notes) <= 8000);
create table public.game_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid unique references public.projects(id) on delete cascade,
  document jsonb not null default '{"title":"New idea","version":0,"summary":"","contextVersion":0,"proposal":null}',
  updated_at timestamptz not null default now(),
  check (length(document->>'summary') <= 4000)
);
create index game_conversations_owner on public.game_conversations(owner_id, updated_at desc);
create table public.game_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.game_conversations(id) on delete cascade,
  kind text not null check (kind in ('user','assistant','proposal','saved','restored')),
  text text not null check (length(text) <= 100000),
  version integer not null,
  revision_id uuid references public.revisions(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create index game_messages_conversation on public.game_messages(conversation_id,created_at,id);
create table public.conversation_requests (
  id uuid primary key,
  conversation_id uuid not null references public.game_conversations(id) on delete cascade,
  document jsonb not null
);
alter table public.game_conversations enable row level security;
alter table public.game_messages enable row level security;
alter table public.conversation_requests enable row level security;
create policy own_conversations on public.game_conversations for select to authenticated using(owner_id=auth.uid());
create policy own_messages on public.game_messages for select to authenticated using(exists(select 1 from public.game_conversations c where c.id=conversation_id and c.owner_id=auth.uid()));
create policy own_conversation_requests on public.conversation_requests for select to authenticated using(exists(select 1 from public.game_conversations c where c.id=conversation_id and c.owner_id=auth.uid()));
grant select on public.game_conversations,public.game_messages,public.conversation_requests to authenticated;
create trigger completed_creator_conversations before insert or update on public.game_conversations
  for each row execute function public.require_completed_creator();

create function public.conversation_detail(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select c.document || jsonb_build_object('id',c.id,'projectId',c.project_id,'updatedAt',c.updated_at,'messages',
   coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'text',m.text,'version',m.version,'createdAt',m.created_at,'revisionId',m.revision_id) order by m.created_at,m.id)
   from public.game_messages m where m.conversation_id=c.id),'[]'::jsonb))
 from public.game_conversations c where c.id=p_id and c.owner_id=auth.uid()
$$;

create function public.conversation_command(p_id uuid,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.game_conversations; r public.conversation_requests; d jsonb; v_base uuid; v_project uuid;
 v_revision record; v_version integer; v_prompt text; v_brief text; v_id uuid; v_existing boolean;
begin
 if auth.uid() is null then raise exception 'PS_UNAUTHORIZED'; end if;
 if not exists(select 1 from public.creator_profiles where user_id=auth.uid() and display_name is not null) then raise exception 'PS_PROFILE_REQUIRED'; end if;
 if p_action='list' then
   return coalesce((select jsonb_agg(jsonb_build_object('id',id,'projectId',project_id,'title',document->>'title','updatedAt',updated_at) order by updated_at desc)
   from public.game_conversations where owner_id=auth.uid()),'[]'::jsonb);
 end if;
 if p_action='create' then
   v_project := (p_input->>'projectId')::uuid;
   if v_project is not null then
     perform 1 from public.projects where id=v_project and owner_id=auth.uid() for update;
     if not found then raise exception 'PS_NOT_FOUND'; end if;
     select * into c from public.game_conversations where project_id=v_project;
     if found then return public.conversation_detail(c.id); end if;
   end if;
   insert into public.game_conversations(owner_id,project_id) values(auth.uid(),v_project) returning * into c;
   if v_project is not null then
     update public.game_conversations set document=document || jsonb_build_object('title',(select title from public.projects where id=v_project)) where id=c.id;
     for v_revision in select id,prompt,created_at from public.revisions where project_id=v_project order by created_at,id loop
       insert into public.game_messages(conversation_id,kind,text,version,created_at) values(c.id,'user',v_revision.prompt,0,v_revision.created_at);
       insert into public.game_messages(conversation_id,kind,text,version,revision_id,created_at) values(c.id,'saved','Saved version',0,v_revision.id,v_revision.created_at+interval '1 microsecond');
     end loop;
   end if;
   return public.conversation_detail(c.id);
 end if;
 if p_action in ('reply','fail') then
   select * into r from public.conversation_requests where id=p_id;
   p_id := r.conversation_id;
 end if;
 -- Match the lock order used by revision saves and restores.
 select project_id into v_project from public.game_conversations where id=p_id and owner_id=auth.uid();
 if v_project is not null then select current_revision_id into v_base from public.projects where id=v_project and owner_id=auth.uid() for update; end if;
 select * into c from public.game_conversations where id=p_id and owner_id=auth.uid() for update;
 if not found then
   if p_action='read' then return null; end if;
   raise exception 'PS_NOT_FOUND';
 end if;
 d := c.document; v_version := (d->>'version')::integer;
 if p_action='read' then return public.conversation_detail(c.id); end if;
 if p_action='delete' then
   if c.project_id is not null then raise exception 'PS_CONFLICT'; end if;
   delete from public.game_conversations where id=c.id; return '{}'::jsonb;
 end if;
 if p_action='fail' then
   update public.conversation_requests set document=document || '{"status":"failed"}' where id=r.id and document->>'status'='pending' and (p_input->>'startedAt' is null or (document->>'startedAt')::timestamptz=(p_input->>'startedAt')::timestamptz);
   return '{}'::jsonb;
 end if;
 if p_action='begin' then
   v_id := (p_input->>'requestId')::uuid;
   select * into r from public.conversation_requests where id=v_id for update;
   v_existing := found;
   if v_existing then
     if r.conversation_id<>c.id or r.document->>'kind' is distinct from p_input->>'kind'
       or (p_input->>'kind'<>'proposal' and coalesce(r.document->>'inputPrompt',r.document->>'prompt') is distinct from p_input->>'prompt') then raise exception 'PS_CONFLICT'; end if;
     if r.document->>'status'='complete' then return r.document; end if;
     if r.document->>'status'='pending' and (r.document->>'startedAt')::timestamptz>clock_timestamp()-interval '6 minutes' then raise exception 'PS_BUSY'; end if;
     if (r.document->>'version')::integer<>v_version or (r.document->>'baseRevisionId')::uuid is distinct from v_base then raise exception 'PS_CONFLICT'; end if;
     update public.conversation_requests set document=document || jsonb_build_object('status','pending','startedAt',clock_timestamp()) where id=v_id returning document into d;
     return d;
   end if;
   if exists(select 1 from public.conversation_requests where conversation_id=c.id and document->>'status'='pending' and (document->>'version')::integer=v_version and (document->>'startedAt')::timestamptz>clock_timestamp()-interval '6 minutes') then raise exception 'PS_BUSY'; end if;
   if (p_input->>'version')::integer is distinct from v_version or (p_input->>'baseRevisionId')::uuid is distinct from v_base then raise exception 'PS_CONFLICT'; end if;
   if p_input->>'kind'='proposal' then
     if d->'proposal' is null or d->'proposal'='null'::jsonb or d->'proposal'->>'id' is distinct from p_input->>'proposalId'
       or (d->'proposal'->>'version')::integer<>v_version or (d->'proposal'->>'baseRevisionId')::uuid is distinct from v_base then raise exception 'PS_CONFLICT'; end if;
     v_brief := d->'proposal'->>'brief';
     if c.project_id is null then select text into v_prompt from public.game_messages where conversation_id=c.id and kind='user' order by created_at,id limit 1;
     else select text into v_prompt from public.game_messages where conversation_id=c.id and kind='user' order by created_at desc,id desc limit 1; end if;
   elsif p_input->>'kind' in ('discussion','direct') then
     v_prompt := btrim(p_input->>'prompt');
     if v_prompt is null or length(v_prompt) not between 1 and 100000 then raise exception 'PS_BAD_PROMPT'; end if;
     v_version := v_version+1;
     d := d || jsonb_build_object('version',v_version,'proposal',null);
     if not exists(select 1 from public.game_messages where conversation_id=c.id) then d := d || jsonb_build_object('title',left(v_prompt,70)); end if;
     insert into public.game_messages(conversation_id,kind,text,version) values(c.id,'user',v_prompt,v_version);
     update public.game_conversations set document=d,updated_at=clock_timestamp() where id=c.id;
   else raise exception 'PS_BAD_ACTION'; end if;
   if p_input->>'kind'='direct' and c.project_id is null then select text into v_prompt from public.game_messages where conversation_id=c.id and kind='user' order by created_at,id limit 1; end if;
   d := jsonb_build_object('inputPrompt',p_input->>'prompt','id',v_id,'conversationId',c.id,'version',v_version,'kind',p_input->>'kind','status','pending','prompt',v_prompt,'brief',v_brief,'projectId',c.project_id,'baseRevisionId',v_base,'startedAt',clock_timestamp());
   insert into public.conversation_requests values(v_id,c.id,d);
   return d;
 end if;
 if p_action='reply' then
   -- Re-read after obtaining the conversation lock.
   select * into r from public.conversation_requests where id=r.id for update;
   if (p_input->>'startedAt' is not null and (r.document->>'startedAt')::timestamptz is distinct from (p_input->>'startedAt')::timestamptz) or r.document->>'kind'<>'discussion' or r.document->>'status'<>'pending' or (r.document->>'version')::integer<>v_version
     or (r.document->>'baseRevisionId')::uuid is distinct from v_base or (r.document->>'startedAt')::timestamptz<=clock_timestamp()-interval '6 minutes' then raise exception 'PS_CONFLICT'; end if;
   if p_input->>'reply' is null or length(btrim(p_input->>'reply')) not between 1 and 8000 or p_input->>'summary' is null or length(p_input->>'summary')>4000 then raise exception 'PS_BAD_REPLY'; end if;
   v_brief := nullif(btrim(p_input->>'proposal'),'');
   if v_brief is not null and (length(v_brief)>12800 or cardinality(regexp_split_to_array(v_brief,'\s+'))>400) then raise exception 'PS_BAD_REPLY'; end if;
   insert into public.game_messages(conversation_id,kind,text,version) values(c.id,'assistant',p_input->>'reply',v_version);
   d := d || jsonb_build_object('summary',p_input->>'summary');
   if v_brief is not null then
     d := d || jsonb_build_object('proposal',jsonb_build_object('id',gen_random_uuid(),'brief',v_brief,'version',v_version,'baseRevisionId',v_base));
     insert into public.game_messages(conversation_id,kind,text,version) values(c.id,'proposal',v_brief,v_version);
   end if;
   update public.game_conversations set document=d,updated_at=clock_timestamp() where id=c.id;
   update public.conversation_requests set document=document || '{"status":"complete"}' where id=r.id;
   return public.conversation_detail(c.id);
 end if;
 raise exception 'PS_BAD_ACTION';
end $$;

-- Revision changes reset active discussion while retaining the full transcript.
create function public.reset_game_conversation() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.game_conversations; v_version integer; v_kind text;
begin
 select * into c from public.game_conversations where project_id=new.id for update;
 if found then
   v_version := (c.document->>'version')::integer+1;
   update public.game_conversations set document=document || jsonb_build_object('version',v_version,'contextVersion',v_version,'summary','','proposal',null),updated_at=clock_timestamp() where id=c.id;
   v_kind := case when exists(select 1 from public.game_messages where conversation_id=c.id and revision_id=new.current_revision_id) then 'restored' else 'saved' end;
   insert into public.game_messages(conversation_id,kind,text,version,revision_id) values(c.id,v_kind,case when v_kind='restored' then 'Restored version' else 'Saved version' end,v_version,new.current_revision_id);
 end if;
 return new;
end $$;
create trigger reset_game_conversation after update of current_revision_id on public.projects for each row execute function public.reset_game_conversation();

-- Retain the proven source/logo save, exposing only the new atomic wrapper.
alter function public.save_game(uuid,uuid,text,text,text,text,text,text) rename to save_game_source;
revoke all on function public.save_game_source(uuid,uuid,text,text,text,text,text,text) from public,anon,authenticated;
create function public.save_game(p_project_id uuid,p_base_revision_id uuid,p_title text,p_description text,p_theme text,p_html text,p_prompt text,p_icon_svg text default null,p_notes text default null,p_conversation_request_id uuid default null,p_request_started_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.game_conversations; r public.conversation_requests; g jsonb; v_notes text; v_version integer;
begin
 if auth.uid() is null then raise exception 'PS_UNAUTHORIZED'; end if;
 if p_project_id is not null then
   perform 1 from public.projects where id=p_project_id and owner_id=auth.uid() for update;
   if not found then raise exception 'PS_NOT_FOUND'; end if;
 end if;
 if p_conversation_request_id is not null then
   select * into r from public.conversation_requests where id=p_conversation_request_id;
   select * into c from public.game_conversations where id=r.conversation_id and owner_id=auth.uid() for update;
   if not found then raise exception 'PS_NOT_FOUND'; end if;
   select * into r from public.conversation_requests where id=p_conversation_request_id for update;
   if (p_request_started_at is not null and (r.document->>'startedAt')::timestamptz is distinct from p_request_started_at) or r.document->>'status'<>'pending' or r.document->>'kind'='discussion' or (r.document->>'version')::integer<>(c.document->>'version')::integer
     or (r.document->>'projectId')::uuid is distinct from p_project_id or (r.document->>'baseRevisionId')::uuid is distinct from p_base_revision_id
     or r.document->>'prompt' is distinct from p_prompt or (r.document->>'startedAt')::timestamptz<=clock_timestamp()-interval '6 minutes' then raise exception 'PS_CONFLICT'; end if;
 end if;
 select notes into v_notes from public.revisions where id=p_base_revision_id and project_id=p_project_id;
 g := public.save_game_source(p_project_id,p_base_revision_id,p_title,p_description,p_theme,p_html,p_prompt,p_icon_svg);
 update public.revisions set notes=coalesce(p_notes,v_notes) where id=(g->>'current_revision_id')::uuid;
 if p_conversation_request_id is not null then
   if c.project_id is null then
     v_version := (c.document->>'version')::integer+1;
     update public.game_conversations set project_id=(g->>'id')::uuid,document=document || jsonb_build_object('version',v_version,'contextVersion',v_version,'summary','','proposal',null),updated_at=clock_timestamp() where id=c.id;
     insert into public.game_messages(conversation_id,kind,text,version,revision_id) values(c.id,'saved','Saved version',v_version,(g->>'current_revision_id')::uuid);
   end if;
   update public.conversation_requests set document=document || jsonb_build_object('status','complete','projectId',g->>'id') where id=r.id;
 end if;
 return public.project_detail((g->>'id')::uuid);
end $$;
revoke all on function public.conversation_detail(uuid),public.conversation_command(uuid,text,jsonb),public.reset_game_conversation(),public.save_game(uuid,uuid,text,text,text,text,text,text,text,uuid,timestamptz) from public,anon;
grant execute on function public.conversation_detail(uuid),public.conversation_command(uuid,text,jsonb),public.save_game(uuid,uuid,text,text,text,text,text,text,text,uuid,timestamptz) to authenticated;
