-- Configure as the Supabase Before User Created hook AFTER deploying the auth UI.
-- No browser/API role can inspect or submit registrations to these counters.
create table public.signup_attempts (
  id bigint generated always as identity primary key,
  network inet not null,
  created_at timestamptz not null
);
create index signup_attempts_created on public.signup_attempts(created_at);
create index signup_attempts_network on public.signup_attempts(network,created_at);
alter table public.signup_attempts enable row level security;
revoke all on public.signup_attempts from public,anon,authenticated;

create function public.before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ip inet; v_now timestamptz; v_name text; v_hour bigint; v_day bigint; v_total bigint;
begin
  v_name := btrim(event -> 'user' -> 'user_metadata' ->> 'display_name');
  if v_name is null or length(v_name) not between 1 and 80 or v_name ~ '[[:cntrl:]<>]' then
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
revoke all on function public.before_user_created(jsonb) from public,anon,authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
