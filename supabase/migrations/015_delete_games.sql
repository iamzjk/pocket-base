-- Only the owner can permanently remove a project and its revision history.
create function public.delete_game(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'PS_UNAUTHORIZED'; end if;
  if not exists(select 1 from public.creator_profiles where user_id = v_owner and display_name is not null) then
    raise exception 'PS_PROFILE_REQUIRED';
  end if;
  -- The project delete cascades to every revision, including the live revision.
  delete from public.projects where id = p_id and owner_id = v_owner;
  if not found then raise exception 'PS_NOT_FOUND'; end if;
  delete from public.game_play_counts where game_id = p_id;
  delete from public.game_play_visitors where game_id = p_id;
  -- Account generation attempts remain in place so deletion cannot reset quotas.
end $$;
revoke all on function public.delete_game(uuid) from public, anon;
grant execute on function public.delete_game(uuid) to authenticated;
