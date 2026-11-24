-- Serialize organizer removals with signups and the one-time draw.
create or replace function public.remove_secret_santa_participant(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.santa_event%rowtype;
  v_deleted integer;
begin
  select e.* into v_event from public.santa_event as e where e.id = 1 for update;
  if v_event.draw_complete then raise exception 'draw-already-complete'; end if;
  delete from public.santa_participants where id = p_participant_id;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then raise exception 'participant-not-found'; end if;
end;
$$;
revoke all on function public.remove_secret_santa_participant(uuid) from public, anon, authenticated;
grant execute on function public.remove_secret_santa_participant(uuid) to service_role;
