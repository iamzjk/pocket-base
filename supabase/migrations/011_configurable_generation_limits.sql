-- Runtime settings may lower these database ceilings without another migration.
-- The application defaults to 100,000 prompt characters and 5MB of game source.
alter table public.revisions drop constraint revisions_prompt_check;
alter table public.revisions add constraint revisions_prompt_check check (length(prompt) <= 100000);

alter table public.revisions drop constraint revisions_html_check;
alter table public.revisions add constraint revisions_html_check check (octet_length(html) between 100 and 10000000);

-- A full five-minute inference deadline needs time for validation and persistence.
-- Keep the active lease separate from UTC-day quotas so midnight cannot unlock a run.
create or replace function public.reserve_generation() returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid:=auth.uid(); v_count bigint; v_personal bigint; v_busy boolean; v_id uuid;
begin
  if v_owner is null then raise exception 'PS_UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(7300101);
  select count(*),count(*) filter(where owner_id=v_owner)
    into v_count,v_personal from public.generation_attempts
    where created_at>=date_trunc('day',now(),'UTC');
  select exists(select 1 from public.generation_attempts
    where owner_id=v_owner and finished_at is null and created_at>now()-interval '6 minutes')
    into v_busy;
  if v_count>=40 or v_personal>=20 then raise exception 'PS_QUOTA'; end if;
  if v_busy then raise exception 'PS_BUSY'; end if;
  insert into public.generation_attempts(owner_id) values(v_owner) returning id into v_id;
  return v_id;
end $$;
