-- Google registrations choose their own public name after verified OAuth sign-in.
-- Existing profiles and linked identities keep their names.
alter table public.creator_profiles alter column display_name drop not null;

create or replace function public.create_creator_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if (new.raw_app_meta_data ->> 'provider') = 'google' then
    v_name := null;
  else
    v_name := btrim(new.raw_user_meta_data ->> 'display_name');
    if v_name is null then raise exception 'PS_BAD_PROFILE'; end if;
  end if;
  insert into public.creator_profiles(user_id,display_name) values(new.id,v_name);
  return new;
end $$;

create or replace function public.save_creator_profile(p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'PS_UNAUTHORIZED'; end if;
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 80
    or p_display_name ~ '[[:cntrl:]<>]' then raise exception 'PS_BAD_PROFILE'; end if;
  update public.creator_profiles set display_name=btrim(p_display_name) where user_id=auth.uid();
  if not found then raise exception 'PS_NOT_FOUND'; end if;
  return public.creator_profile();
end $$;

-- Table guards also cover security-definer RPCs without replacing save_game or
-- reserve_generation (which carry independent quotas, limits, and logo rules).
create function public.require_completed_creator() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.creator_profiles where user_id=new.owner_id and display_name is not null) then
    raise exception 'PS_PROFILE_REQUIRED';
  end if;
  return new;
end $$;
revoke all on function public.require_completed_creator() from public,anon,authenticated;
create trigger completed_creator_projects before insert or update on public.projects
  for each row execute function public.require_completed_creator();
create trigger completed_creator_generation before insert on public.generation_attempts
  for each row execute function public.require_completed_creator();

create or replace function public.before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ip inet; v_now timestamptz; v_name text; v_hour bigint; v_day bigint; v_total bigint;
begin
  v_name := btrim(event -> 'user' -> 'user_metadata' ->> 'display_name');
  -- app_metadata is written by Auth; user_metadata is browser-controlled.
  if (event -> 'user' -> 'app_metadata' ->> 'provider') is distinct from 'google'
    and (v_name is null or length(v_name) not between 1 and 80 or v_name ~ '[[:cntrl:]<>]') then
    return jsonb_build_object('error',jsonb_build_object('http_code',400,'message','Choose a public name with 1–80 characters.'));
  end if;
  begin
    v_ip := nullif(event -> 'metadata' ->> 'ip_address','')::inet;
    -- Reject supplied CIDRs: Auth must provide a single address.
    if v_ip is null or masklen(v_ip) <> (case when family(v_ip)=4 then 32 else 128 end) then
      raise invalid_text_representation;
    end if;
    if family(v_ip)=6 then
      if v_ip <<= '::ffff:0:0/96'::inet then
        v_ip := '0.0.0.0'::inet + (v_ip - '::ffff:0:0'::inet);
      else
        v_ip := network(set_masklen(v_ip,64));
      end if;
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('error',jsonb_build_object('http_code',400,'message','Registration is unavailable. Please try again later.'));
  end;
  perform pg_catalog.pg_advisory_xact_lock(7300102);
  v_now := clock_timestamp();
  delete from public.signup_attempts where created_at <= v_now-interval '24 hours';
  select count(*) filter(where network=v_ip and created_at>v_now-interval '1 hour'),
    count(*) filter(where network=v_ip),count(*) into v_hour,v_day,v_total from public.signup_attempts;
  if v_hour>=3 or v_day>=10 or v_total>=100 then
    return jsonb_build_object('error',jsonb_build_object('http_code',429,'message','Too many registrations. Please try again later.'));
  end if;
  insert into public.signup_attempts(network,created_at) values(v_ip,v_now);
  return '{}'::jsonb;
end $$;
