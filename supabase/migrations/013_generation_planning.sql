-- Charge the build call separately while retaining the planning request's lease.
-- The ordinary reservation still rejects any other active request for this owner.
create function public.reserve_generation_step(p_parent_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid:=auth.uid(); v_count bigint; v_personal bigint; v_id uuid;
begin
  if v_owner is null then raise exception 'PS_UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(7300101);
  if not exists(select 1 from public.generation_attempts
    where id=p_parent_id and owner_id=v_owner and finished_at is null
      and created_at>now()-interval '6 minutes') then
    raise exception 'PS_EXPIRED';
  end if;
  select count(*),count(*) filter(where owner_id=v_owner)
    into v_count,v_personal from public.generation_attempts
    where created_at>=date_trunc('day',now(),'UTC');
  if v_count>=40 or v_personal>=20 then raise exception 'PS_QUOTA'; end if;
  if exists(select 1 from public.generation_attempts
    where owner_id=v_owner and id<>p_parent_id and finished_at is null
      and created_at>now()-interval '6 minutes') then
    raise exception 'PS_BUSY';
  end if;
  insert into public.generation_attempts(owner_id) values(v_owner) returning id into v_id;
  return v_id;
end $$;

revoke all on function public.reserve_generation_step(uuid) from public;
grant execute on function public.reserve_generation_step(uuid) to authenticated;
